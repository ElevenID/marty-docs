'use strict';

// Small dependency-free helpers for the public operator login/onboarding trial.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const MAX_BYTES = 4 * 1024 * 1024;
const secrets = new Set();

class Stop extends Error {
  constructor(code, message, extra = {}) { super(message); this.code = code; this.extra = extra; }
}
function need(condition, code, message, extra) { if (!condition) throw new Stop(code, message, extra); }
function nonempty(value) { return typeof value === 'string' && value.trim().length > 0; }
function hash(value) { return crypto.createHash('sha256').update(value).digest('hex'); }
function runtime() {
  process.umask(0o077);
  need(Number(process.versions.node.split('.')[0]) >= 24, 'node_version_unsupported', 'Node.js 24 or later is required.');
  need(process.env.NODE_TLS_REJECT_UNAUTHORIZED !== '0', 'tls_verification_disabled', 'TLS verification must stay enabled.');
}
function remember(value) { if (nonempty(value)) secrets.add(value); return value; }
function sanitize(value) {
  let text = String(value || '');
  for (const secret of secrets) text = text.split(secret).join('[redacted]');
  return text.replace(/(?:mk|pk)_(?:test|live)_[A-Za-z0-9_-]+/g, '[api-key]')
    .replace(/\beyJ[A-Za-z0-9_-]*\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g, '[jwt]')
    .replace(/([?&](?:code|state|session_code|nonce|credential_offer|credential_offer_uri)=)[^&\s]+/gi, '$1[redacted]')
    .slice(0, 400);
}
function config(configPath) {
  const resolved = path.resolve(configPath);
  const value = JSON.parse(fs.readFileSync(resolved, 'utf8'));
  let origin;
  try { origin = new URL(value.origin); } catch { throw new Stop('origin_invalid', 'Configure an absolute HTTPS origin.'); }
  need(origin.protocol === 'https:' && origin.href === origin.origin + '/' && !origin.username && !origin.password,
    'origin_invalid', 'origin must be one HTTPS origin without a path or credentials.');
  value.origin = origin.origin;
  value.operatorEmail = value.operatorEmail || 'operator@localhost';
  value.timeoutMs = value.timeoutMs || 30000;
  need(nonempty(value.operatorEmail), 'operator_email_missing', 'Configure the expected installation operator.');
  need(Number.isInteger(value.timeoutMs) && value.timeoutMs >= 1000 && value.timeoutMs <= 120000,
    'timeout_invalid', 'timeoutMs must be 1000–120000.');
  Object.defineProperty(value, '_directory', { value: path.dirname(resolved) });
  return value;
}
function resolveFile(cfg, filename) { return path.resolve(cfg._directory, filename); }
function privateDir(directory) {
  if (!fs.existsSync(directory)) fs.mkdirSync(directory, { mode: 0o700 });
  const stat = fs.lstatSync(directory);
  need(stat.isDirectory() && !stat.isSymbolicLink(), 'private_directory_type', 'Private state directory must be a real directory.');
  need(process.platform === 'win32' || (stat.mode & 0o077) === 0,
    'private_directory_permissions', 'Private state directory must be mode 0700.');
  return directory;
}
function readPrivate(filename, maximum = MAX_BYTES) {
  const fd = fs.openSync(filename, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
  try {
    const stat = fs.fstatSync(fd);
    need(stat.isFile() && stat.size <= maximum && stat.nlink === 1,
      'private_file_invalid', 'Private input must be a bounded regular file with one link.');
    need(process.platform === 'win32' || (stat.mode & 0o077) === 0,
      'private_file_permissions', 'Private input must be mode 0600.');
    return fs.readFileSync(fd, 'utf8');
  } finally { fs.closeSync(fd); }
}
function writePrivate(filename, value, exclusive = false) {
  const bytes = typeof value === 'string' ? value : JSON.stringify(value, null, 2) + '\n';
  const fd = fs.openSync(filename, fs.constants.O_WRONLY | fs.constants.O_CREAT |
    fs.constants.O_NOFOLLOW | (exclusive ? fs.constants.O_EXCL : 0), 0o600);
  try {
    need(fs.fstatSync(fd).nlink === 1, 'private_file_links', 'Private output must have one link.');
    fs.ftruncateSync(fd, 0);
    fs.writeFileSync(fd, bytes); fs.fchmodSync(fd, 0o600); fs.fsyncSync(fd);
  } finally { fs.closeSync(fd); }
}
function readJson(filename) { return JSON.parse(readPrivate(filename)); }
function sameOrigin(value, origin) {
  let url;
  try { url = new URL(value, origin); } catch { throw new Stop('endpoint_invalid', 'Invalid public endpoint URL.'); }
  need(url.protocol === 'https:' && url.origin === origin && !url.username && !url.password && !url.hash,
    'untrusted_endpoint', 'Only HTTPS endpoints on the explicitly configured origin are allowed.');
  return url;
}
async function request(cfg, value, options = {}) {
  const url = sameOrigin(value, cfg.origin);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), cfg.timeoutMs);
  try {
    const response = await fetch(url, { ...options, redirect: 'manual', signal: controller.signal });
    need(Number(response.headers.get('content-length') || 0) <= MAX_BYTES, 'response_too_large', 'Public response exceeds the size limit.');
    let size = 0; const chunks = [];
    for await (const chunk of response.body || []) {
      size += chunk.length;
      need(size <= MAX_BYTES, 'response_too_large', 'Public response exceeds the size limit.');
      chunks.push(chunk);
    }
    const raw = Buffer.concat(chunks).toString('utf8');
    let json = null;
    try { json = JSON.parse(raw); } catch {}
    return { status: response.status, headers: response.headers, raw, json, url };
  } catch (error) {
    if (error instanceof Stop) throw error;
    throw new Stop('transport_failed', 'Public request failed; no automatic retry was attempted.', {
      transportCode: sanitize(error.cause?.code || error.code || error.name),
      mutationOutcome: options.method && options.method !== 'GET' ? 'unknown' : 'read-only',
    });
  } finally { clearTimeout(timer); }
}
function requireJson(response, label) {
  need(response.status >= 200 && response.status < 300, label || 'public_request_rejected',
    'Public endpoint rejected the request.', {
      httpStatus: response.status,
      diagnostic: sanitize(response.json?.detail || response.json?.error?.message || response.json?.message || response.json?.error || 'non-JSON response'),
      correlationId: sanitize(response.headers.get('x-correlation-id')),
    });
  need(response.json && typeof response.json === 'object', 'json_response_required', 'Public endpoint did not return JSON.');
  return response.json;
}
function sessionValue(filename) {
  const value = readPrivate(filename, 16384).trim();
  need(nonempty(value) && /^[A-Za-z0-9._~+/=-]+$/.test(value),
    'session_file_invalid', 'Session file must contain only the sessionId value from this normal public login.');
  return remember(value);
}
function operatorMatches(me, expected) {
  const user = me?.user;
  return me?.authenticated === true && user && !Array.isArray(user) &&
    [user.email, user.username, user.preferred_username].some(value => value === expected) &&
    [user.user_id, user.id, user.sub].some(nonempty);
}
function failure(error, stage) {
  return { at: new Date().toISOString(), result: 'stopped', stage,
    code: /^[a-z0-9_]{1,90}$/.test(error.code || '') ? error.code : 'client_step_failed',
    message: sanitize(error.message), ...(error instanceof Stop ? error.extra : {}), automaticMutationReplay: false };
}
module.exports = { Stop, need, nonempty, hash, runtime, remember, sanitize, config, resolveFile,
  privateDir, readPrivate, writePrivate, readJson, sameOrigin, request, requireJson, sessionValue, operatorMatches, failure };
