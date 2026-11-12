'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test } = require('node:test');
const c = require('./public-client-common.cjs');
const { runPhase, timestamp } = require('./probe-retries.cjs');

const IDS = {
  org: '11111111-1111-4111-8111-111111111111', template: '22222222-2222-4222-8222-222222222222',
  a: '33333333-3333-4333-8333-333333333333', b: '44444444-4444-4444-8444-444444444444',
  transaction: '55555555-5555-4555-8555-555555555555',
};
const NOW = Date.parse('2026-11-12T10:00:00Z');
const PRE_AUTH = 'urn:ietf:params:oauth:grant-type:pre-authorized_code';
const offerUri = payload => 'openid-credential-offer://?credential_offer=' + encodeURIComponent(JSON.stringify(payload));

function privateTree(root) {
  const result = [];
  function visit(relative) {
    const filename = path.join(root, relative), stat = fs.lstatSync(filename);
    result.push({ path: relative, mode: stat.mode & 0o7777, directory: stat.isDirectory(),
      hash: stat.isFile() ? c.hash(fs.readFileSync(filename)) : null });
    if (stat.isDirectory()) for (const name of fs.readdirSync(filename).sort()) visit(path.join(relative, name));
  }
  visit(''); return result;
}

function fixture(t, { legacy = false, spaced = false } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ob3-retry-test-'));
  fs.chmodSync(root, 0o700);
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const original = c.privateDir(path.join(root, 'original'));
  const evidence = path.join(root, 'probe');
  const save = (name, value) => c.writePrivate(path.join(root, name), value);
  const body = { organization_id: IDS.org, credential_template_id: IDS.template, issuer_did: 'did:web:issuer.example',
    subject_did: 'did:example:synthetic-holder', holder_did: 'did:example:synthetic-holder',
    credential_subject: { id: 'did:example:synthetic-holder', type: ['AchievementSubject'], learner_id: 'synthetic-learner',
      achievement: { id: 'https://school.example/achievement', type: ['Achievement'], name: 'Synthetic course',
        description: 'Fixture completion', criteria: { narrative: 'Complete the synthetic workshop.' } } } };
  const wire = spaced ? JSON.stringify(body, null, 2) + '\n' : JSON.stringify(body);
  const journal = { requestedAt: new Date(NOW - 30000).toISOString(), completionEventId: 'synthetic-course-event-001', body,
    ...(legacy ? {} : { requestBody: wire, requestBodySha256: c.hash(wire) }) };
  const capability = 'private-synthetic-capability';
  const offerPayload = { credential_issuer: 'https://issuer.example/org/' + IDS.org,
    credential_configuration_ids: ['OpenBadgeCredential'], grants: { [PRE_AUTH]: { 'pre-authorized_code': capability } } };
  // The gateway public projection deliberately excludes top-level pre_auth_code.
  const offer = { id: IDS.transaction, organization_id: IDS.org, credential_template_id: IDS.template, status: 'pending',
    credential_offer_uri: offerUri(offerPayload), credential_offer_uris: {}, credential_offer_labels: {}, expires_at: '2026-11-19T10:00:00Z' };
  save('original/issuance-requested.json', journal);
  save('original/issuance-response.json', { status: 200, body: offer });
  save('original/offer-private.json', offer);
  save('client.json', { origin: 'https://issuer.example', authMode: 'api-key', organizationId: IDS.org,
    credentialTemplateId: IDS.template, issuerDid: body.issuer_did, learnerId: body.credential_subject.learner_id,
    achievementId: body.credential_subject.achievement.id, completionEventId: journal.completionEventId, stateDirectory: 'original' });
  const secrets = { a: 'mk_test_privateA01234567890123456789', b: 'mk_test_privateB01234567890123456789', session: 'private-session-token' };
  save('a.txt', secrets.a); save('b.txt', secrets.b); save('session.txt', secrets.session);
  const cfg = { origin: 'https://issuer.example', clientConfigFile: 'client.json', primaryKeyId: IDS.a, secondaryKeyId: IDS.b,
    primaryKeyFile: 'a.txt', secondaryKeyFile: 'b.txt', operatorSessionFile: 'session.txt', probeStateDirectory: 'probe',
    maintenanceReceiptFile: 'maintenance.json' };
  save('probe.json', cfg);
  const rows = [IDS.a, IDS.b].map((id, index) => ({ id, organization_id: IDS.org, name: index ? 'second' : 'original',
    key_prefix: 'mk_test_', scope_type: 'ORGANIZATION', scopes: ['credentials:read', 'templates:read', 'credentials:issue'], enabled: true,
    expires_at: '2026-11-13T10:00:00Z', created_at: '2026-11-12T09:00:00Z',
    ...(index ? {} : { last_used_at: '2026-11-12T09:59:59.000001+00:00' }) }));
  const requests = [];
  const posts = [];
  let sequence = 1;
  const response = (status, json, replay = null, correlation = 'synthetic-correlation') => ({ status, json,
    raw: JSON.stringify(json), headers: new Headers({ 'x-correlation-id': correlation, ...(replay === null ? {} : { 'idempotency-replayed': replay }) }) });
  const state = { original, evidence, cfg, journal, offer, offerPayload, capability, wire, rows, requests, posts, secrets, response,
    pauseReceipt() { save('maintenance.json', { observed: 'native pause and resume', syntheticFixture: true }); },
    save, rewriteConfig() { save('probe.json', cfg); },
    replaceOfferUri(uri) {
      offer.credential_offer_uri = uri;
      save('original/offer-private.json', offer);
      save('original/issuance-response.json', { status: 200, body: offer });
    },
    originalHashes() { return Object.fromEntries(fs.readdirSync(original).map(name => [name, c.hash(fs.readFileSync(path.join(original, name)))])); },
    override: null, freezeUsage: false, concurrentUsage: false, transactionStatus: 'pending' };
  async function transport(_cfg, route, options) {
    const method = options.method || 'GET';
    requests.push({ route, method, body: options.body, headers: { ...options.headers } });
    if (route.startsWith('/v1/api-keys?')) {
      assert.equal(options.headers.Cookie, 'sessionId=' + secrets.session);
      return response(200, structuredClone(rows));
    }
    const id = options.headers['X-API-Key'] === secrets.a ? IDS.a : options.headers['X-API-Key'] === secrets.b ? IDS.b : null;
    assert.ok(id, 'only the two retained keys may be sent');
    if (!state.freezeUsage) rows.find(row => row.id === id).last_used_at = '2026-11-12T10:00:00.' + String(sequence++).padStart(6, '0') + '+00:00';
    if (state.concurrentUsage) rows.find(row => row.id !== id).last_used_at = '2026-11-12T10:00:00.' + String(sequence++).padStart(6, '0') + '+00:00';
    if (route.startsWith('/v1/credential-templates/')) {
      assert.equal(method, 'GET');
      return response(200, { id: IDS.template, organization_id: IDS.org, status: 'ACTIVE', issuer_did: body.issuer_did,
        credential_type: 'OpenBadgeCredential', credential_payload_format: 'VC_JWT' });
    }
    if (route === '/v1/issuance') {
      assert.equal(method, 'POST');
      assert.equal(options.headers['Idempotency-Key'], journal.completionEventId);
      const record = { id, body: options.body, parsed: JSON.parse(options.body) };
      posts.push(record);
      // The request journal must be durable before the fake transport observes a POST.
      const journals = fs.readdirSync(evidence).filter(name => name.endsWith('-requested.json'));
      assert.equal(journals.length, posts.length);
      if (state.override) {
        const override = await state.override(record, posts.length);
        if (override) return override;
      }
      const expected = [
        [IDS.a, false, 'true'], [IDS.a, true, null], [IDS.b, true, null], [IDS.b, false, 'false'], [IDS.b, false, 'true'],
      ][posts.length - 1];
      assert.ok(expected, 'no implicit sixth POST');
      const conflict = record.parsed.credential_subject.learner_id !== body.credential_subject.learner_id;
      assert.deepEqual([id, conflict], expected.slice(0, 2));
      if (!conflict) assert.equal(options.body, wire, 'original UTF-8 request bytes must be preserved');
      if (conflict) {
        const changed = structuredClone(record.parsed); changed.credential_subject.learner_id = body.credential_subject.learner_id;
        assert.deepEqual(changed, body, 'only the synthetic learner value changes for conflict evidence');
        return response(409, id === IDS.a ? { error: 'idempotency_conflict' } :
          { detail: 'idempotency key was already used for a different issuance request' });
      }
      return response(200, { ...offer, status: posts.length < 3 ? 'pending' : state.transactionStatus }, expected[2]);
    }
    assert.equal(route, '/v1/issuance/' + IDS.transaction);
    assert.equal(method, 'GET');
    return response(200, { id: IDS.transaction, organization_id: IDS.org, credential_template_id: IDS.template, status: state.transactionStatus });
  }
  state.run = phase => runPhase(phase, path.join(root, 'probe.json'), { request: transport, now: () => NOW });
  state.report = phase => c.readJson(path.join(evidence, phase + '-report.json'));
  return state;
}

