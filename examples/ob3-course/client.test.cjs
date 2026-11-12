'use strict';

// Offline client-boundary checks. These do not qualify a deployed issuer.
const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');
const { validateBindings, parseOffer, responseDiagnostic, requireJson } = require('./ob3-client.cjs');
const { CookieJar, loginForm } = require('./public-login.cjs');
const { checkApiKeyExpiry } = require('./onboard-course.cjs');

const now = Date.parse('2026-11-12T12:00:00Z');
const cfg = {
  issuerDid: 'did:web:issuer.example',
  achievementId: 'https://school.example/achievements/course',
  learnerId: 'synthetic-learner',
};
const holder = { did: 'did:example:learner', jwk: {} };

function payload() {
  return {
    iss: cfg.issuerDid, sub: holder.did, jti: 'urn:uuid:synthetic-course-credential',
    nbf: now / 1000 - 60, exp: now / 1000 + 3600,
    vc: {
      '@context': ['https://www.w3.org/ns/credentials/v2', 'https://purl.imsglobal.org/spec/ob/v3p0/context.json'],
      type: ['VerifiableCredential', 'OpenBadgeCredential'],
      issuer: cfg.issuerDid, validFrom: '2026-11-12T11:59:00Z',
      credentialSubject: {
        id: holder.did, type: ['AchievementSubject'], learner_id: cfg.learnerId,
        achievement: {
          id: cfg.achievementId, type: ['Achievement'], name: 'Synthetic course',
          description: 'Completed the workshop and assessment.',
          criteria: { narrative: 'Complete the workshop and score at least 80 percent.' },
        },
      },
    },
  };
}

test('retains baseline JWT-ID behavior and checks an embedded identifier when present', () => {
  const value = payload();
  assert.equal(validateBindings(value, cfg, holder, now).embeddedVcIdPresent, false);
  value.vc.id = value.jti;
  assert.equal(validateBindings(value, cfg, holder, now).embeddedVcIdPresent, true);
  value.vc.id = 'urn:uuid:another-credential';
  assert.throws(() => validateBindings(value, cfg, holder, now), { code: 'credential_id_mismatch' });
});

test('rejects an incomplete course, wrong learner/course, and expired credential', () => {
  const cases = [
    ['achievement_criteria_missing', v => { delete v.vc.credentialSubject.achievement.criteria; }],
    ['achievement_criteria_missing', v => { v.vc.credentialSubject.achievement.criteria = null; }],
    ['achievement_criteria_missing', v => { v.vc.credentialSubject.achievement.criteria = 'passed'; }],
    ['achievement_criteria_missing', v => { v.vc.credentialSubject.achievement.criteria = []; }],
    ['achievement_criteria_missing', v => { v.vc.credentialSubject.achievement.criteria = 42; }],
    ['recipient_mismatch', v => { v.vc.credentialSubject.id = 'did:example:someone-else'; }],
    ['holder_binding_mismatch', v => { v.sub = 'did:example:someone-else'; }],
    ['learner_claim_mismatch', v => { v.vc.credentialSubject.learner_id = 'another-learner'; }],
    ['achievement_mismatch', v => { v.vc.credentialSubject.achievement.id += '-other'; }],
    ['vc_issuer_mismatch', v => { v.vc.issuer = 'did:web:another-issuer.example'; }],
    ['expired', v => { v.exp = now / 1000 - 1; }],
    ['not_yet_valid', v => { v.nbf = now / 1000 + 3600; }],
  ];
  for (const [code, change] of cases) {
    const value = payload(); change(value);
    assert.throws(() => validateBindings(value, cfg, holder, now), { code });
  }
});

test('criteria object members remain optional and extension objects are retained', () => {
  for (const criteria of [{}, { id: 'https://school.example/criteria' },
    { 'https://school.example/criterion': 'Complete the workshop' }]) {
    const value = payload();
    value.vc.credentialSubject.achievement.criteria = criteria;
    assert.equal(validateBindings(value, cfg, holder, now).credentialId, value.jti);
    assert.deepEqual(value.vc.credentialSubject.achievement.criteria, criteria);
  }
});

