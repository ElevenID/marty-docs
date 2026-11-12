#!/usr/bin/env node
'use strict';

// Standalone customer fixture, adapted from ElevenID/marty-ui at b7c70558:
// tests/scripts/run-canvas-oss-standard-contract.js (offer, discovery, proof,
// did:web resolution, compact-JWS verification) and run-kubernetes-acceptance.cjs
// (transaction/issued-record readback). No Marty packages or internal headers.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const assert = require('node:assert/strict');
const { isDeepStrictEqual } = require('node:util');

const MAX_BYTES = 4 * 1024 * 1024;
const SOURCE = 'ElevenID/marty-ui@b7c7055830722d10512ccac042b1e0abe0e1ecec';
const PRE_AUTH = 'urn:ietf:params:oauth:grant-type:pre-authorized_code';
const secrets = new Set();
let stage = 'configuration';
let stateDir;
let report;

class Stop extends Error {
  constructor(code, message, extra = {}) { super(message); this.code = code; this.extra = extra; }
}
function need(condition, code, message, extra) { if (!condition) throw new Stop(code, message, extra); }
function nonempty(x) { return typeof x === 'string' && x.trim().length > 0; }
function b64json(x) { return Buffer.from(JSON.stringify(x)).toString('base64url'); }
function hash(x) { return crypto.createHash('sha256').update(x).digest('hex'); }
function publicJwk(key) {
  const { kty, crv, x, y } = crypto.createPublicKey(key).export({ format: 'jwk' });
  return { kty, crv, x, y };
}
function holderDid(jwk) { return `did:jwk:${b64json(jwk)}`; }
function sanitize(input) {
  let s = String(input || '');
  for (const secret of secrets) if (secret) s = s.split(secret).join('[redacted]');
  return s.replace(/(?:mk|pk)_(?:test|live)_[A-Za-z0-9_-]+/g, '[api-key]')
    .replace(/\beyJ[A-Za-z0-9_-]*\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g, '[jwt]')
    .replace(/([?&](?:code|state|credential_offer|credential_offer_uri)=)[^&\s]+/gi, '$1[redacted]')
    .slice(0, 500);
}
function privateRead(file) {
  const stat = fs.lstatSync(file);
  need(stat.isFile() && !stat.isSymbolicLink(), 'private_file_type', 'Expected a regular file.');
  need(stat.size <= MAX_BYTES, 'private_file_size', 'File exceeds the fixture limit.');
  if (process.platform !== 'win32') need((stat.mode & 0o077) === 0, 'private_file_permissions', 'Private input must be mode 0600.');
  return fs.readFileSync(file, 'utf8');
}
function privateWrite(name, value, exclusive = false) {
  const file = path.join(stateDir, name);
  const bytes = typeof value === 'string' ? value : JSON.stringify(value, null, 2) + '\n';
  const fd = fs.openSync(file, fs.constants.O_WRONLY | fs.constants.O_CREAT |
    (exclusive ? fs.constants.O_EXCL : fs.constants.O_TRUNC) | fs.constants.O_NOFOLLOW, 0o600);
  try { fs.writeFileSync(fd, bytes); fs.fchmodSync(fd, 0o600); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
}
function readState(name) { return JSON.parse(privateRead(path.join(stateDir, name))); }
function event(name, outcome, detail = {}) {
  const item = { at: new Date().toISOString(), check: name, outcome, ...detail };
  report.checks.push(item);
  privateWrite('report.json', report);
  process.stdout.write(JSON.stringify(item) + '\n');
}
function secureUrl(value, origin) {
  let url;
  try { url = new URL(value); } catch { throw new Stop('invalid_url', 'An endpoint is not an absolute URL.'); }
  need(url.protocol === 'https:' && url.origin === origin && !url.username && !url.password && !url.hash,
    'untrusted_endpoint', 'Endpoint must be HTTPS on the explicitly configured origin.');
  return url;
}
function endpoint(value, origin) {
  const url = secureUrl(value, origin);
  need(!url.search, 'endpoint_query', 'Discovered endpoint must not contain a query.');
  return url;
}
function normalizeIssuer(url) { return url.href.replace(/\/$/, ''); }
function setup(configPath) {
  need(process.env.NODE_TLS_REJECT_UNAUTHORIZED !== '0', 'tls_verification_disabled', 'TLS verification must stay enabled.');
  const cfg = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  const origin = new URL(cfg.origin);
  need(origin.protocol === 'https:' && origin.href === origin.origin + '/', 'origin_invalid', 'origin must be an HTTPS origin without a path.');
  cfg.origin = origin.origin;
  need(['api-key', 'instructor-session'].includes(cfg.authMode), 'auth_mode_required',
    'Select authMode api-key or instructor-session explicitly; there is no fallback.');
  for (const field of ['organizationId', 'credentialTemplateId', 'issuerDid', 'achievementId', 'learnerId', 'completionEventId', 'stateDirectory']) {
    need(nonempty(cfg[field]), 'configuration_missing', `Missing ${field}.`);
    need(!cfg[field].includes('REPLACE'), 'configuration_placeholder', `Replace ${field} before running.`);
  }
  need(cfg.issuerDid.startsWith('did:web:'), 'issuer_method_unsupported', 'This narrow fixture supports did:web issuer resolution.');
  endpoint(didWebUrl(cfg.issuerDid), cfg.origin);
  cfg.timeoutMs = cfg.timeoutMs || 30000;
  need(Number.isInteger(cfg.timeoutMs) && cfg.timeoutMs >= 1000 && cfg.timeoutMs <= 120000,
    'timeout_invalid', 'timeoutMs must be 1000–120000.');
  stateDir = path.resolve(path.dirname(configPath), cfg.stateDirectory);
  if (!fs.existsSync(stateDir)) fs.mkdirSync(stateDir, { mode: 0o700 });
  const stat = fs.lstatSync(stateDir);
  need(stat.isDirectory() && !stat.isSymbolicLink(), 'state_directory_type', 'State directory must be a real directory.');
  if (process.platform !== 'win32') need((stat.mode & 0o077) === 0, 'state_directory_permissions', 'State directory must be mode 0700.');
  const configBinding = hash(JSON.stringify({ origin: cfg.origin, authMode: cfg.authMode, organizationId: cfg.organizationId,
    credentialTemplateId: cfg.credentialTemplateId, issuerDid: cfg.issuerDid,
    achievementId: cfg.achievementId, learnerId: cfg.learnerId, completionEventId: cfg.completionEventId }));
  report = fs.existsSync(path.join(stateDir, 'report.json')) ? readState('report.json') : {
    schema: 'elevenid.ob3-customer-trial/v1', source: SOURCE, startedAt: new Date().toISOString(),
    configBinding, authMode: cfg.authMode, checks: [], fullSchemaValidation: 'not-performed', revocationValidation: 'not-performed',
    certificationClaim: false, automaticMutationReplay: false,
  };
  need(report.configBinding === configBinding, 'state_configuration_mismatch', 'Existing state belongs to a different configuration. Use a new directory.');
  cfg.subjectFile = path.resolve(path.dirname(configPath), cfg.subjectFile || 'course-subject.example.json');
  return cfg;
}
function apiKey() {
  need(nonempty(process.env.MARTY_API_KEY_FILE), 'api_key_file_missing', 'Set MARTY_API_KEY_FILE to a private key file.');
  const key = privateRead(process.env.MARTY_API_KEY_FILE).trim();
  need(/^(mk|pk)_(test|live)_\S+$/.test(key), 'api_key_invalid', 'Expected an organization API key, not an OIDC or administrator token.');
  secrets.add(key);
  return key;
}
function authenticationHeaders(cfg, invalid = false) {
  if (cfg.authMode === 'api-key') return { 'X-API-Key': invalid ? 'mk_test_deliberately_invalid_ob3_fixture' : apiKey() };
  if (invalid) return { Cookie: 'sessionId=deliberately_invalid_ob3_fixture_session' };
  need(nonempty(process.env.MARTY_SESSION_ID_FILE), 'session_file_missing',
    'Set MARTY_SESSION_ID_FILE to a private sessionId file from a normal authenticated login.');
  const session = privateRead(process.env.MARTY_SESSION_ID_FILE).trim();
  need(nonempty(session) && /^[A-Za-z0-9._~+/=-]+$/.test(session), 'session_value_invalid',
    'Session file must contain the sessionId value only, not cookies, headers or an OIDC token.');
  secrets.add(session);
  return { Cookie: `sessionId=${session}` };
}
async function request(cfg, url, opts = {}) {
  const safe = secureUrl(String(url), cfg.origin);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), cfg.timeoutMs);
  try {
    const response = await fetch(safe, { ...opts, redirect: 'manual', signal: controller.signal });
    need(response.status < 300 || response.status >= 400, 'redirect_refused', 'An HTTP redirect was refused; correct the configured origin.');
    const length = Number(response.headers.get('content-length') || 0);
    need(length <= MAX_BYTES, 'response_too_large', 'Response exceeds the fixture limit.');
    const chunks = []; let size = 0;
    for await (const chunk of response.body || []) {
      size += chunk.length;
      need(size <= MAX_BYTES, 'response_too_large', 'Response exceeds the fixture limit.');
      chunks.push(chunk);
    }
    const raw = Buffer.concat(chunks).toString('utf8');
    let json;
    try { json = JSON.parse(raw); } catch { json = null; }
    return { status: response.status, json, raw, correlationId: response.headers.get('x-correlation-id') };
  } catch (error) {
    if (error instanceof Stop) throw error;
    const code = error.cause?.code || error.code || error.name;
    throw new Stop('transport_failed', 'Request failed; no automatic retry was attempted.', { transportCode: sanitize(code), mutationOutcome: opts.method && opts.method !== 'GET' ? 'unknown' : 'read-only' });
  } finally { clearTimeout(timer); }
}
function requireJson(response, code) {
  need(response.status >= 200 && response.status < 300, code, 'Public endpoint rejected the request.', {
    httpStatus: response.status,
    diagnostic: sanitize(response.json?.error?.message || response.json?.error?.code || response.json?.detail || response.json?.message || response.json?.error || 'non-JSON response'),
    correlationId: sanitize(response.correlationId),
  });
  need(response.json && typeof response.json === 'object', 'json_response_required', 'Endpoint did not return JSON.');
  return response.json;
}
async function api(cfg, method, route, body, extraHeaders = {}, auth = authenticationHeaders(cfg)) {
  return request(cfg, cfg.origin + route, { method, headers: {
    Accept: 'application/json', ...auth,
    ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...extraHeaders,
  }, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
}
function loadHolder() {
  const pem = privateRead(path.join(stateDir, 'learner-private-key.pem'));
  const key = crypto.createPrivateKey(pem);
  const jwk = publicJwk(key);
  need(jwk.kty === 'EC' && jwk.crv === 'P-256', 'holder_key_type', 'Learner key must be P-256.');
  return { key, jwk, did: holderDid(jwk) };
}
function prepare() {
  if (!fs.existsSync(path.join(stateDir, 'learner-private-key.pem'))) {
    const { privateKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'P-256' });
    privateWrite('learner-private-key.pem', privateKey.export({ type: 'pkcs8', format: 'pem' }), true);
  }
  const holder = loadHolder();
  event('learner-key-retained', 'passed', { holderDidSha256: hash(holder.did) });
  return holder;
}
async function preflight(cfg) {
  stage = 'preflight';
  const route = '/v1/credential-templates/' + encodeURIComponent(cfg.credentialTemplateId);
  for (const [name, auth] of [['missing-authentication', {}], [`invalid-${cfg.authMode}`, authenticationHeaders(cfg, true)], [`${cfg.authMode}-template-read`, authenticationHeaders(cfg)]]) {
    const response = await api(cfg, 'GET', route, undefined, {}, auth);
    privateWrite(name + '-response.json', { status: response.status, body: response.json || response.raw });
    const denied = [401, 403].includes(response.status);
    if (name !== `${cfg.authMode}-template-read`) {
      event(name, denied ? 'passed' : 'failed', { httpStatus: response.status, expectation: '401-or-403' });
    } else {
      event(name, response.status === 200 ? 'passed' : 'failed', { httpStatus: response.status,
        diagnostic: sanitize(response.json?.error?.message || response.json?.message || response.json?.detail || response.json?.error || '') });
      if (response.status === 200) {
        const template = requireJson(response, 'template_read_failed');
        need(template.organization_id === cfg.organizationId && template.issuer_did === cfg.issuerDid && template.vct === cfg.achievementId,
          'template_binding_mismatch', 'Selected template differs from the explicit client configuration.');
        need(String(template.status).toUpperCase() === 'ACTIVE' && String(template.credential_payload_format).toUpperCase() === 'VC_JWT',
          'template_not_active_vc_jwt', 'This fixture requires an active VC_JWT course template.');
        privateWrite('selected-template.json', template);
      }
    }
  }
  const recent = report.checks.slice(-3);
  need(recent.every(x => x.outcome === 'passed'), 'preflight_failed', 'Preflight exposed a public API authentication or template access failure. Review the private responses.');
}
async function issue(cfg) {
  stage = 'initiate-course-credential';
  // A pre-written journal blocks replays after a timeout or an ambiguous result.
  need(!fs.existsSync(path.join(stateDir, 'issuance-requested.json')), 'issuance_already_attempted', 'Issuance was already attempted. Reconcile the existing event and transaction; do not automatically replay it.');
  const holder = prepare();
  const subject = JSON.parse(fs.readFileSync(cfg.subjectFile, 'utf8'));
  need(subject?.achievement?.id === cfg.achievementId && subject?.learner_id === cfg.learnerId,
    'subject_configuration_mismatch', 'Course subject must match configured achievement and learner.');
  need(!subject.id || subject.id === holder.did, 'subject_holder_mismatch', 'Subject id differs from retained learner key.');
  subject.id = holder.did;
  const body = { organization_id: cfg.organizationId, credential_template_id: cfg.credentialTemplateId,
    issuer_did: cfg.issuerDid, subject_did: holder.did, holder_did: holder.did, credential_subject: subject };
  privateWrite('issuance-requested.json', { requestedAt: new Date().toISOString(), completionEventId: cfg.completionEventId, body }, true);
  const response = await api(cfg, 'POST', '/v1/issuance', body, { 'Idempotency-Key': cfg.completionEventId });
  privateWrite('issuance-response.json', { status: response.status, body: response.json || response.raw }, true);
  const offer = requireJson(response, 'issuance_failed');
  need(nonempty(offer.id) && offer.organization_id === cfg.organizationId && offer.credential_template_id === cfg.credentialTemplateId
    && nonempty(offer.credential_offer_uri), 'issuance_offer_invalid', 'Issuance response omitted or mismatched its transaction/offer.');
  privateWrite('offer-private.json', offer, true);
  event('course-offer-created', 'passed', { httpStatus: response.status, transactionId: offer.id });
}
function parseOffer(uri) {
  const url = new URL(uri);
  need(url.protocol === 'openid-credential-offer:', 'offer_scheme', 'Expected an openid-credential-offer URI.');
  need(url.searchParams.has('credential_offer'), 'referenced_offer_unsupported', 'This narrow fixture supports inline offers; a referenced offer requires a separately reviewed retrieval policy.');
  const offer = JSON.parse(url.searchParams.get('credential_offer'));
  const grant = offer?.grants?.[PRE_AUTH];
  need(nonempty(offer.credential_issuer) && Array.isArray(offer.credential_configuration_ids) && offer.credential_configuration_ids.length === 1
    && nonempty(grant?.['pre-authorized_code']), 'offer_incomplete', 'Expected one configuration and a pre-authorized-code grant.');
  need(!grant.tx_code, 'transaction_code_required', 'This narrow fixture needs a supplied transaction code when the issuer requires one.');
  secrets.add(grant['pre-authorized_code']);
  return { issuer: offer.credential_issuer, configurationId: offer.credential_configuration_ids[0], code: grant['pre-authorized_code'] };
}
async function discovery(cfg, offer) {
  const issuer = endpoint(offer.issuer, cfg.origin);
  const metadataUrl = `${issuer.origin}/.well-known/openid-credential-issuer${issuer.pathname}`;
  const metadata = requireJson(await request(cfg, metadataUrl, { headers: { Accept: 'application/json' } }), 'issuer_metadata_failed');
  need(normalizeIssuer(endpoint(metadata.credential_issuer, cfg.origin)) === normalizeIssuer(issuer), 'metadata_issuer_mismatch', 'Issuer metadata differs from the offer issuer.');
  const credentialEndpoint = endpoint(metadata.credential_endpoint, cfg.origin);
  let tokenEndpoint = metadata.token_endpoint;
  if (!tokenEndpoint) {
    need(Array.isArray(metadata.authorization_servers) && metadata.authorization_servers.length === 1,
      'authorization_server_ambiguous', 'Expected exactly one explicitly pinned authorization server.');
    const auth = endpoint(metadata.authorization_servers[0], cfg.origin);
    const authPath = auth.pathname === '/' ? '' : auth.pathname.replace(/\/$/, '');
    const authMetadata = requireJson(await request(cfg, `${auth.origin}/.well-known/oauth-authorization-server${authPath}`,
      { headers: { Accept: 'application/json' } }), 'authorization_metadata_failed');
    need(normalizeIssuer(endpoint(authMetadata.issuer, cfg.origin)) === normalizeIssuer(auth), 'authorization_issuer_mismatch', 'Authorization metadata issuer mismatch.');
    tokenEndpoint = authMetadata.token_endpoint;
  }
  const configuration = metadata.credential_configurations_supported?.[offer.configurationId];
  need(configuration && configuration.format === 'jwt_vc_json', 'credential_configuration_format', 'Offered configuration must advertise jwt_vc_json.');
  privateWrite('issuer-metadata.json', metadata);
  return { token: endpoint(tokenEndpoint, cfg.origin), credential: credentialEndpoint,
    nonce: metadata.nonce_endpoint ? endpoint(metadata.nonce_endpoint, cfg.origin) : null };
}
function holderProof(holder, issuer, nonce) {
  const header = { typ: 'openid4vci-proof+jwt', alg: 'ES256', jwk: holder.jwk };
  const payload = { iss: holder.did, sub: holder.did, aud: issuer, iat: Math.floor(Date.now() / 1000), nonce, jti: crypto.randomUUID() };
  const unsigned = `${b64json(header)}.${b64json(payload)}`;
  return `${unsigned}.${crypto.sign('sha256', Buffer.from(unsigned), { key: holder.key, dsaEncoding: 'ieee-p1363' }).toString('base64url')}`;
}
async function claim(cfg) {
  stage = 'oid4vci-claim';
  need(!fs.existsSync(path.join(stateDir, 'claim-started.json')), 'claim_already_attempted', 'Claim was already attempted. Preserve state and reconcile; pre-authorized-code and proof replay are not automatic.');
  const rawOffer = readState('offer-private.json');
  const offer = parseOffer(rawOffer.credential_offer_uri);
  const holder = loadHolder();
  const endpoints = await discovery(cfg, offer);
  privateWrite('claim-started.json', { at: new Date().toISOString(), transactionId: rawOffer.id }, true);
  const tokenResponse = await request(cfg, endpoints.token.href, { method: 'POST', headers: { Accept: 'application/json', 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: PRE_AUTH, 'pre-authorized_code': offer.code }).toString() });
  privateWrite('token-response-private.json', { status: tokenResponse.status, body: tokenResponse.json || tokenResponse.raw }, true);
  const token = requireJson(tokenResponse, 'token_exchange_failed');
  need(nonempty(token.access_token), 'token_missing', 'Token response omitted access_token.');
  secrets.add(token.access_token);
  let nonce = token.c_nonce || token.nonce;
  if (!nonce) {
    need(endpoints.nonce, 'nonce_endpoint_missing', 'Token response has no nonce, and metadata advertises no nonce endpoint.');
    const body = requireJson(await request(cfg, endpoints.nonce.href, { method: 'POST', headers: { Accept: 'application/json' } }), 'nonce_request_failed');
    nonce = body.c_nonce || body.nonce;
  }
  need(nonempty(nonce), 'nonce_missing', 'No proof nonce returned.');
  secrets.add(nonce);
  const proof = holderProof(holder, offer.issuer, nonce);
  secrets.add(proof);
  const response = await request(cfg, endpoints.credential.href, { method: 'POST', headers: {
    Accept: 'application/json', 'Content-Type': 'application/json', Authorization: `Bearer ${token.access_token}`,
  }, body: JSON.stringify({ credential_configuration_id: offer.configurationId, proofs: { jwt: [proof] } }) });
  privateWrite('credential-response-private.json', { status: response.status, body: response.json || response.raw }, true);
  const issued = requireJson(response, 'credential_request_failed');
  const credential = issued.credential || issued.credentials?.[0]?.credential || issued.credentials?.[0];
  need(nonempty(credential) && credential.split('.').length === 3 && !credential.includes('~'),
    'compact_vc_jwt_missing', 'Expected one complete compact VC-JWT; deferred and SD-JWT responses are outside this fixture.');
  privateWrite('credential.jwt', credential + '\n', true);
  event('learner-received-compact-credential', 'passed', { credentialSha256: hash(credential), signatureVerification: 'pending' });
}
function decodeCompact(compact) {
  const parts = compact.split('.');
  need(parts.length === 3 && parts.every(x => /^[A-Za-z0-9_-]+$/.test(x)), 'invalid_compact_jws', 'Expected a compact JWS with canonical base64url components.');
  for (const part of parts) need(Buffer.from(part, 'base64url').toString('base64url') === part, 'noncanonical_base64url', 'JWS component is not canonical base64url.');
  let header, payload;
  try { header = JSON.parse(Buffer.from(parts[0], 'base64url')); payload = JSON.parse(Buffer.from(parts[1], 'base64url')); }
  catch { throw new Stop('invalid_jwt_json', 'JWT header or payload is invalid JSON.'); }
  return { parts, header, payload };
}
function didWebUrl(did) {
  need(did.startsWith('did:web:'), 'issuer_method_unsupported', 'This fixture supports did:web issuers.');
  const segments = did.slice(8).split(':').map(decodeURIComponent);
  need(segments.length && segments.every(x => x && !/[/?#@]/.test(x)) && !segments.slice(1).some(x => x === '.' || x === '..'),
    'did_web_invalid', 'Invalid did:web authority or path.');
  return `https://${segments[0]}${segments.length === 1 ? '/.well-known' : '/' + segments.slice(1).map(encodeURIComponent).join('/')}/did.json`;
}
function verifySignature(compact, document, expectedIssuer) {
  const { parts, header, payload } = decodeCompact(compact);
  need(payload.iss === expectedIssuer && document.id === expectedIssuer, 'issuer_mismatch', 'Credential or public DID document differs from configured issuer.');
  need(!header.crit && header.b64 !== false && !header.jku && !header.jwk && !header.x5u, 'unsupported_jose_header', 'Untrusted JOSE key override or critical extension refused.');
  need(nonempty(header.kid), 'kid_missing', 'JWT must identify its issuer assertion key.');
  const absolute = id => id?.startsWith('#') ? expectedIssuer + id : id;
  const kid = absolute(header.kid);
  const assertions = Array.isArray(document.assertionMethod) ? document.assertionMethod : [];
  need(assertions.some(x => absolute(typeof x === 'string' ? x : x?.id) === kid), 'unauthorized_assertion_key', 'JWT key is not authorized by issuer assertionMethod.');
  const methods = [...(Array.isArray(document.verificationMethod) ? document.verificationMethod : []), ...assertions.filter(x => x && typeof x === 'object')];
  const method = methods.find(x => absolute(x.id) === kid);
  need(method?.publicKeyJwk && method.controller === expectedIssuer, 'issuer_key_missing', 'Public assertion method/controller is missing or mismatched.');
  const jwk = method.publicKeyJwk;
  need(!['d', 'p', 'q', 'dp', 'dq', 'qi', 'oth', 'k'].some(k => k in jwk), 'private_key_in_did', 'DID assertion method must contain only public key material.');
  need(!jwk.alg || jwk.alg === header.alg, 'jwk_algorithm_mismatch', 'JWK alg differs from the signed JWT.');
  need(!jwk.use || jwk.use === 'sig', 'jwk_use_mismatch', 'JWK is not a signing key.');
  need(!jwk.key_ops || (Array.isArray(jwk.key_ops) && jwk.key_ops.includes('verify')), 'jwk_key_ops_mismatch', 'JWK does not authorize signature verification.');
  const key = crypto.createPublicKey({ key: jwk, format: 'jwk' });
  const bytes = Buffer.from(`${parts[0]}.${parts[1]}`);
  const signature = Buffer.from(parts[2], 'base64url');
  let valid;
  if (header.alg === 'ES256' && jwk.kty === 'EC' && jwk.crv === 'P-256') {
    valid = signature.length === 64 && crypto.verify('sha256', bytes, { key, dsaEncoding: 'ieee-p1363' }, signature);
  } else if (header.alg === 'RS256' && jwk.kty === 'RSA') {
    valid = crypto.verify('RSA-SHA256', bytes, key, signature);
  } else if (header.alg === 'EdDSA' && jwk.kty === 'OKP' && jwk.crv === 'Ed25519') {
    valid = crypto.verify(null, bytes, key, signature);
  } else throw new Stop('algorithm_unsupported', 'Signing algorithm and public key type are not a supported pair.');
  need(valid, 'signature_invalid', 'Credential signature does not verify with the authorized published key.');
  return { header, payload };
}
function validateBindings(payload, cfg, holder, now = Date.now()) {
  const vc = payload.vc;
  need(vc && typeof vc === 'object', 'vc_missing', 'JWT does not contain a VC object.');
  need(nonempty(payload.jti) && (vc.id === undefined || vc.id === payload.jti), 'credential_id_mismatch',
    'JWT jti must identify the credential; an embedded VC id, when present, must agree.');
  const issuer = typeof vc.issuer === 'string' ? vc.issuer : vc.issuer?.id;
  need(issuer === cfg.issuerDid, 'vc_issuer_mismatch', 'VC issuer differs from configured issuer.');
  const types = Array.isArray(vc.type) ? vc.type : [vc.type];
  need(types.includes('VerifiableCredential') && types.includes('OpenBadgeCredential'), 'ob3_type_missing', 'VC lacks the OpenBadgeCredential types.');
  const contexts = Array.isArray(vc['@context']) ? vc['@context'] : [vc['@context']];
  const version = contexts.includes('https://www.w3.org/ns/credentials/v2') ? '2.0'
    : contexts.includes('https://www.w3.org/2018/credentials/v1') ? '1.1' : null;
  need(version, 'vc_context_missing', 'VC lacks a recognized VC context.');
  need(contexts.some(x => ['https://purl.imsglobal.org/spec/ob/v3p0/context.json',
    'https://purl.imsglobal.org/spec/ob/v3p0/context-3.0.3.json', 'https://w3id.org/openbadges/v3'].includes(x)),
  'ob3_context_missing', 'VC lacks an Open Badges 3 context.');
  const subject = vc.credentialSubject;
  need(subject && !Array.isArray(subject), 'subject_shape_invalid', 'Expected one AchievementSubject.');
  const subjectTypes = Array.isArray(subject.type) ? subject.type : [subject.type];
  need(subjectTypes.includes('AchievementSubject') && subject.id === holder.did, 'recipient_mismatch', 'AchievementSubject is not the intended retained learner identity.');
  const cnf = payload.cnf?.jwk;
  const subjectBinding = payload.sub === holder.did;
  const keyBinding = !!cnf && ['kty', 'crv', 'x', 'y'].every(k => cnf[k] === holder.jwk[k]);
  if (payload.sub !== undefined) need(subjectBinding, 'holder_binding_mismatch', 'JWT sub contradicts the retained learner identity.');
  if (payload.cnf !== undefined) need(keyBinding, 'holder_binding_mismatch', 'JWT confirmation key is unsupported or contradicts the retained learner key.');
  need(subjectBinding || keyBinding, 'holder_binding_missing', 'JWT is not bound to the learner proof key.');
  need(subject.learner_id === cfg.learnerId, 'learner_claim_mismatch', 'Signed learner_id differs from client completion event.');
  const achievement = subject.achievement;
  const achievementTypes = Array.isArray(achievement?.type) ? achievement.type : [achievement?.type];
  need(achievement?.id === cfg.achievementId && achievementTypes.includes('Achievement') && nonempty(achievement.name)
    && nonempty(achievement.description), 'achievement_mismatch', 'Signed achievement is missing or differs from the configured course.');
  // OB3 requires a Criteria object; id and narrative are optional. The later
  // journal comparison checks this course's exact criteria without inventing
  // a stricter generic profile requirement.
  need(achievement.criteria !== null && typeof achievement.criteria === 'object'
    && !Array.isArray(achievement.criteria), 'achievement_criteria_missing', 'Course badge must carry a criteria object.');
  const from = version === '2.0' ? vc.validFrom : vc.issuanceDate;
  const until = version === '2.0' ? vc.validUntil : vc.expirationDate;
  need(nonempty(from) && Number.isFinite(Date.parse(from)), 'valid_from_missing', 'VC issuance/validFrom date missing or invalid.');
  need(Date.parse(from) <= now + 30000, 'not_yet_valid', 'VC is not yet valid.');
  if (until !== undefined) need(nonempty(until) && Number.isFinite(Date.parse(until)) && Date.parse(until) > now, 'expired', 'VC is expired or has an invalid expiry.');
  for (const field of ['iat', 'nbf', 'exp']) if (payload[field] !== undefined)
    need(typeof payload[field] === 'number' && Number.isFinite(payload[field]), 'numeric_date_invalid', 'JWT NumericDate field is invalid.');
  if (payload.nbf !== undefined) need(payload.nbf * 1000 <= now + 30000, 'not_yet_valid', 'JWT nbf is in the future.');
  if (payload.exp !== undefined) need(payload.exp * 1000 > now, 'expired', 'JWT is expired.');
  return { vcDataModel: version, credentialId: payload.jti, embeddedVcIdPresent: vc.id !== undefined,
    statusPresent: !!vc.credentialStatus };
}
async function verify(cfg) {
  stage = 'independent-signature-verification';
  const credential = privateRead(path.join(stateDir, 'credential.jwt')).trim();
  const document = requireJson(await request(cfg, didWebUrl(cfg.issuerDid), {
    headers: { Accept: 'application/did+json, application/json' },
  }), 'issuer_did_unavailable');
  privateWrite('public-issuer-did.json', document);
  const verified = verifySignature(credential, document, cfg.issuerDid);
  privateWrite('credential-decoded.json', verified.payload);
  const binding = validateBindings(verified.payload, cfg, loadHolder());
  const requestedSubject = readState('issuance-requested.json').body?.credential_subject;
  need(requestedSubject?.achievement && requestedSubject.learner_id === cfg.learnerId,
    'issuance_journal_invalid', 'The retained issuance journal does not identify the expected course and learner.');
  const signedAchievement = verified.payload.vc.credentialSubject.achievement;
  need(['name', 'description', 'criteria'].every(field => isDeepStrictEqual(signedAchievement[field], requestedSubject.achievement[field])),
    'course_claims_changed', 'Signed course name, description or criteria differs from the journaled completion event.');
  event('independent-signature-and-recipient-checks', 'passed', { ...binding, credentialSha256: hash(credential),
    fullSchemaValidation: 'not-performed', revocationValidation: 'not-performed' });
  const parts = credential.split('.');
  const changed = structuredClone(verified.payload);
  changed.vc.credentialSubject.achievement.name = 'Tampered course name';
  const tampered = `${parts[0]}.${b64json(changed)}.${parts[2]}`;
  privateWrite('tampered-credential.jwt', tampered + '\n');
  let rejected = false;
  try { verifySignature(tampered, document, cfg.issuerDid); } catch (error) { rejected = error.code === 'signature_invalid'; }
  need(rejected, 'tamper_test_failed', 'Tampered credential was not rejected by cryptographic verification.');
  event('course-name-tamper-rejected', 'passed');
  return { ...binding, credentialSha256: hash(credential) };
}
async function readback(cfg) {
  stage = 'public-readback';
  const offer = readState('offer-private.json');
  const credential = privateRead(path.join(stateDir, 'credential.jwt')).trim();
  const { payload } = decodeCompact(credential);
  const transaction = requireJson(await api(cfg, 'GET', '/v1/issuance/' + encodeURIComponent(offer.id)), 'transaction_readback_failed');
  privateWrite('transaction-readback.json', transaction);
  need(transaction.id === offer.id && transaction.organization_id === cfg.organizationId && transaction.credential_template_id === cfg.credentialTemplateId
    && transaction.status === 'issued' && transaction.application_id == null,
    'transaction_persistence_mismatch', 'Transaction readback does not match completed direct issuance.');
  const record = requireJson(await api(cfg, 'GET', '/v1/issued-credentials/' + encodeURIComponent(payload.jti)), 'credential_readback_failed');
  privateWrite('issued-record-readback.json', record);
  need(record.id === payload.jti && record.credential_id === payload.jti && record.organization_id === cfg.organizationId
    && record.credential_template_id === cfg.credentialTemplateId && record.credential_hash === hash(credential)
    && record.status === 'ACTIVE' && record.flow_execution_id === offer.id && record.application_id == null,
  'credential_persistence_mismatch', 'Issued credential metadata does not match the portable signed artifact.');
  event('transaction-and-artifact-readback', 'passed', { transactionStatus: transaction.status, credentialStatus: record.status });
}
function offlineCheck() {
  // This proves fixture cryptography, not a deployed integration or OB3 certification.
  const issuer = 'did:web:issuer.example';
  const { privateKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'P-256' });
  const jwk = publicJwk(privateKey);
  const kid = issuer + '#key-1';
  const doc = { id: issuer, verificationMethod: [{ id: kid, controller: issuer, publicKeyJwk: jwk }], assertionMethod: [kid] };
  const header = { alg: 'ES256', typ: 'vc+jwt', kid };
  const payload = { iss: issuer, marker: 'original' };
  const unsigned = `${b64json(header)}.${b64json(payload)}`;
  const signature = crypto.sign('sha256', Buffer.from(unsigned), { key: privateKey, dsaEncoding: 'ieee-p1363' }).toString('base64url');
  const token = `${unsigned}.${signature}`;
  assert.equal(verifySignature(token, doc, issuer).payload.marker, 'original');
  assert.throws(() => verifySignature(`${b64json(header)}.${b64json({ ...payload, marker: 'changed' })}.${signature}`, doc, issuer), { code: 'signature_invalid' });
  assert.throws(() => verifySignature(token, { ...doc, assertionMethod: [] }, issuer), { code: 'unauthorized_assertion_key' });
  assert.throws(() => verifySignature(token, doc, 'did:web:another.example'), { code: 'issuer_mismatch' });
  const proof = holderProof({ key: privateKey, jwk, did: holderDid(jwk) }, 'https://issuer.example', 'test-nonce');
  const parsed = decodeCompact(proof);
  assert.equal(parsed.header.typ, 'openid4vci-proof+jwt');
  assert.equal(parsed.payload.nonce, 'test-nonce');
  assert(crypto.verify('sha256', Buffer.from(parsed.parts.slice(0, 2).join('.')), { key: crypto.createPublicKey(privateKey), dsaEncoding: 'ieee-p1363' }, Buffer.from(parsed.parts[2], 'base64url')));
  process.stdout.write(JSON.stringify({ result: 'passed', scope: 'offline-fixture-cryptography-only', checks: [
    'valid-ES256-signature', 'tampered-payload-rejected', 'unauthorized-assertion-key-rejected', 'wrong-issuer-rejected', 'holder-proof-signature-and-nonce' ], liveIntegration: 'not-run' }) + '\n');
}
async function main() {
  process.umask(0o077);
  need(Number(process.versions.node.split('.')[0]) >= 24, 'unsupported_node_version',
    'This fixture requires Node.js 24 or newer. No network request or state mutation was attempted.');
  const [command, configPath] = process.argv.slice(2);
  if (command === 'offline-check') return offlineCheck();
  need(['prepare', 'preflight', 'issue', 'claim', 'verify', 'readback', 'run'].includes(command) && configPath,
    'usage', 'Usage: node ob3-client.cjs <prepare|preflight|issue|claim|verify|readback|run> config.json OR offline-check');
  const cfg = setup(path.resolve(configPath));
  if (command === 'prepare') prepare();
  if (command === 'preflight' || command === 'run') await preflight(cfg);
  if (command === 'issue' || command === 'run') await issue(cfg);
  if (command === 'claim' || command === 'run') await claim(cfg);
  if (command === 'verify' || command === 'run') await verify(cfg);
  if (command === 'readback' || command === 'run') await readback(cfg);
  privateWrite('report.json', { ...report, lastCommand: command, lastCommandResult: 'passed', updatedAt: new Date().toISOString() });
}
if (require.main === module) main().catch(error => {
  const result = { at: new Date().toISOString(), result: 'stopped', stage,
    code: /^[a-z0-9_]{1,90}$/.test(error.code || '') ? error.code : 'client_step_failed',
    message: sanitize(error.message), ...(error instanceof Stop ? error.extra : {}),
    privateStatePreserved: true, automaticMutationReplay: false };
  if (stateDir && report) {
    report.lastCommand = process.argv[2];
    report.lastCommandResult = 'stopped';
    report.updatedAt = result.at;
    report.checks.push(result);
    try { privateWrite('report.json', report); } catch {}
  }
  process.stdout.write(JSON.stringify(result) + '\n');
  process.exitCode = 1;
});

module.exports = { parseOffer, didWebUrl, holderProof, verifySignature, validateBindings, decodeCompact };
