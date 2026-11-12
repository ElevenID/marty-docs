#!/usr/bin/env node
'use strict';

// Ordinary public Authorization Code + PKCE login, driven by observed HTML forms.
// The application owns PKCE/state/token exchange. This helper is the browser actor.
const fs = require('node:fs');
const path = require('node:path');
const c = require('./public-client-common.cjs');
let stage = 'configuration';
let directory;
let report;

function decodeHtml(value) {
  return String(value).replace(/&(#x[0-9a-f]+|#[0-9]+|amp|quot|apos|lt|gt);/gi, (_, token) => {
    const names = { amp: '&', quot: '"', apos: "'", lt: '<', gt: '>' };
    if (token[0] !== '#') return names[token.toLowerCase()];
    const code = token[1].toLowerCase() === 'x' ? parseInt(token.slice(2), 16) : parseInt(token.slice(1), 10);
    c.need(code > 0 && code <= 0x10ffff, 'html_entity_invalid', 'Login form contains an invalid character reference.');
    return String.fromCodePoint(code);
  });
}
function attributes(source) {
  const result = {};
  const pattern = /([A-Za-z_:][A-Za-z0-9_:.-]*)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>]+)))?/g;
  let match;
  while ((match = pattern.exec(source))) {
    const key = match[1].toLowerCase();
    c.need(!Object.hasOwn(result, key), 'duplicate_form_attribute', 'Login form contains an ambiguous duplicate attribute.');
    result[key] = decodeHtml(match[2] ?? match[3] ?? match[4] ?? '');
  }
  return result;
}
class CookieJar {
  constructor(origin) { this.origin = new URL(origin); this.cookies = new Map(); }
  absorb(headers, responseUrl, now = Date.now()) {
    c.need(typeof headers.getSetCookie === 'function', 'cookie_api_missing', 'Node 24 getSetCookie support is required.');
    for (const header of headers.getSetCookie()) {
      const parts = header.split(';');
      const split = parts[0].indexOf('=');
      c.need(split > 0, 'cookie_invalid', 'Authentication server returned a malformed cookie.');
      const name = parts[0].slice(0, split).trim();
      const value = parts[0].slice(split + 1).trim();
      c.need(/^[!#$%&'*+\-.^_|~0-9A-Za-z]+$/.test(name) && !/[\x00-\x20\x7f;,]/.test(value),
        'cookie_invalid', 'Authentication server returned an unsupported cookie.');
      const attr = {};
      for (const item of parts.slice(1)) {
        const i = item.indexOf('=');
        attr[(i < 0 ? item : item.slice(0, i)).trim().toLowerCase()] = i < 0 ? '' : item.slice(i + 1).trim();
      }
      const host = responseUrl.hostname;
      if (attr.domain) c.need(attr.domain.replace(/^\./, '').toLowerCase() === host.toLowerCase(),
        'cookie_domain_refused', 'Login helper accepts only cookies for the exact configured host.');
      const slash = responseUrl.pathname.lastIndexOf('/');
      const defaultPath = slash > 0 ? responseUrl.pathname.slice(0, slash) : '/';
      const cookiePath = attr.path?.startsWith('/') ? attr.path : defaultPath;
      let expires = Infinity;
      if (attr['max-age'] !== undefined && /^-?[0-9]+$/.test(attr['max-age'])) expires = now + Number(attr['max-age']) * 1000;
      else if (attr.expires && Number.isFinite(Date.parse(attr.expires))) expires = Date.parse(attr.expires);
      const id = name + '\n' + cookiePath;
      if (expires <= now) { this.cookies.delete(id); continue; }
      c.remember(value);
      this.cookies.set(id, { name, value, path: cookiePath, secure: Object.hasOwn(attr, 'secure'), expires });
    }
  }
  matching(url, now = Date.now()) {
    return [...this.cookies.values()].filter(cookie => cookie.expires > now &&
      (!cookie.secure || url.protocol === 'https:') &&
      (url.pathname === cookie.path || (url.pathname.startsWith(cookie.path) &&
        (cookie.path.endsWith('/') || url.pathname[cookie.path.length] === '/'))))
      .sort((a, b) => b.path.length - a.path.length);
  }
  header(url) { return this.matching(url).map(cookie => cookie.name + '=' + cookie.value).join('; '); }
  session(url) {
    const matches = this.matching(url).filter(cookie => cookie.name === 'sessionId');
    c.need(matches.length <= 1, 'session_cookie_ambiguous', 'Multiple application session cookies were returned.');
    return matches[0]?.value;
  }
}
function loginForm(html, pageUrl, origin, realmPath) {
  const forms = [];
  const pattern = /<form\b([^>]*)>([\s\S]*?)<\/form\s*>/gi;
  let match;
  while ((match = pattern.exec(html))) {
    const attr = attributes(match[1]);
    if (attr.id === 'kc-form-login') forms.push({ attr, body: match[2] });
  }
  c.need(forms.length === 1, 'additional_authentication_required',
    'Expected the normal Keycloak username/password form. Additional authentication, consent, required actions or a different page needs explicit handling.',
    { matchingLoginForms: forms.length });
  const form = forms[0];
  c.need(!/aria-invalid\s*=\s*["']true["']/i.test(form.body) &&
    !/<[^>]+\bid\s*=\s*["']input-error["']/i.test(form.body),
  'operator_credentials_rejected', 'The normal login form reports an error. No password retry was attempted.');
  c.need(form.attr.method?.toLowerCase() === 'post' && c.nonempty(form.attr.action),
    'login_form_invalid', 'Expected an explicit POST login form.');
  const action = c.sameOrigin(new URL(form.attr.action, pageUrl).href, origin);
  c.need(action.pathname === realmPath + '/login-actions/authenticate',
    'login_action_refused', 'Password submission is allowed only to the observed realm’s normal authentication action.');
  const fields = [];
  const inputPattern = /<input\b([^>]*)>/gi;
  while ((match = inputPattern.exec(form.body))) {
    const attr = attributes(match[1]);
    if (Object.hasOwn(attr, 'disabled') || !attr.name) continue;
    fields.push({ ...attr, type: (attr.type || 'text').toLowerCase() });
  }
  const usernames = fields.filter(x => x.name === 'username');
  const passwords = fields.filter(x => x.name === 'password' && x.type === 'password');
  c.need(usernames.length <= 1 && passwords.length <= 1 && (usernames.length || passwords.length),
    'login_fields_invalid', 'Expected one username and/or password field.');
  c.need(fields.every(x => ['username', 'password', 'login', 'credentialId'].includes(x.name) ||
    ['hidden', 'submit', 'button', 'checkbox'].includes(x.type)),
  'additional_login_fields', 'Login form requires an additional visible field.');
  const params = new URLSearchParams();
  for (const field of fields) {
    if (field.type === 'hidden' || (field.type === 'submit' && field.name === 'login'))
      params.append(field.name, field.value || '');
  }
  return { action, params, username: usernames.length === 1, password: passwords.length === 1 };
}
async function login(configPath) {
  const cfg = c.config(configPath);
  directory = c.privateDir(c.resolveFile(cfg, cfg.loginStateDirectory || 'private-operator'));
  const sessionFile = process.env.MARTY_SESSION_ID_FILE ||
    c.resolveFile(cfg, cfg.sessionFile || 'private-operator/session-id.txt');
  c.need(path.dirname(sessionFile) === directory, 'session_output_location', 'For this helper, sessionFile must be inside loginStateDirectory.');
  c.need(!fs.existsSync(sessionFile), 'session_file_exists', 'A retained session file already exists. Use it or choose a new login state directory.');
  const journal = path.join(directory, 'login-requested.json');
  c.need(!fs.existsSync(journal), 'login_already_attempted', 'A login attempt is already journaled. Inspect its result before a separately configured retry.');
  const passwordFile = process.env.MARTY_OPERATOR_PASSWORD_FILE;
  c.need(c.nonempty(passwordFile), 'password_file_missing', 'Set MARTY_OPERATOR_PASSWORD_FILE to the installation owner’s private password file.');
  const password = c.readPrivate(passwordFile, 4096).replace(/\r?\n$/, '');
  c.need(password.length > 0 && !/[\r\n\x00]/.test(password), 'password_file_invalid', 'Password file must contain one nonempty line.');
  c.remember(password);
  report = { schema: 'elevenid.public-operator-login/v1', origin: cfg.origin, steps: [],
    authenticationFlow: 'ordinary-public-authorization-code-pkce', passwordRetries: 0, result: 'running' };
  c.writePrivate(journal, { at: new Date().toISOString(), origin: cfg.origin, operatorEmail: cfg.operatorEmail }, true);
  const jar = new CookieJar(cfg.origin);
  let url = new URL('/v1/auth/login?redirect_uri=%2F', cfg.origin);
  let method = 'GET'; let body;
  let expectedState; let realmPath;
  let usernameSubmitted = false; let passwordSubmitted = false; let callbackSeen = false;
  for (let step = 0; step < 16; step++) {
    stage = url.pathname === '/v1/auth/callback' ? 'public-oidc-callback' : 'normal-login-navigation';
    if (url.pathname === '/v1/auth/callback') {
      c.need(!callbackSeen && c.nonempty(expectedState) && url.searchParams.getAll('state').length === 1 &&
        url.searchParams.get('state') === expectedState && url.searchParams.getAll('code').length === 1 &&
        c.nonempty(url.searchParams.get('code')) && !url.searchParams.has('error'),
      'oidc_callback_mismatch', 'Public OIDC callback must match the state of this login attempt.');
      c.remember(url.searchParams.get('code')); callbackSeen = true;
    }
    const cookie = jar.header(url);
    const response = await c.request(cfg, url.href, { method, headers: {
      Accept: 'text/html,application/json', ...(cookie ? { Cookie: cookie } : {}),
      ...(method === 'POST' ? { 'Content-Type': 'application/x-www-form-urlencoded', Origin: cfg.origin } : {}),
    }, ...(body === undefined ? {} : { body }) });
    jar.absorb(response.headers, url);
    report.steps.push({ at: new Date().toISOString(), method, path: url.pathname, httpStatus: response.status });
    c.writePrivate(path.join(directory, 'login-report.json'), report);

    const session = jar.session(new URL('/v1/auth/me', cfg.origin));
    if (session) {
      c.need(callbackSeen && passwordSubmitted, 'session_flow_mismatch', 'Session was not obtained through this normal password and OIDC callback flow.');
      stage = 'public-session-readback';
      const meResponse = await c.request(cfg, '/v1/auth/me', { headers: { Accept: 'application/json',
        Cookie: jar.header(new URL('/v1/auth/me', cfg.origin)) } });
      const me = c.requireJson(meResponse, 'session_readback_failed');
      c.need(c.operatorMatches(me, cfg.operatorEmail), 'operator_mismatch', 'Authenticated session does not identify the configured installation operator.');
      c.need(/^[A-Za-z0-9._~+/=-]+$/.test(session), 'session_cookie_invalid', 'Application returned an unsupported sessionId value.');
      c.writePrivate(sessionFile, session + '\n', true);
      report.result = 'passed'; report.completedAt = new Date().toISOString();
      c.writePrivate(path.join(directory, 'login-report.json'), report);
      process.stdout.write(JSON.stringify({ result: 'passed', check: 'normal-public-operator-login',
        sessionFile, authenticatedOperatorConfirmed: true, passwordRetries: 0, externalRedirectsFollowed: false }) + '\n');
      return;
    }
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const location = response.headers.get('location');
      c.need(c.nonempty(location), 'redirect_location_missing', 'Login redirect omitted its destination.');
      const next = c.sameOrigin(new URL(location, url).href, cfg.origin);
      c.need(!next.searchParams.has('auth_error'), 'public_login_failed', 'Application rejected the normal login callback; inspect its bounded server diagnostics.');
      if (next.pathname.endsWith('/protocol/openid-connect/auth')) {
        // Native Compose exposes /realms directly; the reviewed Kubernetes
        // deployment exposes the same managed realm beneath /auth.
        c.need(!expectedState && /^\/(?:auth\/)?realms\/[^/]+\/protocol\/openid-connect\/auth$/.test(next.pathname),
          'oidc_authorization_path', 'Expected one ordinary authorization request to the managed realm.');
        for (const field of ['response_type', 'client_id', 'redirect_uri', 'scope', 'state', 'nonce', 'code_challenge', 'code_challenge_method'])
          c.need(next.searchParams.getAll(field).length === 1 && c.nonempty(next.searchParams.get(field)),
            'oidc_authorization_invalid', 'Authorization request omitted or duplicated an expected parameter.', { field });
        c.need(next.searchParams.get('response_type') === 'code' && next.searchParams.get('code_challenge_method') === 'S256' &&
          next.searchParams.get('scope').split(/\s+/).includes('openid') &&
          next.searchParams.get('redirect_uri') === cfg.origin + '/v1/auth/callback',
        'oidc_authorization_mismatch', 'Public login must use Authorization Code, PKCE S256 and this origin’s callback.');
        expectedState = c.remember(next.searchParams.get('state'));
        c.remember(next.searchParams.get('nonce'));
        realmPath = next.pathname.slice(0, -'/protocol/openid-connect/auth'.length);
      }
      if ([301, 302, 303].includes(response.status)) { method = 'GET'; body = undefined; }
      url = next;
      continue;
    }
    c.need(response.status === 200 && expectedState && realmPath &&
      response.headers.get('content-type')?.toLowerCase().includes('text/html'),
    'login_page_unavailable', 'Normal login did not return its expected HTML form.', { httpStatus: response.status });
    const form = loginForm(response.raw, url, cfg.origin, realmPath);
    c.need(!(form.password && passwordSubmitted) && !(form.username && !form.password && usernameSubmitted),
      'login_retry_refused', 'Login returned a repeated credential step; no automatic retry was attempted.');
    if (form.username) { form.params.set('username', cfg.operatorEmail); usernameSubmitted = true; }
    if (form.password) { form.params.set('password', password); passwordSubmitted = true; }
    url = form.action; method = 'POST'; body = form.params.toString();
  }
  throw new c.Stop('login_navigation_limit', 'Normal login exceeded the bounded navigation limit.');
}
async function main() {
  c.runtime();
  const [command, configPath] = process.argv.slice(2);
  c.need(command === 'login' && configPath, 'usage', 'Usage: node public-login.cjs login onboarding-config.json');
  await login(configPath);
}
if (require.main === module) main().catch(error => {
  const result = c.failure(error, stage);
  if (directory && report) {
    report.result = 'stopped'; report.failure = result;
    try { c.writePrivate(path.join(directory, 'login-report.json'), report); } catch {}
  }
  process.stdout.write(JSON.stringify(result) + '\n'); process.exitCode = 1;
});
module.exports = { decodeHtml, attributes, CookieJar, loginForm, login };