test('only accepts the fixture-supported inline pre-authorized offer shape', () => {
  const offer = {
    credential_issuer: 'https://issuer.example', credential_configuration_ids: ['course'],
    grants: { 'urn:ietf:params:oauth:grant-type:pre-authorized_code': { 'pre-authorized_code': 'synthetic-code' } },
  };
  const uri = value => 'openid-credential-offer://?credential_offer=' + encodeURIComponent(JSON.stringify(value));
  assert.equal(parseOffer(uri(offer)).configurationId, 'course');
  offer.grants['urn:ietf:params:oauth:grant-type:pre-authorized_code'].tx_code = { length: 6 };
  assert.throws(() => parseOffer(uri(offer)), { code: 'transaction_code_required' });
  assert.throws(() => parseOffer('openid-credential-offer://?credential_offer_uri=https%3A%2F%2Fissuer.example%2Foffer'),
    { code: 'referenced_offer_unsupported' });
});

test('operator forms stay on the observed origin and realm', () => {
  const origin = 'https://issuer.example';
  for (const realm of ['/realms/11id', '/auth/realms/11id']) {
    const html = action => `<form id="kc-form-login" method="post" action="${action}"><input name="username"><input name="password" type="password"></form>`;
    const action = realm + '/login-actions/authenticate?session_code=synthetic';
    assert.equal(loginForm(html(action), new URL(origin + realm + '/protocol/openid-connect/auth'), origin, realm).action.pathname,
      realm + '/login-actions/authenticate');
    assert.throws(() => loginForm(html('https://elsewhere.example' + action), new URL(origin), origin, realm),
      { code: 'untrusted_endpoint' });
    assert.throws(() => loginForm(html('/realms/another/login-actions/authenticate'), new URL(origin), origin, realm),
      { code: 'login_action_refused' });
  }
});

test('operator cookie paths do not leak realm cookies to the application callback', () => {
  const origin = 'https://issuer.example';
  const jar = new CookieJar(origin);
  jar.absorb({ getSetCookie: () => ['realm=synthetic; Path=/realms/11id; Secure'] }, new URL(origin + '/realms/11id/login'));
  assert.equal(jar.header(new URL(origin + '/realms/11id/login-actions/authenticate')), 'realm=synthetic');
  assert.equal(jar.header(new URL(origin + '/realms/11id-other/login')), '');
  assert.equal(jar.header(new URL(origin + '/v1/auth/callback')), '');
});

function keyCreationRequest(at = now - 60000, expires = now + 3540000) {
  return { at: new Date(at).toISOString(), method: 'POST', route: '/v1/api-keys?organization_id=synthetic',
    body: { expires_at: new Date(expires).toISOString() } };
}

test('accepts a finite future key expiry within the original configured request', () => {
  const journal = keyCreationRequest();
  assert.doesNotThrow(() => checkApiKeyExpiry({ expires_at: journal.body.expires_at }, journal, 1, now));
  assert.doesNotThrow(() => checkApiKeyExpiry({ expires_at: new Date(now + 60000).toISOString() }, journal, 1, now));
});

test('rejects missing, malformed, expired and overlong returned key expiry', () => {
  const journal = keyCreationRequest();
  for (const expires_at of [undefined, null, '', 'not-a-date', now + 60000,
    new Date(now - 1).toISOString(), new Date(now).toISOString(),
    new Date(Date.parse(journal.body.expires_at) + 1).toISOString()]) {
    assert.throws(() => checkApiKeyExpiry({ expires_at }, journal, 1, now),
      { code: 'client_key_expiry_mismatch' });
  }
});

