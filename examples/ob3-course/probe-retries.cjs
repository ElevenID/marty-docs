#!/usr/bin/env node
'use strict';

// Explicit qualification of one already-successful synthetic issuance.
// This never starts a new event, claims an offer, or retries an unknown result.
const fs = require('node:fs');
const path = require('node:path');
const { isDeepStrictEqual } = require('node:util');
const c = require('./public-client-common.cjs');
const { parseOffer } = require('./ob3-client.cjs');

const SCOPES = ['credentials:issue', 'credentials:read', 'templates:read'];
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const object = value => value && typeof value === 'object' && !Array.isArray(value);
const equal = (a, b) => isDeepStrictEqual(a, b);

function parseRecord(raw, label) {
  let value;
  try { value = JSON.parse(raw); } catch {
    throw new c.Stop('private_record_invalid', 'Retained private JSON is malformed: ' + label + '.');
  }
  c.need(object(value), 'private_record_invalid', 'Retained private JSON must be an object: ' + label + '.');
  return value;
}
function configuration(filename) {
  try { return c.config(filename); } catch (error) {
    if (error instanceof SyntaxError) throw new c.Stop('configuration_invalid', 'Probe or original client configuration contains malformed JSON.');
    throw error;
  }
}
function publicOffer(uri, origin, organizationId) {
  let parsed;
  try {
    const url = new URL(uri);
    if (url.searchParams.getAll('credential_offer').length !== 1 || url.searchParams.has('credential_offer_uri') || url.hash)
      throw new Error('ambiguous offer');
    parsed = parseOffer(uri);
  } catch {
    // parseOffer can encounter private JSON/URL syntax errors before it has
    // registered the capability. Never expose its exception text here.
    throw new c.Stop('public_offer_invalid', 'The retained public offer must contain one valid inline pre-authorized grant.');
  }
  c.remember(uri); c.remember(parsed.code);
  const issuer = c.sameOrigin(parsed.issuer, origin);
  c.need(!issuer.search && issuer.pathname.replace(/\/$/, '').endsWith('/org/' + organizationId) &&
    c.nonempty(parsed.configurationId),
  'public_offer_binding_invalid', 'The public offer must identify this tenant issuer and one named credential configuration.');
  return parsed;
}
function existingDirectory(directory) {
  c.need(fs.existsSync(directory), 'original_state_missing', 'The original successful issuance directory must already exist.');
  return c.privateDir(directory);
}
function timestamp(value) {
  const match = typeof value === 'string' && /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})(?:\.(\d{1,9}))?(?:Z|\+00:00)$/.exec(value);
  c.need(match && Number.isFinite(Date.parse(match[1] + 'Z')), 'key_timestamp_invalid', 'API-key usage must have an unambiguous UTC timestamp.');
  return BigInt(Date.parse(match[1] + 'Z')) * 1000000n + BigInt((match[2] || '').padEnd(9, '0'));
}
function keyMetadata(item, organizationId) {
  c.need(object(item) && UUID.test(item.id) && item.organization_id === organizationId && item.key === undefined,
    'key_inventory_invalid', 'Public key inventory must contain unique tenant-owned metadata without secrets.');
  c.need(Array.isArray(item.scopes) && item.scopes.every(value => typeof value === 'string'),
    'key_inventory_invalid', 'API-key scopes are missing.');
  timestamp(item.created_at);
  if (item.expires_at != null) timestamp(item.expires_at);
  if (item.last_used_at != null) timestamp(item.last_used_at);
  return { id: item.id, organization_id: item.organization_id, scopes: [...item.scopes].sort(),
    enabled: item.enabled, expires_at: item.expires_at ?? null, scope_type: item.scope_type,
    deployment_profile_id: item.deployment_profile_id ?? null, created_at: item.created_at };
}
function validateSelectedKey(item, organizationId, now) {
  const metadata = keyMetadata(item, organizationId);
  c.need(metadata.enabled === true && metadata.scope_type === 'ORGANIZATION' && metadata.deployment_profile_id === null &&
    equal(metadata.scopes, SCOPES) && (metadata.expires_at === null || Date.parse(metadata.expires_at) > now),
  'key_grants_mismatch', 'Both keys must be active organization keys with the exact course scopes and a current lifetime.');
  return metadata;
}
function loadInputs(configFile) {
  c.need(c.nonempty(configFile), 'configuration_required', 'Supply a retry-probe configuration file.');
  const cfg = configuration(configFile);
  for (const field of ['clientConfigFile', 'primaryKeyFile', 'secondaryKeyFile', 'operatorSessionFile', 'probeStateDirectory'])
    c.need(c.nonempty(cfg[field]), 'configuration_required', 'Configure all client, key, session and evidence file locations.', { field });
  const client = configuration(c.resolveFile(cfg, cfg.clientConfigFile));
  c.need(cfg.origin === client.origin && client.authMode === 'api-key' && UUID.test(client.organizationId) &&
    UUID.test(cfg.primaryKeyId) && UUID.test(cfg.secondaryKeyId) && cfg.primaryKeyId !== cfg.secondaryKeyId,
  'probe_binding_invalid', 'Configure the original API-key client and two distinct key UUIDs on its HTTPS origin.');
  const original = existingDirectory(c.resolveFile(client, client.stateDirectory));
  const directory = c.privateDir(c.resolveFile(cfg, cfg.probeStateDirectory));
  c.need(directory !== original && !directory.startsWith(original + path.sep),
    'probe_directory_invalid', 'Probe evidence must use a separate private directory outside original issuance state.');
  const inputs = {};
  const read = filename => {
    const raw = c.readPrivate(path.join(original, filename));
    inputs[filename] = c.hash(raw);
    return parseRecord(raw, filename);
  };
  const journal = read('issuance-requested.json');
  const initial = read('issuance-response.json');
  const offer = read('offer-private.json');
  const body = journal.body;
  c.need(object(body) && body.organization_id === client.organizationId && body.credential_template_id === client.credentialTemplateId &&
    body.issuer_did === client.issuerDid && c.nonempty(body.subject_did) && body.holder_did === body.subject_did &&
    object(body.credential_subject) && body.credential_subject.id === body.subject_did &&
    body.credential_subject.learner_id === client.learnerId && body.credential_subject.achievement?.id === client.achievementId &&
    equal(Object.keys(body).sort(), ['credential_subject', 'credential_template_id', 'holder_did', 'issuer_did', 'organization_id', 'subject_did']),
  'original_request_invalid', 'The journal must contain the original direct course request with no added client/application fields.');
  c.need(typeof journal.completionEventId === 'string' && /^[A-Za-z0-9._:-]{1,128}$/.test(journal.completionEventId) &&
    journal.completionEventId === client.completionEventId,
  'original_event_invalid', 'Use the unchanged original completion-event Idempotency-Key.');
  c.need(Number.isInteger(initial.status) && initial.status >= 200 && initial.status < 300 && object(initial.body) && equal(initial.body, offer) &&
    UUID.test(offer.id) && offer.organization_id === client.organizationId && offer.credential_template_id === client.credentialTemplateId &&
    c.nonempty(offer.credential_offer_uri) && object(offer.credential_offer_uris) && object(offer.credential_offer_labels) && Number.isFinite(Date.parse(offer.expires_at)),
  'original_success_required', 'A successful original response and its matching retained offer are required; unknown issuance cannot be probed.');
  const parsedOffer = publicOffer(offer.credential_offer_uri, cfg.origin, client.organizationId);
  const captured = journal.requestBody !== undefined || journal.requestBodySha256 !== undefined;
  const wire = captured ? journal.requestBody : JSON.stringify(body);
  c.need(typeof wire === 'string' && (!captured || c.hash(wire) === journal.requestBodySha256),
    'original_wire_invalid', 'Captured original request bytes must have their unchanged SHA-256.');
  let parsed;
  try { parsed = JSON.parse(wire); } catch { throw new c.Stop('original_wire_invalid', 'Original request bytes must contain valid JSON.'); }
  c.need(equal(parsed, body), 'original_wire_invalid', 'Captured bytes and the original journal body differ.');
  const primary = c.remember(c.readPrivate(c.resolveFile(cfg, cfg.primaryKeyFile), 16384).trim());
  const secondary = c.remember(c.readPrivate(c.resolveFile(cfg, cfg.secondaryKeyFile), 16384).trim());
  c.need(/^(mk|pk)_(test|live)_\S+$/.test(primary) && /^(mk|pk)_(test|live)_\S+$/.test(secondary) && primary !== secondary,
    'key_secrets_invalid', 'Retain two distinct organization API-key secrets in private files.');
  const session = c.sessionValue(c.resolveFile(cfg, cfg.operatorSessionFile));
  const changed = structuredClone(body);
  changed.credential_subject.learner_id = 'synthetic-idempotency-conflict-' + c.hash(journal.completionEventId).slice(0, 16);
  c.need(changed.credential_subject.learner_id !== body.credential_subject.learner_id,
    'conflict_subject_collision', 'The synthetic conflict marker unexpectedly equals the original learner.');
  const binding = c.hash(JSON.stringify({ origin: cfg.origin, organizationId: client.organizationId,
    primaryKeyId: cfg.primaryKeyId, secondaryKeyId: cfg.secondaryKeyId, inputs, requestHash: c.hash(wire) }));
  return { cfg, client, directory, journal, offer, parsedOffer, wire, conflictWire: JSON.stringify(changed), primary, secondary, session, binding,
    wireSource: captured ? 'captured_original_request_bytes' : 'legacy_helper_JSON.stringify_reconstruction' };
}