test('two explicit phases preserve original bytes/state, prove distinct usage, and permit advancing transaction snapshots', async t => {
  const f = fixture(t, { spaced: true });
  assert.equal(f.offer.pre_auth_code, undefined);
  const originals = f.originalHashes();
  const warm = await f.run('warm');
  assert.equal(warm.state, 'passed');
  assert.equal(warm.gatewayWarmReplayConfirmed, true);
  assert.equal(warm.secondaryKey.id, IDS.b);
  assert.equal(warm.checks.find(item => item.check === 'secondary-key-identity-observation').beforeUsedAt, null);
  f.pauseReceipt(); f.transactionStatus = 'issued';
  const durable = await f.run('durable');
  assert.equal(durable.durableRecoveryConfirmed, true);
  assert.equal(durable.currentTransactionStatus, 'issued');
  assert.equal(durable.nativeMaintenanceVerified, false);
  assert.equal(durable.checks.find(item => item.check === 'durable-conflict-first').conflictBoundary, 'durable_issuance');
  assert.deepEqual(durable.checks.filter(item => item.method === 'POST').map(item => item.idempotencyReplayed), [null, 'false', 'true']);
  assert.deepEqual(f.originalHashes(), originals);
  assert.equal(f.posts.length, 5);
  const output = JSON.stringify([warm, durable]);
  for (const secret of [...Object.values(f.secrets), f.capability, f.offer.credential_offer_uri, f.wire]) assert.ok(!output.includes(secret));
  for (const name of fs.readdirSync(f.evidence)) assert.equal(fs.statSync(path.join(f.evidence, name)).mode & 0o077, 0);
});

