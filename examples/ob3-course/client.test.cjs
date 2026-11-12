'use strict';

// Offline client-boundary checks. These do not qualify a deployed issuer.
const assert = require('node:assert/strict');
const { test } = require('node:test');
const { validateBindings, parseOffer } = require('./ob3-client.cjs');
const { CookieJar, loginForm } = require('./public-login.cjs');

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
