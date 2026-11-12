#!/usr/bin/env node
'use strict';

// Optional synthetic qualification. No provisioning, issuance, claim redemption or retry.
// The one existing synthetic credential is permanently revoked as the last step.
const fs = require('node:fs');
const path = require('node:path');
const { isDeepStrictEqual: equal } = require('node:util');
const c = require('./public-client-common.cjs');
const { decodeCompact } = require('./ob3-client.cjs');
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const OB3_PROFILE = '10000000-0000-0000-0000-000000000003';
const SCOPES = { R: ['credentials:read'], V: ['credentials:read', 'trust:read'] };
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const none = value => value === null || value === undefined;
const empty = value => Array.isArray(value) && value.length === 0;

function parsePrivate(raw) {
  try { const value = JSON.parse(raw); if (object(value)) return value; } catch {}
  throw new c.Stop('private_record_invalid', 'A retained private JSON record is malformed.');
}
function config(filename) {
  try { return c.config(filename); } catch (error) {
    if (error instanceof SyntaxError) throw new c.Stop('configuration_invalid', 'Configuration JSON is malformed.');
    throw error;
  }
}
function timestamp(value) {
  const m = typeof value === 'string' && /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})(?:\.(\d{1,9}))?(?:Z|\+00:00)$/.exec(value);
  c.need(m && Number.isFinite(Date.parse(m[1] + 'Z')), 'key_timestamp_invalid', 'Usage timestamps must be unambiguous UTC values.');
  return BigInt(Date.parse(m[1] + 'Z')) * 1000000n + BigInt((m[2] || '').padEnd(9, '0'));
}
function metadata(row, org) {
  c.need(object(row) && UUID.test(row.id) && row.organization_id === org && row.key === undefined &&
    Array.isArray(row.scopes) && row.scopes.every(x => typeof x === 'string'),
  'key_inventory_invalid', 'Public inventory must contain distinct tenant-owned key metadata without secrets.');
  timestamp(row.created_at);
  if (!none(row.expires_at)) timestamp(row.expires_at);
  if (!none(row.last_used_at)) timestamp(row.last_used_at);
  return { id: row.id, organization_id: row.organization_id, scopes: [...row.scopes].sort(), enabled: row.enabled,
    scope_type: row.scope_type, deployment_profile_id: row.deployment_profile_id ?? null,
    created_at: row.created_at, expires_at: row.expires_at ?? null };
}
function load(configFile, now) {
  c.need(c.nonempty(configFile), 'configuration_required', 'Supply the reviewed probe configuration.');
  const cfg = config(configFile);
  for (const field of ['clientConfigFile', 'operatorSessionFile', 'readKeyFile', 'verifyKeyFile', 'probeStateDirectory'])
    c.need(c.nonempty(cfg[field]), 'configuration_required', 'All retained input and private evidence paths are required.');
  c.need(cfg.syntheticCourse === true && cfg.revokeSyntheticCredentialLast === true && UUID.test(cfg.policyId) &&
    UUID.test(cfg.readKeyId) && UUID.test(cfg.verifyKeyId) && cfg.readKeyId !== cfg.verifyKeyId,
  'probe_binding_invalid', 'Configure one synthetic course policy and two distinct key UUIDs, with terminal revocation explicitly selected.');
  const client = config(c.resolveFile(cfg, cfg.clientConfigFile));
  c.need(client.origin === cfg.origin && UUID.test(client.organizationId) && UUID.test(client.credentialTemplateId) &&
    client.authMode === 'api-key' && /^synthetic-[A-Za-z0-9._:-]+$/.test(client.learnerId) && c.nonempty(client.stateDirectory),
  'client_binding_invalid', 'The original direct course must use this HTTPS origin and a synthetic learner.');
  const { original, directory } = c.probeDirectories(c.resolveFile(client, client.stateDirectory),
    c.resolveFile(cfg, cfg.probeStateDirectory));
  const hashes = {};
  const read = name => { const raw = c.readPrivate(path.join(original, name)); hashes[name] = c.hash(raw); return raw; };
  const journal = parsePrivate(read('issuance-requested.json'));
  const initial = parsePrivate(read('issuance-response.json'));
  const jwt = c.remember(read('credential.jwt').trim());
  const body = journal.body;
  c.need(object(body) && equal(Object.keys(body).sort(), ['credential_subject', 'credential_template_id', 'holder_did', 'issuer_did', 'organization_id', 'subject_did']) &&
    body.organization_id === client.organizationId && body.credential_template_id === client.credentialTemplateId && body.issuer_did === client.issuerDid &&
    c.nonempty(body.subject_did) && body.holder_did === body.subject_did && body.credential_subject?.id === body.subject_did &&
    body.credential_subject.learner_id === client.learnerId && body.credential_subject.achievement?.id === client.achievementId &&
    object(body.credential_subject.achievement.criteria) && journal.completionEventId === client.completionEventId && c.nonempty(journal.completionEventId),
  'original_request_invalid', 'The retained journal must bind this exact direct synthetic learner and achievement.');
  c.need(Number.isInteger(initial.status) && initial.status >= 200 && initial.status < 300 && UUID.test(initial.body?.id) &&
    initial.body.organization_id === client.organizationId && initial.body.credential_template_id === client.credentialTemplateId,
  'original_success_required', 'A successful matching original issuance response is required.');
  let decoded;
  try { decoded = decodeCompact(jwt); } catch { throw new c.Stop('credential_encoding_invalid', 'The retained credential must be a compact JWT.'); }
  const { header, payload } = decoded;
  const vc = payload?.vc;
  const issuer = typeof vc?.issuer === 'string' ? vc.issuer : vc?.issuer?.id;
  const types = Array.isArray(vc?.type) ? vc.type : [vc?.type];
  const subject = vc?.credentialSubject;
  c.need(object(payload) && header?.alg === 'ES256' && payload.iss === client.issuerDid && issuer === client.issuerDid &&
    c.nonempty(payload.jti) && payload.jti.length <= 2048 && !/[\x00-\x20\x7f]/.test(payload.jti) && vc.id === payload.jti &&
    payload.sub === body.subject_did && subject?.id === body.subject_did && subject.learner_id === client.learnerId &&
    equal(subject.achievement, body.credential_subject.achievement) && types.includes('VerifiableCredential') && types.includes('OpenBadgeCredential'),
  'credential_binding_invalid', 'The retained ES256 OB3 JWT must bind the original issuer, credential ID, learner and complete achievement.');
  const validFrom = vc.validFrom ?? vc.issuanceDate;
  const validUntil = vc.validUntil ?? vc.expirationDate;
  c.need(Number.isFinite(Date.parse(validFrom)) && Date.parse(validFrom) <= now &&
    (none(validUntil) || Number.isFinite(Date.parse(validUntil)) && Date.parse(validUntil) > now) &&
    (payload.nbf === undefined || Number.isFinite(payload.nbf) && payload.nbf * 1000 <= now) &&
    (payload.exp === undefined || Number.isFinite(payload.exp) && payload.exp * 1000 > now),
  'credential_lifetime_invalid', 'The retained course credential must be currently valid.');
  const secrets = { R: c.remember(c.readPrivate(c.resolveFile(cfg, cfg.readKeyFile), 16384).trim()),
    V: c.remember(c.readPrivate(c.resolveFile(cfg, cfg.verifyKeyFile), 16384).trim()) };
  c.need(Object.values(secrets).every(x => /^(mk|pk)_(test|live)_\S+$/.test(x)) && secrets.R !== secrets.V,
    'key_secrets_invalid', 'The two current private API-key files must contain distinct secrets.');
  const session = c.sessionValue(c.resolveFile(cfg, cfg.operatorSessionFile));
  const binding = c.hash(JSON.stringify({ origin: cfg.origin, organizationId: client.organizationId, policyId: cfg.policyId,
    readKeyId: cfg.readKeyId, verifyKeyId: cfg.verifyKeyId, hashes }));
  return { cfg, client, body, jwt, credentialId: payload.jti, transactionId: initial.body.id, directory, original, hashes,
    credentialHash: c.hash(jwt), secrets, session, binding, ids: { R: cfg.readKeyId, V: cfg.verifyKeyId } };
}