test('supports unchanged legacy helper journals through explicitly labelled byte reconstruction', async t => {
  const f = fixture(t, { legacy: true });
  assert.equal((await f.run('warm')).wireSource, 'legacy_helper_JSON.stringify_reconstruction');
  assert.equal(f.posts[0].body, JSON.stringify(f.journal.body));
});

test('public offers require an unambiguous valid grant and the retained tenant/configuration', async t => {
  for (const kind of ['missing-grant', 'malformed-grant', 'malformed-json', 'conflicting-inline-grants', 'wrong-tenant', 'wrong-configuration']) {
    await t.test(kind, async t => {
      const f = fixture(t);
      const payload = structuredClone(f.offerPayload);
      if (kind === 'missing-grant') delete payload.grants[PRE_AUTH];
      if (kind === 'malformed-grant') payload.grants[PRE_AUTH]['pre-authorized_code'] = { secret: 'PRIVATE_GRANT_SENTINEL' };
      if (kind === 'wrong-tenant') payload.credential_issuer = 'https://issuer.example/org/' + IDS.a;
      if (kind === 'wrong-configuration') payload.credential_configuration_ids = ['AnotherCredential'];
      let uri = offerUri(payload);
      if (kind === 'malformed-json') uri = 'openid-credential-offer://?credential_offer=' + encodeURIComponent('{"secret":"PRIVATE_GRANT_SENTINEL" BAD}');
      if (kind === 'conflicting-inline-grants') {
        const changed = structuredClone(payload); changed.grants[PRE_AUTH]['pre-authorized_code'] = 'PRIVATE_OTHER_GRANT';
        uri += '&credential_offer=' + encodeURIComponent(JSON.stringify(changed));
      }
      f.replaceOfferUri(uri);
      await assert.rejects(f.run('warm'), error => {
        assert.ok(['public_offer_invalid', 'public_offer_binding_invalid', 'key_template_read_failed'].includes(error.code));
        assert.ok(!JSON.stringify(c.failure(error, 'retry-probe')).includes('PRIVATE_GRANT_SENTINEL'));
        return true;
      });
      assert.equal(f.posts.length, 0);
    });
  }
});

