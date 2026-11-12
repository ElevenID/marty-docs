'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { test } = require('node:test');
const c = require('./public-client-common.cjs');
const { run } = require('./probe-scope-lifecycle.cjs');

const ID = { org: '11111111-1111-4111-8111-111111111111', template: '22222222-2222-4222-8222-222222222222',
  R: '33333333-3333-4333-8333-333333333333', V: '44444444-4444-4444-8444-444444444444',
  transaction: '55555555-5555-4555-8555-555555555555', policy: '66666666-6666-4666-8666-666666666666',
  trust: '77777777-7777-4777-8777-777777777777', credential: 'urn:uuid:88888888-8888-4888-8888-888888888888' };
const NOW = Date.parse('2026-11-12T10:00:00Z');
function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'course-lifecycle-probe-'));
  fs.chmodSync(root, 0o700);
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const save = (name, value) => c.writePrivate(path.join(root, name), value);
  const original = c.privateDir(path.join(root, 'original'));
  const evidence = path.join(root, 'probe');
  const issuer = 'did:web:issuer.example';
  const learner = 'did:example:synthetic-learner';
  const achievement = { id: 'https://school.example/achievement', type: ['Achievement'], name: 'Synthetic course',
    description: 'Synthetic workshop and assessment', criteria: { narrative: 'Complete the synthetic workshop.' } };
  const subject = { id: learner, type: ['AchievementSubject'], learner_id: 'synthetic-learner-a', achievement };
  const body = { organization_id: ID.org, credential_template_id: ID.template, issuer_did: issuer,
    subject_did: learner, holder_did: learner, credential_subject: subject };
  const journal = { completionEventId: 'synthetic-completion-001', body };
  const payload = { iss: issuer, sub: learner, jti: ID.credential, iat: NOW / 1000 - 60, exp: NOW / 1000 + 86400,
    vc: { '@context': ['https://www.w3.org/ns/credentials/v2', 'https://purl.imsglobal.org/spec/ob/v3p0/context.json'],
      id: ID.credential, type: ['VerifiableCredential', 'OpenBadgeCredential'], issuer,
      validFrom: '2026-11-12T09:59:00Z', validUntil: '2026-11-13T10:00:00Z', credentialSubject: subject } };
  const b64 = value => Buffer.from(JSON.stringify(value)).toString('base64url');
  const signingInput = b64({ alg: 'ES256', kid: issuer + '#key-1' }) + '.' + b64(payload);
  const { privateKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'P-256' });
  const jwt = signingInput + '.' + crypto.sign('sha256', Buffer.from(signingInput), { key: privateKey, dsaEncoding: 'ieee-p1363' }).toString('base64url');
  save('original/issuance-requested.json', journal);
  save('original/issuance-response.json', { status: 200, body: { id: ID.transaction, organization_id: ID.org,
    credential_template_id: ID.template, status: 'pending', credential_offer_uri: 'private-capability-sentinel' } });
  save('original/credential.jwt', jwt + '\n');
  const client = { origin: 'https://issuer.example', authMode: 'api-key', organizationId: ID.org, credentialTemplateId: ID.template,
    issuerDid: issuer, learnerId: subject.learner_id, achievementId: achievement.id, completionEventId: journal.completionEventId,
    stateDirectory: 'original' };
  save('client.json', client);
  const secrets = { R: 'mk_test_privateRead01234567890123456789', V: 'mk_test_privateVerify01234567890123456789', session: 'private-session-sentinel' };
  save('R.txt', secrets.R); save('V.txt', secrets.V); save('session.txt', secrets.session);
  const cfg = { origin: client.origin, clientConfigFile: 'client.json', policyId: ID.policy, readKeyId: ID.R, verifyKeyId: ID.V,
    readKeyFile: 'R.txt', verifyKeyFile: 'V.txt', operatorSessionFile: 'session.txt', probeStateDirectory: 'probe',
    syntheticCourse: true, revokeSyntheticCredentialLast: true };
  save('probe.json', cfg);
  const template = { id: ID.template, organization_id: ID.org, status: 'ACTIVE', issuer_did: issuer,
    credential_type: 'OpenBadgeCredential', credential_payload_format: 'VC_JWT', vct: achievement.id,
    compliance_profile_id: '10000000-0000-0000-0000-000000000003',
    claims: [{ name: 'learner_id', type: 'STRING', required: true, selectively_disclosable: false },
      { name: 'achievement', type: 'OBJECT', required: true, selectively_disclosable: false }] };
  const policy = { id: ID.policy, organization_id: ID.org, status: 'active', compliance_profile_id: template.compliance_profile_id,
    accepted_credential_types: ['OpenBadgeCredential'], required_claims: [], alternative_requirements: [],
    holder_binding: { required: false }, freshness: { max_age_seconds: null, require_not_revoked: true, revocation_grace_seconds: 300 },
    prefer_predicates: false, supported_circuits: [], trust_profile_id: ID.trust,
    credential_requirements: [{ credential_template_id: ID.template, credential_payload_format: 'VC_JWT', required: true,
      trust_profile_id: ID.trust, max_age_seconds: null, require_fresh_issuance: false,
      requested_claims: ['learner_id', 'achievement'].map(name => ({ claim_name: name, required: true, selective_disclosure: false,
        accept_derived: false, constraints: [{ claim_name: name, constraint_type: 'equals', value: subject[name] }] })) }] };
  const trust = { id: ID.trust, organization_id: ID.org, profile_type: 'CUSTOM', status: 'ACTIVE', allowed_algorithms: ['ES256'],
    supported_formats: ['VC_JWT'], allowed_issuers: [issuer], denied_issuers: [], trust_sources: [] };
  const record = { id: ID.credential, credential_id: ID.credential, organization_id: ID.org, credential_template_id: ID.template,
    issuer_did: issuer, subject_id: learner, credential_hash: c.hash(jwt), flow_execution_id: ID.transaction,
    application_id: null, status: 'ACTIVE', credential_type: 'OpenBadgeCredential', credential_format: 'VC_JWT' };
  const rows = ['R', 'V'].map(role => ({ id: ID[role], organization_id: ID.org, scopes: role === 'R' ? ['credentials:read'] : ['credentials:read', 'trust:read'],
    enabled: true, scope_type: 'ORGANIZATION', created_at: '2026-11-12T09:00:00Z', expires_at: '2026-11-13T10:00:00Z', last_used_at: null }));
  const requests = [], lifecycle = [], posts = [];
  let sequence = 1;
  const reply = (status, json) => ({ status, json: structuredClone(json), raw: JSON.stringify(json),
    headers: new Headers({ 'x-correlation-id': '99999999-9999-4999-8999-999999999999' }) });
  const state = { root, evidence, original, save, jwt, cfg, client, journal, payload, secrets, template, policy, trust, record, rows,
    requests, posts, lifecycle, reply, override: null, freezeUsage: false, wrongSecret: false, concurrentUsage: false, wrongReason: false };
  function evaluation() {
    const active = record.status === 'ACTIVE';
    return { policy_id: ID.policy, result: active ? 'passed' : 'failed', decision: active ? 'allow' : 'deny',
      evaluation_timestamp: new Date(NOW).toISOString(), credential_results: [{ credential_template_id: ID.template, issuer_did: issuer,
        credential_id: ID.credential, signature_valid: true, trust_check_passed: true, freshness_check_passed: true,
        revocation_checked: true, not_revoked: active, revocation_status: record.status.toLowerCase(), satisfied: active,
        error_codes: active ? [] : state.wrongReason ? ['revocation_status_unknown'] : ['credential_revoked'] }] };
  }
  async function transport(_cfg, route, options) {
    const method = options.method || 'GET';
    requests.push({ route, method, options });
    assert.equal(options.headers['Idempotency-Key'], undefined, 'there must be no verification/lifecycle idempotency cache');
    if (method === 'POST') {
      posts.push({ route, options });
      assert.equal(fs.readdirSync(evidence).filter(name => name.endsWith('-requested.json')).length, posts.length,
        'every POST has an exclusive journal before transport');
    }
    if (state.override) { const value = await state.override(route, options); if (value) return value; }
    if (route.startsWith('/v1/vc-api/credentials/verify?')) {
      assert.equal(method, 'POST');
      assert.deepEqual(JSON.parse(options.body), { verifiableCredential: jwt, options: {} });
      assert.ok(route.includes('organization_id=' + ID.org) && route.includes('presentation_policy_id=' + ID.policy));
      const role = options.headers['X-API-Key'] === secrets.R ? 'R' : 'V';
      assert.equal(options.headers['X-API-Key'], secrets[role]);
      const usedRole = state.wrongSecret ? (role === 'R' ? 'V' : 'R') : role;
      if (!state.freezeUsage) rows.find(row => row.id === ID[usedRole]).last_used_at = '2026-11-12T10:00:00.' + String(sequence++).padStart(6, '0') + '+00:00';
      if (state.concurrentUsage) rows.find(row => row.id !== ID[usedRole]).last_used_at = '2026-11-12T10:00:00.' + String(sequence++).padStart(6, '0') + '+00:00';
      if (role === 'R') return reply(403, { detail: 'Forbidden' });
      return record.status === 'ACTIVE' ? reply(200, { verified: true, results: evaluation(), problemDetails: [] }) :
        reply(422, { verified: false, errors: ['verification_failed'] });
    }
    assert.equal(options.headers.Cookie, 'sessionId=' + secrets.session, 'all other reads and lifecycle calls use the existing human session');
    if (route.startsWith('/v1/api-keys?')) return reply(200, rows);
    if (route === '/v1/credential-templates/' + ID.template) return reply(200, template);
    if (route === '/v1/presentation-policies/' + ID.policy) return reply(200, policy);
    if (route === '/v1/trust-profiles/' + ID.trust) return reply(200, trust);
    if (route === '/v1/issued-credentials/' + encodeURIComponent(ID.credential)) return reply(200, record);
    if (route === '/v1/presentation-policies/' + ID.policy + '/evaluate') {
      assert.equal(method, 'POST');
      assert.deepEqual(JSON.parse(options.body), { vp_token: jwt, nonce: null, audience: null });
      return reply(200, evaluation());
    }
    const action = route.split('/').at(-1);
    assert.ok(['suspend', 'reinstate', 'revoke'].includes(action), 'only the three exact lifecycle actions may be sent');
    assert.equal(route, '/v1/issued-credentials/' + encodeURIComponent(ID.credential) + '/' + action);
    assert.equal(method, 'POST');
    assert.deepEqual(Object.keys(JSON.parse(options.body)).sort(), ['comments', 'reason']);
    assert.equal(JSON.parse(options.body).reason, 'Synthetic course lifecycle qualification: ' + action);
    lifecycle.push(action);
    record.status = { suspend: 'SUSPENDED', reinstate: 'ACTIVE', revoke: 'REVOKED' }[action];
    return reply(200, record);
  }
  state.run = () => run(path.join(root, 'probe.json'), { request: transport, now: () => NOW });
  state.report = () => c.readJson(path.join(evidence, 'report.json'));
  state.originalHashes = () => Object.fromEntries(fs.readdirSync(original).map(name => [name, c.hash(fs.readFileSync(path.join(original, name)))]));
  return state;
}