test('requires an intact bounded API-key creation journal', () => {
  const journal = keyCreationRequest();
  const metadata = { expires_at: journal.body.expires_at };
  const invalid = [null, {}, { ...journal, at: 'not-a-date' },
    { ...journal, at: new Date(now + 1).toISOString() },
    { ...journal, method: 'GET' }, { ...journal, route: '/v1/issuance' }, { ...journal, route: 123 },
    { ...journal, body: {} },
    { ...journal, body: { expires_at: journal.at } },
    { ...journal, body: { expires_at: new Date(Date.parse(journal.body.expires_at) + 1).toISOString() } }];
  for (const value of invalid) assert.throws(() => checkApiKeyExpiry(metadata, value, 1, now),
    { code: 'client_key_expiry_unproven' });
  for (const lifetime of [0, 169, 1.5]) assert.throws(() => checkApiKeyExpiry(metadata, journal, lifetime, now),
    { code: 'client_key_expiry_unproven' });
});

test('resumed key readback retains the original deadline instead of restarting its lifetime', () => {
  const journal = keyCreationRequest(now - 1800000, now + 1800000);
  assert.doesNotThrow(() => checkApiKeyExpiry({ expires_at: journal.body.expires_at }, journal, 1, now));
  assert.throws(() => checkApiKeyExpiry({ expires_at: new Date(now + 3600000).toISOString() }, journal, 1, now),
    { code: 'client_key_expiry_mismatch' });
  assert.throws(() => checkApiKeyExpiry({ expires_at: journal.body.expires_at }, journal, 1, now + 1800000),
    { code: 'client_key_expiry_mismatch' });
});

test('protocol rejection retains its description, stable server code, HTTP status and local step code', () => {
  const response = { status: 400, json: { error: 'invalid_credential_request',
    error_description: 'Open Badges achievement criteria is required and must be an object' },
  correlationId: '11111111-1111-4111-8111-111111111111' };
  assert.throws(() => requireJson(response, 'credential_request_failed'), error => {
    assert.equal(error.code, 'credential_request_failed');
    assert.deepEqual(error.extra, { httpStatus: 400, diagnostic: response.json.error_description,
      serverErrorCode: 'invalid_credential_request', correlationId: response.correlationId });
    return true;
  });
  response.status = 503;
  response.json.error = 'service_error';
  assert.equal(responseDiagnostic(response).httpStatus, 503);
  assert.equal(responseDiagnostic(response).serverErrorCode, 'service_error');
});

test('nested gateway messages keep precedence and legacy detail/message/code shapes remain readable', () => {
  const response = json => responseDiagnostic({ status: 403, json, correlationId: '' });
  assert.deepEqual(response({ error: { code: 'insufficient_scope', message: 'Scope trust:read is required.' },
    error_description: 'Secondary protocol text', detail: 'Secondary detail', message: 'Secondary message' }), {
    httpStatus: 403, diagnostic: 'Scope trust:read is required.', serverErrorCode: 'insufficient_scope', correlationId: '',
  });
  assert.equal(response({ error: { code: 'access_denied' }, detail: 'secondary' }).diagnostic, 'access_denied');
  assert.equal(response({ detail: 'Native detail' }).diagnostic, 'Native detail');
  assert.equal(response({ message: 'Gateway message' }).diagnostic, 'Gateway message');
  assert.equal(response({ error: 'invalid_request' }).diagnostic, 'invalid_request');
});

test('error fields admit only text and never stringify arbitrary objects, arrays or the raw body', () => {
  const poison = { credential: 'PRIVATE_CREDENTIAL_SENTINEL', toString() { throw new Error('must not stringify'); } };
  for (const value of [poison, [poison], 42, true]) {
    const result = responseDiagnostic({ status: 400, json: { error: { message: value, code: value },
      error_description: value, detail: value, message: value }, raw: 'PRIVATE_RAW_BODY_SENTINEL', correlationId: value });
    assert.equal(result.diagnostic, 'No textual error diagnostic was returned.');
    assert.equal(result.correlationId, '');
    assert.equal(result.serverErrorCode, undefined);
    assert.ok(!JSON.stringify(result).includes('PRIVATE_'));
  }
  for (const json of [null, 'PRIVATE_BODY_SENTINEL', [{ error_description: 'PRIVATE_BODY_SENTINEL' }]]) {
    const result = responseDiagnostic({ status: 502, json, raw: 'PRIVATE_RAW_BODY_SENTINEL' });
    assert.ok(!JSON.stringify(result).includes('PRIVATE_'));
  }
});