function validateResources(input, template, policy, trust) {
  const { client, cfg, body } = input;
  c.need(template?.id === client.credentialTemplateId && template.organization_id === client.organizationId && template.status === 'ACTIVE' &&
    template.issuer_did === client.issuerDid && template.credential_type === 'OpenBadgeCredential' && template.credential_payload_format === 'VC_JWT' &&
    template.compliance_profile_id === OB3_PROFILE && template.vct === client.achievementId &&
    Array.isArray(template.claims) && template.claims.length === 2 &&
    [['learner_id', 'STRING'], ['achievement', 'OBJECT']].every(([name, type]) => template.claims.some(claim =>
      claim.name === name && claim.type === type && claim.required === true && claim.selectively_disclosable === false)),
  'course_template_mismatch', 'The observed active template must be this issuer’s OB3 VC-JWT course.');
  const requirements = policy?.credential_requirements;
  // The native policy owner rejects every unresolved ComplianceProfile selector.
  // The template's OB3 profile is checked above; it is not policy evaluation evidence.
  c.need(none(policy?.compliance_profile_id), 'policy_compliance_unsupported',
    'The saved policy must omit compliance_profile_id: resolved ComplianceProfile evaluation is unavailable.');
  c.need(policy?.id === cfg.policyId && policy.organization_id === client.organizationId && policy.status === 'active' &&
    equal(policy.accepted_credential_types, ['OpenBadgeCredential']) &&
    empty(policy.required_claims) && Array.isArray(requirements) && requirements.length === 1 && empty(policy.alternative_requirements) &&
    policy.holder_binding?.required === false && policy.freshness?.require_not_revoked === true && none(policy.freshness.max_age_seconds) &&
    Number.isInteger(policy.freshness.revocation_grace_seconds) && policy.freshness.revocation_grace_seconds >= 0 && policy.freshness.revocation_grace_seconds <= 300 &&
    none(policy.prerequisite_evidence_profile) && none(policy.issuer_constraints) && policy.prefer_predicates === false &&
    empty(policy.supported_circuits) && none(policy.fallback_policy),
  'policy_bounds_mismatch', 'The owned active policy must require only this course, without holder proof, with current nonrevocation and no alternative acceptance.');
  const req = requirements[0];
  c.need(req.credential_template_id === client.credentialTemplateId && req.credential_payload_format === 'VC_JWT' && req.required === true &&
    UUID.test(policy.trust_profile_id) && req.trust_profile_id === policy.trust_profile_id && none(req.max_age_seconds) && req.require_fresh_issuance === false &&
    Array.isArray(req.requested_claims) && req.requested_claims.length === 2,
  'policy_course_mismatch', 'The sole required VC-JWT course must select the explicit owned trust profile.');
  const expected = { learner_id: body.credential_subject.learner_id, achievement: body.credential_subject.achievement };
  c.need(equal(req.requested_claims.map(x => x.claim_name).sort(), Object.keys(expected).sort()),
    'policy_claims_mismatch', 'Policy claims must bind the synthetic learner and complete achievement.');
  for (const claim of req.requested_claims) {
    c.need(claim.required === true && claim.selective_disclosure === false && claim.accept_derived === false && none(claim.predicate_spec) &&
      Array.isArray(claim.constraints) && claim.constraints.length === 1 && claim.constraints[0].claim_name === claim.claim_name &&
      claim.constraints[0].constraint_type === 'equals' && equal(claim.constraints[0].value, expected[claim.claim_name]),
    'policy_claims_mismatch', 'Each required claim must use one exact equality constraint over the retained course value.');
  }
  c.need(trust?.id === policy.trust_profile_id && trust.organization_id === client.organizationId && trust.profile_type === 'CUSTOM' &&
    trust.status === 'active' && equal(trust.allowed_algorithms, ['ES256']) && equal(trust.supported_formats, ['VC_JWT']) &&
    equal(trust.allowed_issuers, [client.issuerDid]) && empty(trust.denied_issuers) && empty(trust.trust_sources),
  'trust_profile_mismatch', 'The active owned CUSTOM trust profile must allow exactly this ES256 VC-JWT issuer without additional trust sources.');
  return { template: c.hash(JSON.stringify(template)), policy: c.hash(JSON.stringify(policy)), trust: c.hash(JSON.stringify(trust)) };
}
function validateRecord(input, record, expectedStatus) {
  c.need(object(record) && record.id === input.credentialId && record.credential_id === input.credentialId &&
    record.organization_id === input.client.organizationId && record.credential_template_id === input.client.credentialTemplateId &&
    record.issuer_did === input.client.issuerDid && record.subject_id === input.body.subject_did && record.credential_hash === input.credentialHash &&
    record.flow_execution_id === input.transactionId && record.application_id == null && record.status === expectedStatus &&
    record.credential_type === 'OpenBadgeCredential' && record.credential_format === 'VC_JWT',
  'public_record_mismatch', 'The public credential record must bind this exact retained artifact, tenant, course, issuer and expected current status.');
  return { id: record.id, organization_id: record.organization_id, credential_template_id: record.credential_template_id,
    issuer_did: record.issuer_did, credential_hash: record.credential_hash, status: record.status, credential_format: record.credential_format };
}
function evaluation(input, value, expectedStatus, now, startedAt) {
  const allow = expectedStatus === 'ACTIVE';
  c.need(value?.policy_id === input.cfg.policyId && value.result === (allow ? 'passed' : 'failed') && value.decision === (allow ? 'allow' : 'deny') &&
    Array.isArray(value.credential_results) && value.credential_results.length === 1 && Number.isFinite(Date.parse(value.evaluation_timestamp)) &&
    Date.parse(value.evaluation_timestamp) >= Date.parse(startedAt) - 30000 && Date.parse(value.evaluation_timestamp) <= now + 30000,
  'policy_evaluation_mismatch', 'Evaluation must come from this saved policy and the current probe window.');
  const item = value.credential_results[0];
  c.need(item.credential_template_id === input.client.credentialTemplateId && item.issuer_did === input.client.issuerDid &&
    item.credential_id === input.credentialId && item.signature_valid === true && item.trust_check_passed === true &&
    item.freshness_check_passed === true && item.revocation_checked === true && item.not_revoked === allow &&
    item.revocation_status === expectedStatus.toLowerCase() && item.satisfied === allow &&
    (allow ? empty(item.error_codes) : equal(item.error_codes, ['credential_revoked'])),
  'status_reason_unproven', 'The authenticated credential must show the exact current active, suspended or revoked status; generic failure is insufficient.');
  return { policyId: value.policy_id, decision: value.decision, result: value.result, status: item.revocation_status,
    signatureValid: true, trustPassed: true, revocationChecked: true, notRevoked: item.not_revoked,
    errorCodes: [...item.error_codes], evaluationTimestamp: value.evaluation_timestamp };
}