test('same JWT, policy and tenant prove exact scope boundary and ordered lifecycle with public DTOs', async t => {
  const f = fixture(t), originalHashes = f.originalHashes();
  const report = await f.run();
  assert.equal(report.state, 'passed');
  assert.equal(report.scopeBoundaryConfirmed, true);
  assert.equal(report.lifecycleConfirmed, true);
  assert.equal(report.terminalRecord.status, 'REVOKED');
  assert.deepEqual(f.lifecycle, ['suspend', 'reinstate', 'revoke']);
  assert.equal(f.posts.length, 10); // 5 VC-API evaluations, 2 operator diagnostics, 3 lifecycle changes.
  assert.equal(report.checks.filter(x => x.method === 'public_inventory_usage_observation').length, 5);
  assert.deepEqual(f.originalHashes(), originalHashes);
  assert.equal(f.requests.some(x => /\/status(?:\?|$)|\/issuance(?:\/|$)|\/token(?:\?|$)|\/keys(?:\?|$)/.test(x.route)), false);
  const retained = fs.readdirSync(f.evidence).map(name => fs.readFileSync(path.join(f.evidence, name), 'utf8')).join('\n');
  for (const secret of [f.jwt, ...Object.values(f.secrets), f.journal.body.credential_subject.learner_id,
    f.journal.body.credential_subject.achievement.name, f.journal.body.credential_subject.achievement.criteria.narrative, 'private-capability-sentinel'])
    assert.equal(retained.includes(secret), false, 'no private token, capability or claims belong in evidence');
  const count = f.requests.length;
  await assert.rejects(f.run(), { code: 'probe_already_attempted' });
  assert.equal(f.requests.length, count, 'the completed run cannot restart');
});