test('server error codes reject oversize, whitespace, controls and secret-shaped values', () => {
  for (const code of ['x'.repeat(91), ' invalid_request', 'invalid request', 'invalid\nrequest',
    'invalid\u0000request', 'mk_test_PRIVATE_KEY_SENTINEL', 'eyJhbGciOiJFUzI1NiJ9.cGF5bG9hZA.c2ln']) {
    const result = responseDiagnostic({ status: 400, json: { error: code, error_description: 'Fixed explanatory text' } });
    assert.equal(result.serverErrorCode, undefined);
    assert.equal(result.diagnostic, 'Fixed explanatory text');
  }
});

test('diagnostic redaction precedes truncation for registered capabilities and token/key patterns', () => {
  const grant = 'PRIVATE_CAPABILITY_SENTINEL'.repeat(40);
  const offer = { credential_issuer: 'https://issuer.example', credential_configuration_ids: ['course'],
    grants: { 'urn:ietf:params:oauth:grant-type:pre-authorized_code': { 'pre-authorized_code': grant } } };
  parseOffer('openid-credential-offer://?credential_offer=' + encodeURIComponent(JSON.stringify(offer)));
  const jwt = 'eyJ' + 'a'.repeat(600) + '.cGF5bG9hZA.c2ln';
  const privateKey = '-----BEGIN EC PRIVATE KEY-----\nPRIVATE_PEM_SENTINEL\n-----END EC PRIVATE KEY-----';
  const cases = [[grant, '[redacted]'], [jwt, '[jwt]'], ['mk_test_PRIVATE_KEY_SENTINEL', '[api-key]'],
    [privateKey, '[private-key]'], ['?credential_offer=PRIVATE_OFFER_SENTINEL', '?credential_offer=[redacted]']];
  for (const [secret, marker] of cases) {
    const result = responseDiagnostic({ status: 400, json: { error_description: 'x'.repeat(449) + ' ' + secret + ' tail' } });
    assert.ok(result.diagnostic.includes(marker));
    assert.ok(result.diagnostic.length <= 500);
    assert.ok(!result.diagnostic.includes('PRIVATE_'));
    assert.ok(!result.diagnostic.includes(jwt.slice(0, 10)));
  }
  assert.equal(responseDiagnostic({ status: 400, json: { error_description: 'x'.repeat(10000) } }).diagnostic.length, 500);
});

test('successful JSON is unchanged and a non-JSON rejection never dumps its body', () => {
  const body = { id: 'unchanged', credential: 'PRIVATE_SUCCESS_SENTINEL' };
  assert.equal(requireJson({ status: 200, json: body }, 'unused'), body);
  assert.throws(() => requireJson({ status: 502, json: null, raw: '<html>PRIVATE_RAW_BODY_SENTINEL</html>' }, 'metadata_failed'), error => {
    assert.equal(error.code, 'metadata_failed');
    assert.equal(error.extra.diagnostic, 'non-JSON response');
    assert.ok(!JSON.stringify(error.extra).includes('PRIVATE_'));
    return true;
  });
});