async function run(configFile, { request = c.request, now = Date.now } = {}) {
  const input = load(configFile, now());
  const { cfg, client, directory } = input;
  const file = name => path.join(directory, name);
  c.need(!fs.existsSync(file('attempt.json')), 'probe_already_attempted', 'Preserve the previous evidence; this probe cannot restart or repeat.');
  const report = { schema: 'elevenid.ob3-course-scope-lifecycle/v1', state: 'started', startedAt: new Date(now()).toISOString(),
    inputBinding: input.binding, inputSha256: input.hashes, organizationId: client.organizationId, policyId: cfg.policyId,
    credentialId: input.credentialId, transactionId: input.transactionId, credentialSha256: input.credentialHash,
    automaticMutationReplay: false, authorityProvisioned: false, offerRedeemed: false, checks: [] };
  c.writePrivate(file('attempt.json'), { inputBinding: input.binding, startedAt: report.startedAt, revokeLast: true }, true);
  let stage = 'preflight';
  const operator = { Cookie: 'sessionId=' + input.session, Accept: 'application/json' };
  const recordRoute = '/v1/issued-credentials/' + encodeURIComponent(input.credentialId);
  async function call(label, route, options, keyId = null) {
    stage = label;
    const item = { check: label, method: options.method || 'GET', path: route.split('?')[0], keyId,
      requestSha256: options.body === undefined ? null : c.hash(options.body), state: 'requested' };
    report.checks.push(item);
    if (item.method === 'POST') c.writePrivate(file(label + '-requested.json'), item, true);
    const response = await request(cfg, route, options);
    const correlation = response.headers.get('x-correlation-id');
    Object.assign(item, { state: 'responded', httpStatus: response.status,
      correlationId: UUID.test(correlation || '') ? correlation : null,
      correlationSha256: correlation ? c.hash(correlation) : null });
    c.need(response.headers.get('idempotency-replayed') === null,
      'unexpected_cached_response', 'Verification and lifecycle requests must not use an idempotency response cache.');
    return response;
  }
  async function get(label, route) {
    const response = await call(label, route, { headers: operator });
    c.need(response.status === 200 && object(response.json), 'public_read_failed', 'The exact public resource could not be read.');
    return response.json;
  }
  async function resources(label, expectedStatus) {
    const template = await get(label + '-template', '/v1/credential-templates/' + client.credentialTemplateId);
    const policy = await get(label + '-policy', '/v1/presentation-policies/' + cfg.policyId);
    c.need(UUID.test(policy.trust_profile_id), 'policy_trust_missing', 'The saved policy must identify an explicit trust profile.');
    const trust = await get(label + '-trust', '/v1/trust-profiles/' + policy.trust_profile_id);
    const binding = validateResources(input, template, policy, trust);
    c.need(!report.resourceSha256 || equal(report.resourceSha256, binding), 'resources_changed', 'The observed course, policy or trust configuration changed during the probe.');
    report.resourceSha256 = binding;
    report.trustProfileId = trust.id;
    report.lastObservedRecord = validateRecord(input, await get(label + '-credential', recordRoute), expectedStatus);
  }
  async function inventory(label) {
    const response = await call(label, '/v1/api-keys?organization_id=' + client.organizationId + '&limit=500&offset=0', { headers: operator });
    c.need(response.status === 200 && Array.isArray(response.json) && response.json.length < 500,
      'key_inventory_unavailable', 'An authorized complete public key inventory below 500 rows is required.');
    const rows = new Map();
    for (const row of response.json) {
      const meta = metadata(row, client.organizationId);
      c.need(!rows.has(row.id), 'key_inventory_invalid', 'Key UUIDs must be unique.');
      rows.set(row.id, { metadata: meta, usedAt: row.last_used_at ?? null });
    }
    for (const role of ['R', 'V']) {
      const selected = rows.get(input.ids[role]);
      c.need(selected && selected.metadata.enabled === true && selected.metadata.scope_type === 'ORGANIZATION' &&
        selected.metadata.deployment_profile_id === null && equal(selected.metadata.scopes, SCOPES[role]) &&
        (selected.metadata.expires_at === null || Date.parse(selected.metadata.expires_at) > now()),
      'key_grants_mismatch', 'R and V must be active organization keys with their exact distinct scope sets and current lifetimes.');
    }
    return rows;
  }
  let priorKeys;
  function unchangedUsage(before, expectedBefore) {
    const ordered = rows => [...rows].sort(([a], [b]) => a.localeCompare(b));
    c.need(!expectedBefore || equal(ordered(before), ordered(expectedBefore)), 'key_usage_ambiguous', 'Key inventory, grants or usage changed outside the known verification request.');
  }
  async function verify(label, role, expectedStatus) {
    const before = await inventory(label + '-inventory-before');
    unchangedUsage(before, priorKeys);
    const response = await call(label, '/v1/vc-api/credentials/verify?organization_id=' + client.organizationId + '&presentation_policy_id=' + cfg.policyId,
      { method: 'POST', headers: { 'X-API-Key': input.secrets[role], 'Content-Type': 'application/json' },
        body: JSON.stringify({ verifiableCredential: input.jwt, options: {} }) }, input.ids[role]);
    const after = await inventory(label + '-inventory-after');
    c.need(equal([...before.keys()].sort(), [...after.keys()].sort()), 'key_usage_ambiguous', 'Key inventory changed during verification.');
    const changed = [];
    for (const [id, previous] of before) {
      c.need(equal(previous.metadata, after.get(id).metadata), 'key_usage_ambiguous', 'Key grants changed during verification.');
      if (previous.usedAt !== after.get(id).usedAt) changed.push(id);
    }
    const id = input.ids[role], prev = before.get(id).usedAt, next = after.get(id).usedAt;
    c.need(equal(changed, [id]) && next !== null && (prev === null || timestamp(next) > timestamp(prev)),
      'key_usage_ambiguous', 'Only the expected key UUID must advance usage; cache, precision or concurrency ambiguity stops the probe.');
    report.checks.push({ check: label + '-identity', state: 'passed', keyId: id, method: 'public_inventory_usage_observation',
      cryptographicIdentityClaim: false, beforeUsedAt: prev, afterUsedAt: next });
    priorKeys = after;
    if (role === 'R') {
      c.need(response.status === 403, 'scope_boundary_unproven', 'The credentials:read-only key must receive 403 for this exact verification.');
    } else if (expectedStatus === 'ACTIVE') {
      c.need(response.status === 200 && response.json?.verified === true && empty(response.json.problemDetails),
        'verification_allow_missing', 'The combined-scope key must allow this exact active course credential.');
      report.checks.push({ check: label + '-decision', state: 'passed', ...evaluation(input, response.json.results, expectedStatus, now(), report.startedAt) });
    } else {
      c.need(response.status === 422 && response.json?.verified === false && equal(response.json.errors, ['verification_failed']),
        'verification_deny_missing', 'The combined-scope key must reject the current suspended or revoked credential.');
      // The VC-API deliberately omits denial diagnostics. Use the existing human
      // session on the public saved-policy route; do not widen either API key.
      const diagnostic = await call(label + '-operator-evaluate', '/v1/presentation-policies/' + cfg.policyId + '/evaluate',
        { method: 'POST', headers: { ...operator, 'Content-Type': 'application/json' },
          body: JSON.stringify({ vp_token: input.jwt, nonce: null, audience: null }) });
      c.need(diagnostic.status === 200, 'policy_diagnostic_failed', 'The existing operator must evaluate the saved policy to establish the denial reason.');
      report.checks.push({ check: label + '-decision', state: 'passed', ...evaluation(input, diagnostic.json, expectedStatus, now(), report.startedAt) });
    }
  }
  try {
    await resources('initial', 'ACTIVE');
    priorKeys = await inventory('initial-inventory');
    c.need(['R', 'V'].every(role => priorKeys.get(input.ids[role]).usedAt === null),
      'keys_already_used', 'Both scoped verification keys must be fresh and unused before this one-shot probe.');
    report.keys = { R: priorKeys.get(input.ids.R).metadata, V: priorKeys.get(input.ids.V).metadata };
    await verify('read-scope-denied', 'R', 'ACTIVE');
    await verify('combined-scope-allowed', 'V', 'ACTIVE');
    report.scopeBoundaryConfirmed = true;
    for (const [action, before, after] of [['suspend', 'ACTIVE', 'SUSPENDED'], ['reinstate', 'SUSPENDED', 'ACTIVE'], ['revoke', 'ACTIVE', 'REVOKED']]) {
      await resources(action + '-preflight', before);
      unchangedUsage(await inventory(action + '-inventory'), priorKeys);
      const response = await call(action, recordRoute + '/' + action, { method: 'POST', headers: { ...operator, 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason: 'Synthetic course lifecycle qualification: ' + action,
          comments: 'Controlled existing-credential probe ' + input.binding.slice(0, 16) }) });
      c.need(response.status === 200, 'lifecycle_mutation_rejected', 'The lifecycle response differs from the expected public 200 result.');
      validateRecord(input, response.json, after);
      report.lastObservedRecord = validateRecord(input, await get(action + '-record-readback', recordRoute), after);
      await verify(action + '-verification', 'V', after);
    }
    report.terminalRecord = report.lastObservedRecord;
    report.lifecycleConfirmed = true;
    report.state = 'passed';
    report.completedAt = new Date(now()).toISOString();
    c.writePrivate(file('report.json'), report);
    return report;
  } catch (error) {
    report.state = 'stopped';
    report.stoppedAt = new Date(now()).toISOString();
    report.failure = { stage, code: /^[a-z0-9_]{1,90}$/.test(error.code || '') ? error.code : 'probe_step_failed',
      instruction: 'Preserve all evidence and reconcile the last attempted request before any manual continuation.' };
    c.writePrivate(file('report.json'), report);
    throw new c.Stop(report.failure.code, report.failure.instruction);
  }
}

if (require.main === module) (async () => {
  c.runtime();
  c.need(process.argv[2] === 'run' && process.argv.length === 4, 'usage', 'Usage: node probe-scope-lifecycle.cjs run scope-lifecycle-config.json');
  const report = await run(process.argv[3]);
  process.stdout.write(JSON.stringify({ state: report.state, credentialSha256: report.credentialSha256,
    scopeBoundaryConfirmed: true, lifecycleConfirmed: true, terminalStatus: report.terminalRecord.status }) + '\n');
})().catch(error => {
  process.stdout.write(JSON.stringify({ state: 'stopped', code: /^[a-z0-9_]{1,90}$/.test(error.code || '') ? error.code : 'probe_step_failed',
    instruction: 'Preserve private evidence; do not retry, restart or reset this run.' }) + '\n');
  process.exitCode = 1;
});

module.exports = { run, validateResources, validateRecord, evaluation, timestamp };
