# Qualify retries on one retained course issuance

`probe-retries.cjs` tests an **already successful synthetic issuance** through
public HTTPS. It sends the same event again only in the explicit phases below,
plus one deliberately conflicting body per phase. It never chooses another
event, redeems an offer, changes original issuance state, or automatically
retries a request. A transport failure stops the phase and leaves its request
journal for reconciliation.

These are qualification expectations, not recorded live results. The original
`b7c70558` trial did not establish durable retry behavior. The downstream
header correction is tracked in [UI #1895](https://github.com/ElevenID/marty-ui/pull/1895);
qualify the actual signed candidate containing the intended changes.

## Why two API keys are needed

The production gateway uses Redis response caching, with a default 24-hour TTL.
A native pause/resume can retain Redis data. A replay after restart therefore
does not establish that issuance handled the retry durably.

The pinned framework namespaces the response and lock by
`api_key:<key UUID>:<Idempotency-Key>`. Issuance stores the durable key under
organization plus event-key hash. A second key B in the same organization has
a separate gateway namespace. With the original request unchanged, B must
recover the **same transaction** with `Idempotency-Replayed: false`, then replay
its newly populated cache with `true`.

The helper preserves method `POST`, path `/v1/issuance`, no query string, the
original event key, and the exact captured request bytes. New original journals
include `requestBody` and its SHA-256. For older journals from this example, the
helper reconstructs the original `JSON.stringify(body)` serialization and labels
that provenance explicitly. A successful warm cache replay must confirm the
original gateway fingerprint. If the warm cache has expired, the probe stops.
Do not reissue or reset state to manufacture a warm result.

The public response omits the service's top-level `pre_auth_code`. The probe uses
the existing `parseOffer` helper to recover the grant from `credential_offer_uri`,
validates its same-origin tenant issuer and observed template configuration,
and requires the exact URI and parsed grant to remain unchanged. Offer maps and
labels also remain bound; none of these private capability values is logged.

## Required inputs

- Use a disposable synthetic course and a signed deployment whose runtime
  identity has been recorded. Keep the existing HTTPS/CA checks enabled.
- Retain the original `client-config.json`, `issuance-requested.json`, successful
  `issuance-response.json`, and matching `offer-private.json`. An ambiguous or
  failed original attempt is not eligible. Claiming the offer between phases is
  supported; transaction status may advance while a cached snapshot stays old.
- A is the original API key. Create B once through the normal authorized
  operator endpoint `POST /v1/api-keys?organization_id=<org>`. Both keys must be
  active organization keys with exactly `templates:read`, `credentials:issue`,
  and `credentials:read`. Prefer short expirations covering the test window.
  Preserve the returned UUID and one-time secret privately. The helper does not
  create or revoke keys.
- B must be completely unused before `warm`. Afterwards, reserve it exclusively
  for this probe until `durable` completes. Do not use it for login checks,
  another test, or any issuance call between phases.
- Retain a normal authorized operator `sessionId` file. The helper uses that
  session only for public API-key inventory reads. No internal service token,
  identity header, administrative API key, or additional scope is needed.
- Keep input secrets and native maintenance receipts mode `0600`, state
  directories mode `0700`, and generated state outside source control. Use
  equivalent private ACLs on Windows.

There is no supported public key-secret introspection route in this native
contract. The helper reads `/v1/api-keys?organization_id=<org>&limit=500&offset=0`,
performs a harmless template GET with each key, and reads the inventory again.
It requires exactly the expected UUID's `last_used_at` to advance while ownership,
grants, the key set, and other usage remain unchanged. This observes the owner
service's committed per-request usage update; it is **not a cryptographic
identity attestation**. A cached authentication implementation, unchanged or
ambiguous timestamp, concurrent use, swapped secrets, incomplete inventory, or
changed grants stops the probe. Inventories of 500 or more keys are refused.

## Two explicit phases

Copy `retry-config.example.json` to an ignored/private configuration location.
Replace all placeholders, use the original client configuration, and choose a
separate `probeStateDirectory` outside original issuance state. File references
are relative to the configuration that contains them. Set
`maintenanceReceiptFile` to the private receipt that will be retained after the
supported native pause/resume; the warm phase does not read it.

```sh
node probe-retries.cjs warm /absolute/private-retry-inputs/retry-config.json
```

The warm phase observes A/B identities and B's initially unused state, then:

| Request | Required result |
| --- | --- |
| A, original body/event | Successful response, original transaction/offer/expiry, replay header `true`. |
| A, same event and only a changed synthetic `credential_subject.learner_id` | HTTP 409 with gateway `idempotency_conflict`; no replay header. |
| Public original transaction GET | Same transaction, organization and template; current status recorded. |

The operator now performs the deployment's supported **native pause and
resume**, records the actual lifecycle result and retained runtime identity,
and saves the evidence at `maintenanceReceiptFile`. The probe does not manage
the installer. Its report hashes that receipt, records
`nativeMaintenanceVerified: false`, and requires separate operator assessment
of the actual maintenance outcome. It never infers restart from an HTTP response.

```sh
node probe-retries.cjs durable /absolute/private-retry-inputs/retry-config.json
```

The durable phase requires a passed warm report, unchanged original input
hashes/key grants, and B's usage timestamp unchanged since its known warm
read-only check. It re-observes B with a template GET, then:

| Request | Required result |
| --- | --- |
| B, conflicting body first, original event | HTTP 409 with the durable issuance conflict detail, not an in-progress or gateway conflict. |
| B, exact original body/event | Successful response, original transaction/offer/expiry, replay header `false`. |
| B, same original bytes again | Successful response for the same transaction, replay header `true`. |
| Public original transaction GET | Same transaction, organization and template; current status recorded. |

The durable conflict detail is currently
`idempotency key was already used for a different issuance request`. A generic
409 does not prove this boundary. An unexpected new transaction, success for a
conflicting body, wrong header, permission failure, or timeout stops immediately.

Both phases are one-shot. Their attempt file exists before any network work,
and every POST has a separate prewritten request-evidence file. Do not delete
those files, change the event, or choose another evidence directory to bypass a
refusal. Inspect the retained response evidence and original server transaction.
The original client remains available for its ordinary `claim`, `verify`, and
`readback` steps; the retry probe never calls token or credential endpoints.

`warm-report.json` and `durable-report.json` contain request hashes, selected key
UUIDs/metadata, observed usage times, HTTP statuses, correlation IDs, replay
headers and transaction identifiers. They omit key/session secrets, request
claims, offer capabilities and credentials. Review reports before sharing.

## Separate public verification and lifecycle checks

These are a concise operator plan, not additional commands in the retry probe.
Use the **same saved compact JWT** and a separate active, organization-owned
course policy. Bind the course template and its observed OB3 compliance profile,
`VC_JWT`, an owned trust profile admitting the exact course issuer, and the
expected course/learner claims. Require current status with
`freshness: {max_age_seconds:null, require_not_revoked:true, revocation_grace_seconds:300}`.
For direct credential verification, `holder_binding: {required:false}` makes
no claim of fresh holder possession. Provision/activate this policy using the
normal operator's public presentation-policy endpoints.

POST `/v1/vc-api/credentials/verify?organization_id=<org>&presentation_policy_id=<policy>`
with `{"verifiableCredential":"<unchanged compact JWT>","options":{}}`:

- A separate key with exactly `credentials:read` should receive 403.
- A key with exactly `credentials:read` and `trust:read` should receive 200 with
  `verified:true` and `results.decision:"allow"` for the active credential.

Do **not** attach an `Idempotency-Key` to verification calls. Each must obtain
current status evidence. The narrow issuance keys used by the retry probe are
not verification-policy keys.

For the owned synthetic artifact, POST
`/v1/issued-credentials/<URL-encoded JWT jti>/{suspend|reinstate|revoke}` with
`{"reason":"Synthetic lifecycle qualification","comments":"<run marker>"}`.
Use the authorized operator session, or a separately scoped key with
`credentials:revoke`. Read state through public
`GET /v1/issued-credentials/<URL-encoded JWT jti>` with `credentials:read`.
The `/status` suffix is internal-only. The credential ID is different from the
issuance transaction ID.

Check active → suspended → active → revoked, revoking last. The unchanged
credential should verify as allow → deny → allow → deny; denial is HTTP 422
with `verified:false`. VC-API currently gives the generic
`errors:["verification_failed"]` for a policy denial, so pair each result with
the public record's actual status and artifact/tenant/template bindings. A
failure to verify for another reason is not lifecycle proof. An operator can
obtain detailed reason/status evidence from the saved policy's public
`POST /v1/presentation-policies/<id>/evaluate` with `{"vp_token":"<same JWT>"}`;
that direct route currently requires `trust:write` at the gateway. Do not widen
the verification reader's scopes just to obtain that diagnostic.

## Local checks and source boundaries

```sh
node --test client.test.cjs probe-retries.test.cjs
```

Fake transports exercise byte preservation, both cache boundaries, advancing
transaction snapshots, identity ambiguity, stale/changed inputs, specific
conflict responses, timeouts, one-shot behavior, and secret redaction. They do
not qualify a deployed gateway or certify OB3 interoperability.

- [Pinned cache namespace and fingerprint](https://github.com/ElevenID/marty-microservices-framework/blob/67e6121f233d3edbb07a35b9b3be2ae7e1462821/crates/mmf-platform/src/http.rs)
- [Gateway authentication provider](https://github.com/ElevenID/marty-ui/blob/b7c7055830722d10512ccac042b1e0abe0e1ecec/rust/services/gateway/src/providers.rs)
- [Per-request owner key validation and committed usage](https://github.com/ElevenID/marty-ui/blob/b7c7055830722d10512ccac042b1e0abe0e1ecec/rust/services/organization/src/api_keys.rs)
- [Durable request fingerprint and recovery](https://github.com/ElevenID/marty-ui/blob/b7c7055830722d10512ccac042b1e0abe0e1ecec/rust/services/issuance/src/initiation.rs)
- [Public issuance response projection](https://github.com/ElevenID/marty-ui/blob/b7c7055830722d10512ccac042b1e0abe0e1ecec/rust/services/gateway/src/response_projection.rs)
- [Public lifecycle body contract](https://github.com/ElevenID/marty-ui/blob/b7c7055830722d10512ccac042b1e0abe0e1ecec/rust/services/gateway/src/issuance_lifecycle_contract.rs)