function diagnosticCli(t, command) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'ob3-diagnostic-'));
  fs.chmodSync(directory, 0o700);
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const state = path.join(directory, 'private-state');
  fs.mkdirSync(state, { mode: 0o700 });
  const write = (filename, value) => fs.writeFileSync(filename, typeof value === 'string' ? value : JSON.stringify(value), { mode: 0o600 });
  const origin = 'https://issuer.example';
  const org = '11111111-1111-4111-8111-111111111111';
  const key = 'mk_test_PRIVATE_CLI_KEY_SENTINEL';
  const cfg = { origin, authMode: 'api-key', organizationId: org,
    credentialTemplateId: '22222222-2222-4222-8222-222222222222', issuerDid: 'did:web:issuer.example',
    achievementId: 'https://issuer.example/course', learnerId: 'synthetic-learner',
    completionEventId: 'synthetic-diagnostic-event', stateDirectory: state };
  const configPath = path.join(directory, 'config.json');
  const keyPath = path.join(directory, 'key.txt');
  const callsPath = path.join(directory, 'calls.jsonl');
  const preload = path.join(directory, 'fake-fetch.cjs');
  write(configPath, cfg); write(keyPath, key);
  const grant = 'PRIVATE_CLI_GRANT_SENTINEL';
  const issuer = origin + '/org/' + org;
  const offer = { credential_issuer: issuer, credential_configuration_ids: ['OpenBadgeCredential'],
    grants: { 'urn:ietf:params:oauth:grant-type:pre-authorized_code': { 'pre-authorized_code': grant } } };
  write(path.join(state, 'offer-private.json'), { id: '33333333-3333-4333-8333-333333333333',
    organization_id: org, credential_template_id: cfg.credentialTemplateId,
    credential_offer_uri: 'openid-credential-offer://?credential_offer=' + encodeURIComponent(JSON.stringify(offer)),
    credential_offer_uris: {}, credential_offer_labels: {}, expires_at: '2026-11-12T15:00:00Z', status: 'pending' });
  write(path.join(state, 'learner-private-key.pem'), crypto.generateKeyPairSync('ec', { namedCurve: 'P-256' }).privateKey
    .export({ type: 'pkcs8', format: 'pem' }));
  write(preload, `
    const fs = require('node:fs');
    const origin = ${JSON.stringify(origin)}, issuer = ${JSON.stringify(issuer)};
    global.fetch = async (url, options = {}) => {
      const route = new URL(url).pathname, method = options.method || 'GET';
      fs.appendFileSync(${JSON.stringify(callsPath)}, JSON.stringify({ route, method }) + '\\n', { mode: 0o600 });
      const reply = (status, body) => new Response(JSON.stringify(body), { status,
        headers: { 'content-type': 'application/json', 'x-correlation-id': '44444444-4444-4444-8444-444444444444' } });
      if (${JSON.stringify(command)} === 'preflight' && method === 'GET' && route.startsWith('/v1/credential-templates/')) {
        if (options.headers['X-API-Key'] !== ${JSON.stringify(key)}) return reply(403, { error: 'access_denied' });
        return reply(503, { error: 'service_error', error_description: 'Template read failed for ${key}',
          credential: { private: 'PRIVATE_RESPONSE_OBJECT_SENTINEL' } });
      }
      if (method === 'GET' && route === '/.well-known/openid-credential-issuer/org/${org}') return reply(200, {
        credential_issuer: issuer, credential_endpoint: origin + '/v1/issuance/credential', token_endpoint: origin + '/v1/issuance/token',
        credential_configurations_supported: { OpenBadgeCredential: { format: 'jwt_vc_json' } } });
      if (method === 'POST' && route === '/v1/issuance/token') return reply(200, {
        access_token: 'PRIVATE_CLI_ACCESS_SENTINEL', c_nonce: 'PRIVATE_CLI_NONCE_SENTINEL' });
      if (method === 'POST' && route === '/v1/issuance/credential') return reply(503, {
        error: 'service_error', error_description: 'Native credential operation failed: Invalid request: Open Badges achievement criteria is required and must be an object; ${grant} PRIVATE_CLI_ACCESS_SENTINEL PRIVATE_CLI_NONCE_SENTINEL ' + JSON.parse(options.body).proofs.jwt[0],
        credential: { private: 'PRIVATE_RESPONSE_OBJECT_SENTINEL' } });
      throw new Error('Unexpected fake transport request');
    };
  `);
  const run = () => spawnSync(process.execPath, ['--require', preload, path.join(__dirname, 'ob3-client.cjs'), command, configPath], {
    encoding: 'utf8', timeout: 15000, env: { ...process.env, MARTY_API_KEY_FILE: keyPath },
  });
  return { state, key, grant, run, directory, configPath, write,
    calls: () => fs.existsSync(callsPath) ? fs.readFileSync(callsPath, 'utf8').trim().split('\n').map(JSON.parse) : [],
    read: name => fs.readFileSync(path.join(state, name), 'utf8') };
}