test('replay cannot change a public inline grant while retaining the transaction ID', async t => {
  const f = fixture(t);
  await f.run('warm'); f.pauseReceipt();
  const changed = structuredClone(f.offerPayload);
  changed.grants[PRE_AUTH]['pre-authorized_code'] = 'PRIVATE_CHANGED_GRANT';
  f.override = (_request, count) => count === 4 ? f.response(200, { ...f.offer, credential_offer_uri: offerUri(changed) }, 'false') : null;
  await assert.rejects(f.run('durable'), { code: 'durable_transaction_mismatch' });
  assert.equal(f.posts.length, 4);
  assert.ok(!JSON.stringify(f.report('durable')).includes('PRIVATE_CHANGED_GRANT'));
});

test('refuses identical key IDs/secrets, mismatched tenant/scopes, and previously used B before issuance requests', async t => {
  for (const kind of ['same-id', 'same-secret', 'wrong-tenant', 'extra-scope', 'used-b']) {
    await t.test(kind, async t => {
      const f = fixture(t);
      if (kind === 'same-id') { f.cfg.secondaryKeyId = IDS.a; f.rewriteConfig(); }
      if (kind === 'same-secret') f.save('b.txt', f.secrets.a);
      if (kind === 'wrong-tenant') f.rows[1].organization_id = IDS.transaction;
      if (kind === 'extra-scope') f.rows[1].scopes.push('trust:read');
      if (kind === 'used-b') f.rows[1].last_used_at = '2026-11-12T09:59:59+00:00';
      await assert.rejects(f.run('warm'));
      assert.equal(f.posts.length, 0);
    });
  }
});

test('refuses swapped secret labels, unchanged usage timestamps and concurrent key usage instead of guessing identity', async t => {
  for (const kind of ['swapped', 'no-change', 'concurrent']) {
    await t.test(kind, async t => {
      const f = fixture(t);
      if (kind === 'swapped') { f.save('a.txt', f.secrets.b); f.save('b.txt', f.secrets.a); }
      if (kind === 'no-change') f.freezeUsage = true;
      if (kind === 'concurrent') f.concurrentUsage = true;
      await assert.rejects(f.run('warm'), { code: 'key_usage_ambiguous' });
      assert.equal(f.posts.length, 0);
    });
  }
  assert.ok(timestamp('2026-11-12T10:00:00.000002+00:00') > timestamp('2026-11-12T10:00:00.000001Z'));
});

test('unknown original outcomes or modified captured bytes cannot initiate a probe', async t => {
  for (const kind of ['failed-original', 'changed-wire']) {
    await t.test(kind, async t => {
      const f = fixture(t);
      if (kind === 'failed-original') f.save('original/issuance-response.json', { status: 503, body: f.offer });
      if (kind === 'changed-wire') { f.journal.requestBody += ' '; f.save('original/issuance-requested.json', f.journal); }
      await assert.rejects(f.run('warm'));
      assert.equal(f.requests.length, 0);
    });
  }
});