async function runPhase(phase, configFile, { request = c.request, now = Date.now } = {}) {
  c.need(phase === 'warm' || phase === 'durable', 'phase_invalid', 'Choose warm or durable; neither phase may be repeated.');
  const input = loadInputs(configFile);
  const { cfg, client, directory, offer } = input;
  const file = name => path.join(directory, name);
  const report = { schema: 'elevenid.ob3-retry-probe/v1', phase, state: 'started', startedAt: new Date(now()).toISOString(),
    inputBinding: input.binding, organizationId: client.organizationId, transactionId: c.sanitize(offer.id),
    originalRequestSha256: c.hash(input.wire), conflictRequestSha256: c.hash(input.conflictWire),
    eventKeySha256: c.hash(input.journal.completionEventId), wireSource: input.wireSource,
    automaticMutationReplay: false, offerRedeemed: false, nativeMaintenanceVerified: false, checks: [] };
  let warm;
  if (phase === 'durable') {
    warm = parseRecord(c.readPrivate(file('warm-report.json')), 'warm-report.json');
    c.need(warm.state === 'passed' && warm.inputBinding === input.binding && warm.phase === 'warm',
      'warm_evidence_required', 'The same original inputs and a completed warm phase are required.');
    c.need(c.nonempty(cfg.maintenanceReceiptFile), 'maintenance_receipt_required', 'Retain the supported native pause/resume receipt before the durable phase.');
    const receipt = c.readPrivate(c.resolveFile(cfg, cfg.maintenanceReceiptFile));
    c.need(receipt.trim().length > 0, 'maintenance_receipt_required', 'The native maintenance receipt must be nonempty.');
    report.maintenanceReceiptSha256 = c.hash(receipt);
  }
  // Claim the whole phase before any network work. Failure, including a timeout,
  // never makes a phase or a planned POST eligible for automatic reuse.
  c.need(!fs.existsSync(file(phase + '-attempt.json')), 'phase_already_attempted', 'Preserve this phase evidence and reconcile it; do not reset or repeat the probe.');
  c.writePrivate(file(phase + '-attempt.json'), { phase, inputBinding: input.binding, startedAt: report.startedAt }, true);
  let stage = 'key-inventory';
  async function call(label, route, options, keyId = null) {
    stage = label;
    const item = { check: label, method: options.method || 'GET', path: route.split('?')[0], keyId,
      requestSha256: options.body === undefined ? null : c.hash(options.body), state: 'requested' };
    report.checks.push(item);
    if (item.method === 'POST') c.writePrivate(file(phase + '-' + label + '-requested.json'), item, true);
    const response = await request(cfg, route, options);
    Object.assign(item, { state: 'responded', httpStatus: response.status,
      correlationId: c.sanitize(response.headers.get('x-correlation-id')),
      idempotencyReplayed: response.headers.get('idempotency-replayed') == null ? null : c.sanitize(response.headers.get('idempotency-replayed')) });
    if (object(response.json) && UUID.test(response.json.id)) item.responseId = response.json.id;
    return response;
  }
  async function inventory(label) {
    const response = await call(label, '/v1/api-keys?organization_id=' + encodeURIComponent(client.organizationId) + '&limit=500&offset=0',
      { headers: { Cookie: 'sessionId=' + input.session, Accept: 'application/json' } });
    c.need(response.status === 200 && Array.isArray(response.json) && response.json.length < 500,
      'key_inventory_unavailable', 'The authorized public key inventory must be complete and contain fewer than 500 keys.');
    const rows = new Map();
    for (const item of response.json) {
      const metadata = keyMetadata(item, client.organizationId);
      c.need(!rows.has(item.id), 'key_inventory_invalid', 'API-key UUIDs must be unique.');
      rows.set(item.id, { metadata, usedAt: item.last_used_at ?? null });
    }
    for (const id of [cfg.primaryKeyId, cfg.secondaryKeyId]) {
      const selected = response.json.find(item => item.id === id);
      c.need(selected, 'key_inventory_missing', 'A selected key UUID is absent from the current public inventory.');
      validateSelectedKey(selected, client.organizationId, now());
    }
    return rows;
  }
  async function observeKey(label, keyId, secret, before) {
    const response = await call(label + '-template-read', '/v1/credential-templates/' + encodeURIComponent(client.credentialTemplateId) +
      '?organization_id=' + encodeURIComponent(client.organizationId), { headers: { 'X-API-Key': secret, Accept: 'application/json' } }, keyId);
    c.need(response.status === 200 && response.json?.id === client.credentialTemplateId && response.json?.organization_id === client.organizationId &&
      response.json?.issuer_did === client.issuerDid && String(response.json?.status).toUpperCase() === 'ACTIVE' &&
      response.json?.credential_type === input.parsedOffer.configurationId &&
      ['VC_JWT', 'JWT_VC', 'JWT_VC_JSON'].includes(String(response.json?.credential_payload_format).toUpperCase()),
    'key_template_read_failed', 'The selected key must read the exact active course template, issuer and offered VC-JWT configuration.');
    const after = await inventory(label + '-inventory-after');
    c.need(equal([...before.keys()].sort(), [...after.keys()].sort()), 'key_usage_ambiguous', 'The key inventory changed during the observation.');
    const changed = [];
    for (const [id, previous] of before) {
      const current = after.get(id);
      c.need(equal(previous.metadata, current.metadata), 'key_usage_ambiguous', 'Key ownership or grants changed during the observation.');
      if (previous.usedAt !== current.usedAt) changed.push(id);
    }
    const prior = before.get(keyId).usedAt;
    const current = after.get(keyId).usedAt;
    c.need(equal(changed, [keyId]) && current !== null && (prior === null || timestamp(current) > timestamp(prior)),
      'key_usage_ambiguous', 'Exactly the expected key UUID must advance its usage timestamp; cache, clock precision or concurrent usage is inconclusive.');
    report.checks.push({ check: label + '-identity-observation', state: 'passed', keyId,
      method: 'public_inventory_usage_observation', cryptographicIdentityClaim: false, beforeUsedAt: prior, afterUsedAt: current });
    return after;
  }
  async function post(label, keyId, secret, body, expectedStatus, expectedReplay) {
    const response = await call(label, '/v1/issuance', { method: 'POST', headers: {
      'X-API-Key': secret, 'Content-Type': 'application/json', 'Idempotency-Key': input.journal.completionEventId,
    }, body }, keyId);
    c.need((expectedStatus === 'success' ? response.status >= 200 && response.status < 300 : response.status === expectedStatus) &&
      response.headers.get('idempotency-replayed') === expectedReplay,
    'retry_result_unexpected', 'Issuance status or replay header differs from the explicit phase expectation; stop and reconcile.');
    if (expectedStatus === 409) {
      const gateway = label === 'warm-conflict';
      c.need(gateway ? response.json?.error === 'idempotency_conflict' :
        response.json?.detail === 'idempotency key was already used for a different issuance request',
      'conflict_boundary_unproven', 'Expected the specific gateway or durable issuance conflict; a generic or in-progress 409 is insufficient.');
      report.checks.at(-1).conflictBoundary = gateway ? 'gateway' : 'durable_issuance';
    }
    if (expectedStatus === 'success') {
      const value = response.json;
      c.need(object(value), 'durable_transaction_mismatch', 'Replay must return the public issuance response object.');
      const parsedOffer = publicOffer(value.credential_offer_uri, cfg.origin, client.organizationId);
      c.need(object(value) && value.id === offer.id && value.organization_id === offer.organization_id &&
        value.credential_template_id === offer.credential_template_id && Date.parse(value.expires_at) === Date.parse(offer.expires_at) &&
        value.credential_offer_uri === offer.credential_offer_uri && equal(parsedOffer, input.parsedOffer) &&
        equal(value.credential_offer_uris, offer.credential_offer_uris) && equal(value.credential_offer_labels, offer.credential_offer_labels),
      'durable_transaction_mismatch', 'Replay must preserve the committed transaction, tenant, template, offer capability and expiry.');
      // The transaction can progress from pending to issued between phases.
      // A cached response may describe an older state, so do not equate snapshots.
      report.checks.at(-1).transactionStatus = c.sanitize(value.status);
    }
  }
  try {
    let keys = await inventory('inventory-before');
    if (phase === 'warm') {
      c.need(keys.get(cfg.secondaryKeyId).usedAt === null, 'secondary_key_already_used', 'Key B must be newly created and unused before this probe.');
      keys = await observeKey('primary-key', cfg.primaryKeyId, input.primary, keys);
      keys = await observeKey('secondary-key', cfg.secondaryKeyId, input.secondary, keys);
      report.primaryKey = keys.get(cfg.primaryKeyId).metadata;
      report.secondaryKey = keys.get(cfg.secondaryKeyId).metadata;
      report.secondaryLastUsedAt = keys.get(cfg.secondaryKeyId).usedAt;
      await post('warm-replay', cfg.primaryKeyId, input.primary, input.wire, 'success', 'true');
      await post('warm-conflict', cfg.primaryKeyId, input.primary, input.conflictWire, 409, null);
      keys = await inventory('warm-inventory-final');
      c.need(keys.get(cfg.secondaryKeyId).usedAt === report.secondaryLastUsedAt && equal(keys.get(cfg.secondaryKeyId).metadata, report.secondaryKey),
        'secondary_key_used_during_probe', 'Key B changed or was used outside its known read-only observation.');
      report.gatewayWarmReplayConfirmed = true;
    } else {
      c.need(equal(keys.get(cfg.primaryKeyId).metadata, warm.primaryKey) && equal(keys.get(cfg.secondaryKeyId).metadata, warm.secondaryKey) &&
        keys.get(cfg.secondaryKeyId).usedAt === warm.secondaryLastUsedAt,
      'secondary_key_used_between_phases', 'Key grants changed or key B was used between phases; its cold namespace is no longer established.');
      keys = await observeKey('secondary-key', cfg.secondaryKeyId, input.secondary, keys);
      report.primaryKey = warm.primaryKey;
      report.secondaryKey = keys.get(cfg.secondaryKeyId).metadata;
      await post('durable-conflict-first', cfg.secondaryKeyId, input.secondary, input.conflictWire, 409, null);
      await post('durable-replay', cfg.secondaryKeyId, input.secondary, input.wire, 'success', 'false');
      await post('secondary-cached-replay', cfg.secondaryKeyId, input.secondary, input.wire, 'success', 'true');
      report.durableRecoveryConfirmed = true;
      report.cacheBoundary = 'previously unused per-principal namespace; not Redis deletion or restart inference';
    }
    const secret = phase === 'warm' ? input.primary : input.secondary;
    const id = phase === 'warm' ? cfg.primaryKeyId : cfg.secondaryKeyId;
    const transaction = await call('transaction-readback', '/v1/issuance/' + encodeURIComponent(offer.id),
      { headers: { 'X-API-Key': secret, Accept: 'application/json' } }, id);
    c.need(transaction.status === 200 && transaction.json?.id === offer.id && transaction.json?.organization_id === client.organizationId &&
      transaction.json?.credential_template_id === client.credentialTemplateId,
    'transaction_readback_mismatch', 'Public transaction readback must match the original tenant and template.');
    report.currentTransactionStatus = c.sanitize(transaction.json.status);
    report.state = 'passed';
    report.finishedAt = new Date(now()).toISOString();
    c.writePrivate(file(phase + '-report.json'), report, true);
    return report;
  } catch (error) {
    report.state = 'stopped';
    report.failure = c.failure(error, stage);
    c.writePrivate(file(phase + '-report.json'), report, true);
    throw error;
  }
}

if (require.main === module) {
  Promise.resolve().then(() => { c.runtime(); return runPhase(process.argv[2], process.argv[3]); })
    .then(report => process.stdout.write(JSON.stringify(report) + '\n'))
    .catch(error => { process.stderr.write(JSON.stringify(c.failure(error, 'retry-probe')) + '\n'); process.exitCode = 1; });
}
module.exports = { runPhase, loadInputs, timestamp };