test('claim CLI reports protocol diagnostics, preserves private evidence and never retries redemption', t => {
  const fixture = diagnosticCli(t, 'claim');
  const first = fixture.run();
  assert.equal(first.status, 1, first.stderr);
  const stopped = first.stdout.trim().split('\n').map(JSON.parse).at(-1);
  assert.equal(stopped.code, 'credential_request_failed');
  assert.equal(stopped.httpStatus, 503);
  assert.equal(stopped.serverErrorCode, 'service_error');
  assert.ok(stopped.diagnostic.includes('achievement criteria is required and must be an object'));
  assert.equal(stopped.correlationId, '44444444-4444-4444-8444-444444444444');
  assert.equal(stopped.automaticMutationReplay, false);
  for (const output of [first.stdout, fixture.read('report.json')]) {
    assert.ok(!output.includes('PRIVATE_'));
    assert.ok(!output.includes('eyJ'));
  }
  const names = ['claim-started.json', 'offer-private.json', 'learner-private-key.pem',
    'token-response-private.json', 'credential-response-private.json'];
  const before = Object.fromEntries(names.map(name => [name, fixture.read(name)]));
  assert.ok(before['credential-response-private.json'].includes(fixture.grant));
  assert.ok(before['credential-response-private.json'].includes('PRIVATE_RESPONSE_OBJECT_SENTINEL'));
  assert.ok(!fs.existsSync(path.join(fixture.state, 'credential.jwt')));
  assert.deepEqual(fixture.calls().map(call => call.method), ['GET', 'POST', 'POST']);
  const second = fixture.run();
  assert.equal(second.status, 1, second.stderr);
  assert.equal(JSON.parse(second.stdout.trim()).code, 'claim_already_attempted');
  assert.equal(fixture.calls().length, 3);
  for (const name of names) assert.equal(fixture.read(name), before[name]);
});

test('template preflight uses the same safe protocol diagnostic with its authenticated key redacted', t => {
  const fixture = diagnosticCli(t, 'preflight');
  const result = fixture.run();
  assert.equal(result.status, 1, result.stderr);
  const events = result.stdout.trim().split('\n').map(JSON.parse);
  const read = events.find(event => event.check === 'api-key-template-read');
  assert.equal(read.httpStatus, 503);
  assert.equal(read.serverErrorCode, 'service_error');
  assert.equal(read.diagnostic, 'Template read failed for [redacted]');
  assert.equal(events.at(-1).code, 'preflight_failed');
  assert.ok(!result.stdout.includes('PRIVATE_'));
  assert.ok(!fixture.read('report.json').includes('PRIVATE_'));
  assert.ok(fixture.read('api-key-template-read-response.json').includes(fixture.key));
  assert.deepEqual(fixture.calls().map(call => call.method), ['GET', 'GET', 'GET']);
});