test('malformed private JSON cannot expose parser excerpts before secrets are known', async t => {
  for (const filename of ['original/issuance-requested.json', 'original/issuance-response.json', 'original/offer-private.json', 'client.json']) {
    await t.test(filename, async t => {
      const f = fixture(t);
      const sentinel = 'PRIVATE_CAPABILITY_CLAIM_SENTINEL_NEVER_LOG';
      f.save(filename, '{"private":"' + sentinel + '" BAD_TRAILING_DATA}');
      await assert.rejects(f.run('warm'), error => {
        assert.equal(error.code, filename === 'client.json' ? 'configuration_invalid' : 'private_record_invalid');
        assert.ok(!JSON.stringify(c.failure(error, 'retry-probe')).includes(sentinel));
        assert.ok(!error.message.includes('BAD_TRAILING_DATA'));
        return true;
      });
      assert.equal(f.requests.length, 0);
    });
  }
  const f = fixture(t);
  await f.run('warm'); f.pauseReceipt();
  f.save('probe/warm-report.json', '{"private":"PRIVATE_REPORT_SENTINEL" BAD_TRAILING_DATA}');
  const count = f.requests.length;
  await assert.rejects(f.run('durable'), error => {
    assert.equal(error.code, 'private_record_invalid');
    assert.ok(!JSON.stringify(c.failure(error, 'retry-probe')).includes('PRIVATE_REPORT_SENTINEL'));
    return true;
  });
  assert.equal(f.requests.length, count);
});

test('durable phase requires successful warm evidence, receipt, unchanged inputs and unused B between phases', async t => {
  for (const kind of ['no-warm', 'no-receipt', 'changed-input', 'used-b']) {
    await t.test(kind, async t => {
      const f = fixture(t);
      if (kind !== 'no-warm') await f.run('warm');
      if (kind !== 'no-receipt') f.pauseReceipt();
      if (kind === 'changed-input') { f.journal.requestedAt = new Date(NOW).toISOString(); f.save('original/issuance-requested.json', f.journal); }
      if (kind === 'used-b') f.rows[1].last_used_at = '2026-11-12T10:01:00+00:00';
      const before = f.posts.length;
      await assert.rejects(f.run('durable'));
      assert.equal(f.posts.length, before);
    });
  }
});

test('cold misses, generic/in-progress conflicts, and changed transaction IDs stop at the exact failed request', async t => {
  for (const kind of ['warm-cold', 'warm-progress', 'durable-progress', 'different-transaction']) {
    await t.test(kind, async t => {
      const f = fixture(t);
      if (kind.startsWith('warm')) {
        f.override = (_request, count) => kind === 'warm-cold' && count === 1 ? f.response(200, f.offer, 'false') :
          kind === 'warm-progress' && count === 2 ? f.response(409, { error: 'idempotency_in_progress' }) : null;
        await assert.rejects(f.run('warm'));
        assert.equal(f.posts.length, kind === 'warm-cold' ? 1 : 2);
      } else {
        await f.run('warm'); f.pauseReceipt();
        f.override = (_request, count) => kind === 'durable-progress' && count === 3 ? f.response(409, { error: 'idempotency_in_progress' }) :
          kind === 'different-transaction' && count === 4 ? f.response(200, { ...f.offer, id: IDS.template }, 'false') : null;
        await assert.rejects(f.run('durable'));
        assert.equal(f.posts.length, kind === 'durable-progress' ? 3 : 4);
      }
    });
  }
});