test('fresh exact key grants and unambiguous identity are required before lifecycle', async t => {
  for (const scenario of ['extra-scope', 'already-used', 'wrongSecret', 'freezeUsage', 'concurrentUsage']) await t.test(scenario, async t => {
    const f = fixture(t);
    if (scenario === 'extra-scope') f.rows[0].scopes.push('trust:read');
    else if (scenario === 'already-used') f.rows[1].last_used_at = '2026-11-12T09:59:00Z';
    else f[scenario] = true;
    await assert.rejects(f.run(), { code: scenario === 'extra-scope' ? 'key_grants_mismatch' : scenario === 'already-used' ? 'keys_already_used' : 'key_usage_ambiguous' });
    assert.deepEqual(f.lifecycle, []);
  });
});

test('policy, trust and public record must bind the complete synthetic course before any POST', async t => {
  for (const scenario of ['claim-value', 'holder-proof', 'status-optional', 'trust-issuer', 'record-hash', 'record-owner']) await t.test(scenario, async t => {
    const f = fixture(t);
    if (scenario === 'claim-value') f.policy.credential_requirements[0].requested_claims[1].constraints[0].value = { id: f.client.achievementId };
    if (scenario === 'holder-proof') f.policy.holder_binding.required = true;
    if (scenario === 'status-optional') f.policy.freshness.require_not_revoked = false;
    if (scenario === 'trust-issuer') f.trust.allowed_issuers.push('did:web:unrelated.example');
    if (scenario === 'record-hash') f.record.credential_hash = '0'.repeat(64);
    if (scenario === 'record-owner') f.record.organization_id = ID.V;
    await assert.rejects(f.run());
    assert.equal(f.posts.length, 0);
    assert.deepEqual(f.lifecycle, []);
  });
});