test('private-input parse failures use fixed CLI diagnostics without exposing or replacing original bytes', async t => {
  const sentinel = 'PRIVATE_CAPABILITY_OR_CLAIM_SENTINEL';
  const encode = text => Buffer.from(text).toString('base64url');
  const cases = [
    { label: 'retained offer JSON', command: 'claim', code: 'private_state_json_invalid', change: f =>
      f.write(path.join(f.state, 'offer-private.json'), sentinel) },
    { label: 'retained report JSON', command: 'claim', code: 'private_state_json_invalid', originalReport: true, change: f =>
      f.write(path.join(f.state, 'report.json'), sentinel) },
    { label: 'inline offer JSON before its grant can be registered', command: 'claim', code: 'offer_json_invalid', change: f => {
      const offer = JSON.parse(f.read('offer-private.json'));
      offer.credential_offer_uri = 'openid-credential-offer://?credential_offer=' + encodeURIComponent(sentinel);
      f.write(path.join(f.state, 'offer-private.json'), offer);
    } },
    { label: 'configuration JSON', command: 'claim', code: 'configuration_json_invalid', noReport: true, change: f =>
      f.write(f.configPath, sentinel) },
    { label: 'course subject JSON', command: 'issue', code: 'subject_json_invalid', change: f => {
      const cfg = JSON.parse(fs.readFileSync(f.configPath, 'utf8'));
      cfg.subjectFile = 'subject-private.json';
      f.write(f.configPath, cfg);
      f.write(path.join(f.directory, cfg.subjectFile), sentinel);
    } },
    { label: 'compact JWT header JSON', command: 'readback', code: 'invalid_jwt_json', change: f =>
      f.write(path.join(f.state, 'credential.jwt'), `${encode(sentinel)}.${encode('{}')}.c2ln\n`) },
    { label: 'compact JWT payload JSON', command: 'readback', code: 'invalid_jwt_json', change: f =>
      f.write(path.join(f.state, 'credential.jwt'), `${encode('{"alg":"ES256"}')}.${encode(sentinel)}.c2ln\n`) },
  ];
  const snapshot = directory => {
    const files = new Map();
    const walk = current => {
      for (const name of fs.readdirSync(current)) {
        const file = path.join(current, name), stat = fs.statSync(file);
        if (stat.isDirectory()) walk(file);
        else files.set(file, { bytes: fs.readFileSync(file), mode: stat.mode });
      }
    };
    walk(directory); return files;
  };
  for (const scenario of cases) await t.test(scenario.label, t => {
    const fixture = diagnosticCli(t, scenario.command);
    scenario.change(fixture);
    const before = snapshot(fixture.directory);
    // Repeating the local command must remain a parser stop, never a network
    // request, state reset or disclosure of a previously unknown secret.
    for (let attempt = 0; attempt < 2; attempt++) {
      const result = fixture.run();
      assert.equal(result.status, 1, result.stderr);
      const stopped = result.stdout.trim().split('\n').map(JSON.parse).at(-1);
      assert.equal(stopped.code, scenario.code);
      assert.equal(stopped.privateStatePreserved, true);
      assert.equal(stopped.automaticMutationReplay, false);
      for (const output of [result.stdout, result.stderr]) {
        assert.ok(!output.includes('PRIVATE_'));
        assert.ok(!output.includes(encode(sentinel).slice(0, 12)));
        assert.ok(!output.includes('Unexpected token'));
      }
      assert.deepEqual(fixture.calls(), []);
      for (const [file, original] of before) {
        assert.deepEqual(fs.readFileSync(file), original.bytes, file);
        assert.equal(fs.statSync(file).mode, original.mode, file);
      }
      const reportFile = path.join(fixture.state, 'report.json');
      if (scenario.noReport) assert.ok(!fs.existsSync(reportFile));
      else if (!scenario.originalReport) {
        const report = fs.readFileSync(reportFile, 'utf8');
        assert.ok(!report.includes('PRIVATE_'));
        assert.ok(!report.includes(encode(sentinel).slice(0, 12)));
        assert.equal(JSON.parse(report).checks.at(-1).code, scenario.code);
      }
      for (const name of ['issuance-requested.json', 'claim-started.json', 'token-response-private.json',
        'credential-response-private.json']) assert.ok(!fs.existsSync(path.join(fixture.state, name)), name);
    }
  });
});
