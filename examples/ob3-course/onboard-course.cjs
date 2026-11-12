#!/usr/bin/env node
'use strict';

// Public operator setup for the single-tenant installer trial.
// All create/activate requests are journaled before sending. No retries.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { didWebUrl } = require('./ob3-client.cjs');
const c = require('./public-client-common.cjs');
const SOURCE = 'ElevenID/marty-ui@b7c7055830722d10512ccac042b1e0abe0e1ecec';
const SCOPES = ['templates:read', 'credentials:issue', 'credentials:read'];
let stage = 'configuration';
let directory;
let report;

function active(value) { return String(value || '').toUpperCase() === 'ACTIVE'; }
function badge(value) { return ['OPEN_BADGE', 'OPEN_BADGE_V3', 'OPENBADGECREDENTIAL'].includes(String(value || '').toUpperCase()); }
function vcJwt(value) { return ['VC_JWT', 'JWT_VC', 'JWT_VC_JSON'].includes(String(value || '').toUpperCase()); }
function file(name) { return path.join(directory, name); }
function save(name, value, exclusive = false) { c.writePrivate(file(name), value, exclusive); }
function event(check, detail = {}) {
  const item = { at: new Date().toISOString(), check, outcome: 'passed', ...detail };
  report.checks.push(item); save('onboarding-report.json', report);
  process.stdout.write(JSON.stringify(item) + '\n');
}
function exactOne(values, code, message) {
  c.need(values.length === 1, code, message, { matchingCount: values.length, candidateIds: values.map(x => x.id).filter(c.nonempty).slice(0, 20) });
  return values[0];
}
function makeSubject(cfg) {
  return { type: ['AchievementSubject'], learner_id: cfg.learnerId,
    achievement: { id: cfg.achievementId, type: ['Achievement'], name: cfg.courseName,
      description: cfg.courseDescription, criteria: { narrative: cfg.criteriaNarrative } } };
}
function expectedTemplate(cfg, binding) {
  return { organization_id: binding.organizationId, name: cfg.courseName, description: cfg.courseDescription,
    credential_type: 'OpenBadgeCredential', compliance_profile_id: binding.complianceProfileId,
    issuer_did: binding.issuerDid, vct: cfg.achievementId, credential_payload_format: 'VC_JWT',
    supported_formats: ['VC_JWT'], issuance_protocol: 'OID4VCI_PRE_AUTH',
    trust_profile_id: binding.trustProfileId, revocation_profile_id: binding.revocationProfileId,
    claims: [
      { name: 'learner_id', display: { label: 'Learner ID' }, type: 'STRING', required: true, selectively_disclosable: false },
      { name: 'achievement', display: { label: 'Achievement' }, type: 'OBJECT', required: true, selectively_disclosable: false },
    ], privacy_posture: { default_disclose_all: true, prefer_predicates: false } };
}
function checkTemplate(template, expected, bootstrapId) {
  c.need(c.nonempty(template.id) && template.id !== bootstrapId, 'course_template_identity', 'Course template must be separate from the bootstrap membership template.');
  for (const field of ['organization_id', 'name', 'issuer_did', 'vct', 'compliance_profile_id', 'trust_profile_id', 'revocation_profile_id', 'issuance_protocol'])
    c.need(template[field] === expected[field], 'course_template_mismatch', 'Existing course template differs from the explicit setup.', { field });
  c.need(badge(template.credential_type) && vcJwt(template.credential_payload_format),
    'course_template_format_mismatch', 'Course template must be Open Badges with VC_JWT.');
  for (const wanted of expected.claims) {
    const claim = (template.claims || []).find(x => x.name === wanted.name);
    c.need(claim && String(claim.type || claim.claim_type).toUpperCase() === wanted.type &&
      claim.required === true && claim.selectively_disclosable === false,
    'course_template_claim_mismatch', 'Course template claim definitions differ from the explicit setup.', { claim: wanted.name });
  }
}
function checkApiKeyExpiry(metadata, creationRequest, lifetimeHours, now = Date.now()) {
  const timestamp = value => typeof value === 'string' && value.trim() ? Date.parse(value) : NaN;
  const requestedAt = timestamp(creationRequest?.at);
  const requestedExpiry = timestamp(creationRequest?.body?.expires_at);
  const actualExpiry = timestamp(metadata?.expires_at);
  c.need(Number.isInteger(lifetimeHours) && lifetimeHours >= 1 && lifetimeHours <= 168 &&
    Number.isFinite(now) && Number.isFinite(requestedAt) && requestedAt <= now &&
    creationRequest?.method === 'POST' && typeof creationRequest?.route === 'string' &&
    creationRequest.route.split('?')[0] === '/v1/api-keys' &&
    Number.isFinite(requestedExpiry) && requestedExpiry > requestedAt &&
    requestedExpiry - requestedAt <= lifetimeHours * 3600000,
  'client_key_expiry_unproven', 'The retained API-key creation journal must prove the configured bounded lifetime.');
  c.need(Number.isFinite(actualExpiry) && actualExpiry > now && actualExpiry <= requestedExpiry,
    'client_key_expiry_mismatch', 'Client key must have a finite future expiry no later than its retained creation request.');
}
function retainedApiKeyRequest() {
  const journal = file('api-key-create-requested.json');
  c.need(fs.existsSync(journal), 'client_key_expiry_unproven',
    'The original API-key creation journal is required to verify the retained key lifetime.');
  return c.readJson(journal);
}
function prepareConfig(configPath) {
  const cfg = c.config(configPath);
  cfg.expectedOrganizationDisplayName = cfg.expectedOrganizationDisplayName || 'Canyon Skills Academy';
  cfg.courseName = cfg.courseName || 'Workplace Safety Foundations';
  cfg.courseDescription = cfg.courseDescription || "Completed Canyon Skills Academy's synthetic workplace safety workshop and assessment.";
  cfg.criteriaNarrative = cfg.criteriaNarrative || 'Complete the workshop and score at least 80 percent on the practical assessment.';
  cfg.achievementId = cfg.achievementId || 'https://canyon-skills.example/achievements/workplace-safety-foundations';
  cfg.learnerId = cfg.learnerId || 'synthetic-learner-a';
  cfg.completionEventId = cfg.completionEventId || 'canyon-safety-learner-a-completion-001';
  cfg.apiKeyName = cfg.apiKeyName || 'canyon-course-client';
  cfg.apiKeyExpiresHours = cfg.apiKeyExpiresHours || 24;
  c.need(Number.isInteger(cfg.apiKeyExpiresHours) && cfg.apiKeyExpiresHours >= 1 && cfg.apiKeyExpiresHours <= 168,
    'key_lifetime_invalid', 'apiKeyExpiresHours must be 1–168.');
  for (const field of ['expectedOrganizationDisplayName', 'courseName', 'courseDescription', 'criteriaNarrative', 'achievementId', 'learnerId', 'completionEventId', 'apiKeyName'])
    c.need(c.nonempty(cfg[field]) && !cfg[field].includes('REPLACE'), 'configuration_missing', 'Replace the required setup value.', { field });
  try { new URL(cfg.achievementId); } catch { throw new c.Stop('achievement_uri_invalid', 'achievementId must be an absolute URI.'); }
  directory = c.privateDir(c.resolveFile(cfg, cfg.stateDirectory || 'private-onboarding'));
  const binding = c.hash(JSON.stringify(cfg));
  report = fs.existsSync(file('onboarding-report.json')) ? c.readJson(file('onboarding-report.json')) :
    { schema: 'elevenid.ob3-operator-setup/v1', source: SOURCE, configBinding: binding, checks: [], automaticMutationReplay: false };
  c.need(report.configBinding === binding, 'state_configuration_mismatch', 'Onboarding state belongs to another configuration; preserve it and use a new state directory.');
  const sessionPath = process.env.MARTY_SESSION_ID_FILE || c.resolveFile(cfg, cfg.sessionFile || 'private-operator/session-id.txt');
  const session = c.sessionValue(sessionPath);
  return { cfg, session };
}
async function execute(command, configPath) {
  const { cfg, session } = prepareConfig(configPath);
  async function api(method, route, body, headers = {}) {
    const response = await c.request(cfg, route, { method, headers: {
      Accept: 'application/json', Cookie: 'sessionId=' + session,
      ...(body === undefined ? {} : { 'Content-Type': 'application/json', Origin: cfg.origin }), ...headers,
    }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    if (response.status < 200 || response.status >= 300)
      save('last-failed-response.json', { stage, status: response.status, body: response.json || response.raw });
    return c.requireJson(response, 'operator_api_rejected');
  }
  async function mutate(label, route, body, headers = {}) {
    const journal = label + '-requested.json';
    c.need(!fs.existsSync(file(journal)), 'mutation_already_attempted', 'A prior mutation is journaled. Reconcile its observable result before another attempt.', { operation: label });
    save(journal, { at: new Date().toISOString(), method: 'POST', route, body, headers }, true);
    const result = await api('POST', route, body, headers);
    // Key material is written separately immediately after its successful response.
    if (label !== 'api-key-create') save(label + '-response.json', result, true);
    return result;
  }

  stage = 'authenticated-operator';
  const me = await api('GET', '/v1/auth/me');
  c.need(c.operatorMatches(me, cfg.operatorEmail), 'operator_mismatch', 'Normal session does not identify the configured installation operator.');
  event('normal-operator-session-confirmed');

  stage = 'customer-inventory';
  const organizations = await api('GET', '/v1/organizations/mine');
  c.need(Array.isArray(organizations), 'organization_inventory_invalid', 'Expected an organization array.');
  const org = exactOne(organizations.filter(x =>
    x.display_name === cfg.expectedOrganizationDisplayName &&
    (!cfg.expectedOrganizationId || x.id === cfg.expectedOrganizationId)),
  'customer_organization_ambiguous', 'Expected exactly one configured bootstrap customer organization.');
  c.need(c.nonempty(org.id) && active(org.status) &&
    (org.membership?.is_owner === true || org.membership?.has_org_console_access === true),
  'customer_membership_invalid', 'Operator must have active customer organization console access.');
  c.need(active(org.membership?.status), 'customer_membership_inactive', 'Customer organization membership is not active.');
  const scope = '?organization_id=' + encodeURIComponent(org.id);
  const templates = await api('GET', '/v1/credential-templates' + scope);
  const trusts = await api('GET', '/v1/trust-profiles' + scope);
  const revocations = await api('GET', '/v1/revocation-profiles' + scope);
  c.need([templates, trusts, revocations].every(Array.isArray), 'profile_inventory_invalid', 'Expected template, trust and revocation arrays.');
  const prior = fs.existsSync(file('binding.json')) ? c.readJson(file('binding.json')) : null;
  const bootstrapId = cfg.bootstrapCredentialTemplateId || prior?.bootstrapCredentialTemplateId;
  const bootstrap = exactOne(templates.filter(x => x.organization_id === org.id &&
    (bootstrapId ? x.id === bootstrapId : badge(x.credential_type) && active(x.status) &&
      vcJwt(x.credential_payload_format) && x.vct !== cfg.achievementId)),
  'bootstrap_template_ambiguous', 'Select exactly one owned bootstrap OB3 template; configure bootstrapCredentialTemplateId when necessary.');
  c.need(badge(bootstrap.credential_type) && c.nonempty(bootstrap.issuer_did) &&
    c.nonempty(bootstrap.compliance_profile_id), 'bootstrap_template_invalid', 'Bootstrap template lacks OB3 issuer or compliance metadata.');
  const issuerDid = cfg.issuerDid || bootstrap.issuer_did;
  c.need(issuerDid === bootstrap.issuer_did, 'bootstrap_issuer_mismatch', 'Configured issuer DID differs from the bootstrap customer issuer.');
  c.sameOrigin(didWebUrl(issuerDid), cfg.origin);
  const trust = exactOne(trusts.filter(x => x.id === bootstrap.trust_profile_id && x.organization_id === org.id && active(x.status)),
    'owned_trust_profile_missing', 'Bootstrap trust profile must be active and customer-owned.');
  const revocation = exactOne(revocations.filter(x => x.id === bootstrap.revocation_profile_id && x.organization_id === org.id && active(x.status)),
    'owned_revocation_profile_missing', 'Bootstrap revocation profile must be active and customer-owned.');
  const compliance = await api('GET', '/v1/compliance-profiles/' + encodeURIComponent(bootstrap.compliance_profile_id));
  c.need(compliance.id === bootstrap.compliance_profile_id, 'compliance_profile_mismatch', 'OB3 compliance profile readback differs from the bootstrap reference.');
  const binding = { organizationId: org.id, bootstrapCredentialTemplateId: bootstrap.id, issuerDid,
    complianceProfileId: compliance.id, trustProfileId: trust.id, revocationProfileId: revocation.id };
  if (prior) c.need(JSON.stringify(binding) === JSON.stringify(prior), 'runtime_binding_changed', 'Observed runtime ownership or profile bindings changed; stop and inspect the prior state.');
  else save('binding.json', binding, true);
  save('inventory.json', { at: new Date().toISOString(), organization: org, bootstrapTemplate: bootstrap, trust, revocation, compliance });
  event('owned-customer-inventory-confirmed', { organizationId: org.id, bootstrapCredentialTemplateId: bootstrap.id });

  const issuerRoute = '/v1/signing-keys/issuer-identities' + scope;
  let identities = (await api('GET', issuerRoute)).identities;
  c.need(Array.isArray(identities), 'issuer_inventory_invalid', 'Expected an identities array from the managed issuer inventory.');
  // The same DID and purpose may serve multiple credential formats. Match the
  // complete managed identity tuple within this organization-scoped inventory.
  const sameFormat = x => x.issuer_did === issuerDid && x.key_purpose === 'vc_jwt_issuer' &&
    x.credential_format === 'VC_JWT';
  const matching = items => items.filter(x => sameFormat(x) && x.algorithm === 'ES256' && active(x.status) &&
    (x.organization_id == null || x.organization_id === org.id));
  c.need(matching(identities).length <= 1, 'managed_issuer_ambiguous', 'More than one active ES256 VC_JWT identity matches the customer issuer.');
  c.need(matching(identities).length > 0 || !identities.some(sameFormat),
    'managed_issuer_mismatch', 'An existing VC_JWT issuer has an incompatible algorithm, status or organization binding. Reconcile it before creating another identity.');
  if (matching(identities).length) {
    const existing = matching(identities)[0];
    c.need(active(existing.status) && existing.credential_format === 'VC_JWT' && existing.algorithm === 'ES256' &&
      (existing.organization_id == null || existing.organization_id === org.id),
    'managed_issuer_mismatch', 'Existing managed issuer does not match the active ES256 VC_JWT customer binding.');
  }
  const expected = expectedTemplate(cfg, binding);
  let courses = templates.filter(x => x.organization_id === org.id && (x.vct === cfg.achievementId || x.name === cfg.courseName));
  c.need(courses.length <= 1, 'course_template_ambiguous', 'Multiple templates match the requested course identity.');
  if (courses.length) {
    checkTemplate(courses[0], expected, bootstrap.id);
    c.need(active(courses[0].status) || String(courses[0].status).toUpperCase() === 'DRAFT',
      'course_template_status', 'Existing course template must be DRAFT or ACTIVE.');
  }
  const keys = await api('GET', '/v1/api-keys' + scope + '&limit=100&offset=0');
  c.need(Array.isArray(keys), 'key_inventory_invalid', 'Expected an API-key metadata array.');
  const namedKeys = keys.filter(x => x.name === cfg.apiKeyName);
  c.need(namedKeys.length <= 1, 'client_key_ambiguous', 'Multiple keys have the requested client key name.');
  if (command === 'provision') {
    if (namedKeys.length) {
      c.need(fs.existsSync(file('client-api-key.txt')) && fs.existsSync(file('client-api-key-metadata.json')),
        'existing_key_secret_unavailable', 'A named key already exists without this run’s retained secret. Inspect it before changing other resources.');
      const metadata = c.readJson(file('client-api-key-metadata.json'));
      c.need(metadata.id === namedKeys[0].id && namedKeys[0].organization_id === org.id && namedKeys[0].enabled === true &&
        Array.isArray(namedKeys[0].scopes) && namedKeys[0].scopes.length === SCOPES.length &&
        SCOPES.every(scope => namedKeys[0].scopes.includes(scope)),
      'client_key_metadata_mismatch', 'Existing client key differs from the retained identity, scope or lifetime.');
      checkApiKeyExpiry(namedKeys[0], retainedApiKeyRequest(), cfg.apiKeyExpiresHours);
    }
    for (const [label, resultObserved] of [
      ['issuer-create', matching(identities).length === 1],
      ['course-template-create', courses.length === 1],
      ['course-template-activate', active(courses[0]?.status)],
      ['api-key-create', namedKeys.length === 1],
    ]) c.need(resultObserved || !fs.existsSync(file(label + '-requested.json')),
      'mutation_already_attempted', 'A prior mutation lacks a matching observable result. Stop before any further changes.', { operation: label });
  }
  save('provisioning-plan.json', { binding, issuerCreateNeeded: matching(identities).length === 0,
    courseTemplateCreateNeeded: courses.length === 0, courseTemplateId: courses[0]?.id || null,
    courseTemplateActivationNeeded: !active(courses[0]?.status), apiKeyCreateNeeded: namedKeys.length === 0, templateRequest: expected });
  if (command === 'inspect') {
    event('read-only-provisioning-plan-ready');
    report.lastCommand = command; report.lastCommandResult = 'passed'; save('onboarding-report.json', report);
    return;
  }

  stage = 'managed-issuer';
  if (!matching(identities).length) {
    await mutate('issuer-create', issuerRoute, { organization_id: org.id, issuer_did: issuerDid,
      key_purpose: 'vc_jwt_issuer', credential_format: 'VC_JWT', algorithm: 'ES256' },
    { 'Idempotency-Key': crypto.randomUUID() });
    identities = (await api('GET', issuerRoute)).identities;
    c.need(Array.isArray(identities), 'issuer_inventory_invalid', 'Issuer readback omitted the identities array.');
  }
  const issuer = exactOne(matching(identities), 'managed_issuer_missing', 'Exactly one managed issuer is required.');
  c.need(active(issuer.status) && issuer.credential_format === 'VC_JWT' && issuer.algorithm === 'ES256' &&
    (issuer.organization_id == null || issuer.organization_id === org.id),
  'managed_issuer_mismatch', 'Managed issuer must be active, organization-bound, ES256 and VC_JWT.');
  save('managed-issuer.json', issuer);
  event('managed-issuer-ready');

  stage = 'course-template';
  let course = courses[0];
  if (!course) course = await mutate('course-template-create', '/v1/credential-templates', expected);
  checkTemplate(course, expected, bootstrap.id);
  c.need(active(course.status) || String(course.status).toUpperCase() === 'DRAFT', 'course_template_status', 'Course template must be DRAFT or ACTIVE.');
  if (!active(course.status)) await mutate('course-template-activate',
    '/v1/credential-templates/' + encodeURIComponent(course.id) + '/activate' + scope, {});
  course = await api('GET', '/v1/credential-templates/' + encodeURIComponent(course.id));
  checkTemplate(course, expected, bootstrap.id);
  c.need(active(course.status), 'course_template_not_active', 'Course template did not become ACTIVE.');
  save('active-course-template.json', course);
  event('active-course-template-ready', { credentialTemplateId: course.id });

  stage = 'client-api-key';
  let keyMetadata;
  if (namedKeys.length) {
    c.need(fs.existsSync(file('client-api-key.txt')) && fs.existsSync(file('client-api-key-metadata.json')),
      'existing_key_secret_unavailable', 'A named key already exists without this run’s retained secret. Do not recreate or revoke it automatically.');
    keyMetadata = c.readJson(file('client-api-key-metadata.json'));
    c.need(keyMetadata.id === namedKeys[0].id, 'client_key_identity_changed', 'Retained key metadata does not match the observed key.');
    c.remember(c.readPrivate(file('client-api-key.txt'), 16384).trim());
    keyMetadata = namedKeys[0];
  } else {
    const created = await mutate('api-key-create', '/v1/api-keys' + scope,
      { name: cfg.apiKeyName, description: 'Synthetic OB3 course completion trial', scopes: SCOPES, is_test: true,
        expires_at: new Date(Date.now() + cfg.apiKeyExpiresHours * 3600000).toISOString() });
    c.need(c.nonempty(created.key) && /^(mk|pk)_(test|live)_\S+$/.test(created.key), 'client_key_secret_missing', 'Create response omitted a recognized one-time API key.');
    c.remember(created.key);
    c.writePrivate(file('client-api-key.txt'), created.key + '\n', true);
    const { key, ...metadata } = created;
    keyMetadata = metadata; save('client-api-key-metadata.json', metadata, true);
  }
  c.need(keyMetadata.organization_id === org.id && keyMetadata.enabled === true &&
    Array.isArray(keyMetadata.scopes) && keyMetadata.scopes.length === SCOPES.length &&
    SCOPES.every(scope => keyMetadata.scopes.includes(scope)),
  'client_key_metadata_mismatch', 'Client key metadata must match organization, explicit scopes, active state and expiry.');
  checkApiKeyExpiry(keyMetadata, retainedApiKeyRequest(), cfg.apiKeyExpiresHours);
  event('scoped-client-key-retained', { apiKeyId: keyMetadata.id });

  const clientConfig = { origin: cfg.origin, authMode: 'api-key', organizationId: org.id,
    credentialTemplateId: course.id, issuerDid, achievementId: cfg.achievementId, learnerId: cfg.learnerId,
    completionEventId: cfg.completionEventId, subjectFile: 'course-subject.json', stateDirectory: 'client-run-001', timeoutMs: cfg.timeoutMs };
  save('course-subject.json', makeSubject(cfg));
  save('client-config.json', clientConfig);
  save('instructor-config.json', { ...clientConfig, authMode: 'instructor-session',
    completionEventId: cfg.completionEventId + '-instructor', stateDirectory: 'instructor-run-001' });
  report.lastCommand = command; report.lastCommandResult = 'passed'; report.updatedAt = new Date().toISOString();
  save('onboarding-report.json', report);
  event('public-course-onboarding-complete', { organizationId: org.id, credentialTemplateId: course.id,
    clientConfig: file('client-config.json'), apiKeyFile: file('client-api-key.txt'),
    machineIntegration: 'not-run', instructorFallback: 'not-run' });
}
async function main() {
  c.runtime();
  const [command, configPath] = process.argv.slice(2);
  c.need(['inspect', 'provision'].includes(command) && configPath, 'usage',
    'Usage: node onboard-course.cjs <inspect|provision> onboarding-config.json');
  await execute(command, configPath);
}
if (require.main === module) main().catch(error => {
  const result = c.failure(error, stage);
  if (directory && report) {
    report.lastCommand = process.argv[2]; report.lastCommandResult = 'stopped'; report.checks.push(result);
    try { save('onboarding-report.json', report); } catch {}
  }
  process.stdout.write(JSON.stringify(result) + '\n'); process.exitCode = 1;
});
module.exports = { active, badge, vcJwt, expectedTemplate, checkTemplate, checkApiKeyExpiry, makeSubject, execute };