test('a generic VC-API denial with the wrong detailed status reason cannot authorize later transitions', async t => {
  const f = fixture(t); f.wrongReason = true;
  await assert.rejects(f.run(), { code: 'status_reason_unproven' });
  assert.deepEqual(f.lifecycle, ['suspend']);
  assert.equal(f.report().lastObservedRecord.status, 'SUSPENDED');
  assert.equal(f.report().terminalRecord, undefined);
});

test('an unknown mutation outcome is retained once and never retried or restarted', async t => {
  const f = fixture(t);
  f.override = (route, options) => {
    if (route.endsWith('/suspend') && options.method === 'POST') throw new Error('private-transport-claim-sentinel');
  };
  await assert.rejects(f.run(), { code: 'probe_step_failed' });
  assert.equal(fs.existsSync(path.join(f.evidence, 'suspend-requested.json')), true);
  assert.equal(f.report().checks.at(-1).state, 'requested');
  assert.equal(JSON.stringify(f.report()).includes('private-transport-claim-sentinel'), false);
  const count = f.requests.length;
  await assert.rejects(f.run(), { code: 'probe_already_attempted' });
  assert.equal(f.requests.length, count);
  assert.equal(f.posts.filter(x => x.route.endsWith('/suspend')).length, 1);
});

test('configuration drift after successful scope checks prevents the first lifecycle mutation', async t => {
  const f = fixture(t); let policyReads = 0;
  f.override = route => {
    if (route === '/v1/presentation-policies/' + ID.policy && ++policyReads === 2) f.policy.version = 2;
  };
  await assert.rejects(f.run(), { code: 'resources_changed' });
  assert.deepEqual(f.lifecycle, []);
  assert.equal(f.report().scopeBoundaryConfirmed, true);
});

test('usage observations after every V request also stop ambiguity following suspension', async t => {
  const f = fixture(t);
  f.override = route => { if (route.endsWith('/suspend')) f.freezeUsage = true; };
  await assert.rejects(f.run(), { code: 'key_usage_ambiguous' });
  assert.deepEqual(f.lifecycle, ['suspend']);
});

test('malformed private JSON and malformed JWT fail with fixed diagnostics before transport', async t => {
  for (const filename of ['issuance-requested.json', 'issuance-response.json', 'credential.jwt']) await t.test(filename, async t => {
    const f = fixture(t);
    f.save('original/' + filename, '{"private-capability-sentinel": invalid }');
    await assert.rejects(f.run(), error => {
      assert.equal(String(error).includes('private-capability-sentinel'), false);
      return error.code === (filename.endsWith('.jwt') ? 'credential_encoding_invalid' : 'private_record_invalid');
    });
    assert.equal(f.requests.length, 0);
    assert.equal(fs.existsSync(path.join(f.evidence, 'attempt.json')), false);
  });
});