test('a timeout leaves requested evidence, redacts diagnostics, and makes both rerun and automatic retry impossible', async t => {
  const f = fixture(t);
  f.override = () => { throw new c.Stop('transport_failed', 'Timed out ' + f.secrets.a + ' ' + f.capability,
    { mutationOutcome: 'unknown' }); };
  await assert.rejects(f.run('warm'), { code: 'transport_failed' });
  assert.equal(f.posts.length, 1);
  const report = f.report('warm');
  assert.equal(report.state, 'stopped');
  assert.equal(report.failure.mutationOutcome, 'unknown');
  assert.equal(report.checks.at(-1).state, 'requested');
  assert.ok(!JSON.stringify(report).includes(f.secrets.a));
  assert.ok(!JSON.stringify(report).includes(f.capability));
  const count = f.requests.length;
  await assert.rejects(f.run('warm'), { code: 'phase_already_attempted' });
  assert.equal(f.requests.length, count);
  assert.equal(f.posts.length, 1);
  assert.equal(f.report('warm').state, 'stopped');
});

test('an unexpected successful conflict response is never followed by another issuance POST', async t => {
  const f = fixture(t);
  await f.run('warm'); f.pauseReceipt();
  f.override = () => f.response(200, { ...f.offer, id: IDS.template }, 'false');
  await assert.rejects(f.run('durable'), { code: 'retry_result_unexpected' });
  assert.equal(f.posts.length, 3);
  assert.equal(f.report('durable').durableRecoveryConfirmed, undefined);
});

test('retry evidence rejects original-directory aliases before creating anything or calling transport', async t => {
  for (const scenario of ['equal-alias', 'existing-nested-alias', 'missing-alias-child', 'missing-alias-parents', 'direct-missing-child', 'original-through-alias']) await t.test(scenario, async t => {
    const f = fixture(t), root = path.dirname(f.original);
    f.save('original/report.json', { retainedOriginalReport: true });
    fs.mkdirSync(path.join(f.original, 'retained-child'), { mode: 0o700 });
    fs.symlinkSync(root, path.join(root, 'alias'), 'dir');
    f.cfg.probeStateDirectory = {
      'equal-alias': 'alias/original', 'existing-nested-alias': 'alias/original/retained-child',
      'missing-alias-child': 'alias/original/new-child', 'missing-alias-parents': 'alias/original/new-parent/new-child',
      'direct-missing-child': 'original/new-child', 'original-through-alias': 'original/new-child',
    }[scenario];
    if (scenario === 'original-through-alias') {
      const client = c.readJson(path.join(root, 'client.json')); client.stateDirectory = 'alias/original'; f.save('client.json', client);
    }
    f.rewriteConfig();
    const before = privateTree(f.original);
    await assert.rejects(f.run('warm'), { code: 'probe_directory_invalid' });
    assert.equal(f.requests.length, 0);
    assert.deepEqual(privateTree(f.original), before, 'original files, directories and modes remain unchanged');
  });
});

test('retry evidence uses the admitted canonical directory when a disjoint ancestor alias later changes', async t => {
  const f = fixture(t), root = path.dirname(f.original), alias = path.join(root, 'alias');
  f.save('original/report.json', { retainedOriginalReport: true });
  fs.symlinkSync(root, alias, 'dir');
  f.cfg.probeStateDirectory = 'alias/probe'; f.rewriteConfig();
  const before = privateTree(f.original);
  f.override = () => { fs.unlinkSync(alias); fs.symlinkSync(f.original, alias, 'dir'); f.override = null; };
  assert.equal((await f.run('warm')).state, 'passed');
  assert.equal(f.report('warm').state, 'passed');
  assert.equal(fs.existsSync(path.join(f.original, 'probe')), false);
  assert.deepEqual(privateTree(f.original), before);
});

test('retry evidence still refuses a directly supplied disjoint symlink directory', async t => {
  const f = fixture(t), root = path.dirname(f.original);
  c.privateDir(f.evidence); fs.symlinkSync(f.evidence, path.join(root, 'direct-link'), 'dir');
  f.cfg.probeStateDirectory = 'direct-link'; f.rewriteConfig();
  await assert.rejects(f.run('warm'), { code: 'private_directory_type' });
  assert.equal(f.requests.length, 0);
  assert.deepEqual(fs.readdirSync(f.evidence), []);
});
