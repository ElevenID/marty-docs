# Canyon Skills Academy — minimal OB3 client trial

This is a separate customer backend/learner fixture. It uses only public HTTPS
endpoints and an explicitly scoped organization API key. It initiates a **course
completion** credential, redeems its OID4VCI offer with a separately retained
synthetic learner key, saves the actual VC-JWT, independently checks its
signature, and checks transaction/credential persistence.

The reference journey passed on 2026-11-12 against UI source `b7c70558`, with
the limitations recorded in the [course guide](../../src/content/docs/guides/ob3-course-integration.md).
That observation does not establish success on your deployment. The
`offline-check` command checks the fixture's own cryptography only. Live results
are written after execution to the private state directory. A failed preflight
or issuance is an actionable client-facing finding; do not replace `X-API-Key`
with internal identity headers.

## Prerequisites

- Node.js 24 or later; no npm dependencies.
- A running signed ElevenID deployment with valid HTTPS. For a private test CA,
  obtain and verify its fingerprint through the authenticated operator route,
  then set `NODE_EXTRA_CA_CERTS` to that CA file before starting Node. TLS
  verification remains enabled. This fixture rejects
  `NODE_TLS_REJECT_UNAUTHORIZED=0`.
- An operator-provisioned organization and an **active, course-specific** OB3
  `VC_JWT` template using `OID4VCI_PRE_AUTH`, its owned managed issuer and
  revocation profile. The existing membership template is not a substitute.
- A private API-key file containing the one-time secret, created with explicit
  scopes `templates:read`, `credentials:issue` and `credentials:read`. The first
  scope is needed for the read-only template preflight. On Unix it must be mode
  `0600`. Set `MARTY_API_KEY_FILE` to its absolute path. Keep the secret out of
  command arguments, source files and terminal output.

The current public key-creation endpoint is
`POST /v1/api-keys?organization_id=<org>`, using an authorized human operator or
organization `admin:full` key. Example request:

```json
{
  "name": "canyon-course-client",
  "description": "Synthetic OB3 course completion client",
  "scopes": ["templates:read", "credentials:issue", "credentials:read"],
  "is_test": true
}
```

Capture its one-time `key` privately. A test-prefixed key does not create an
isolated deployment. This fixture does not create organizations, mutate
authentication settings, create API keys, or alter templates.

## Run the small journey

Copy `config.example.json` to `config.json`, replace every origin, organization,
template, and issuer placeholder with actual observed values. The
achievement ID must exactly match the course template's `vct`; update both config
and `course-subject.example.json` together if necessary. The example `.example`
course URL is a synthetic identifier, not a hosted course page.

```sh
node ob3-client.cjs offline-check
node ob3-client.cjs prepare config.json
node ob3-client.cjs preflight config.json
node ob3-client.cjs issue config.json
node ob3-client.cjs claim config.json
node ob3-client.cjs verify config.json
node ob3-client.cjs readback config.json
```

`run config.json` executes preflight → issue → claim → verify → readback in one
invocation. The separate commands make the exact first failing customer step
clear. `issue` can be run explicitly to test issuance after a failed read-only
preflight; it still uses the same ordinary API key and does not bypass any
server authorization.

### Explicit instructor session mode

For a separately labeled human-triggered integration test, copy the config,
set `"authMode": "instructor-session"`, choose a different `stateDirectory`
and completion-event ID, and set `MARTY_SESSION_ID_FILE` to a mode-0600 file
containing only the `sessionId` value obtained through a normal authenticated
login. The script sends the public `Cookie: sessionId=...` authentication
mechanism and records this mode. Do not extract hidden browser state or substitute
internal identity headers. The current gateway does not accept an ordinary
OAuth/Keycloak bearer token as a human session.

There is **no fallback** from API-key mode to instructor mode. Success in
instructor mode does not qualify an unattended machine integration. Each mode
has separate retained evidence; switching modes in an existing state directory
is refused.

The holder's P-256 private key stays in `learner-private-key.pem` with mode `0600`.
It is generated before issuance, so the requested recipient and actual proof key
are the same synthetic learner. This is a test learner's wallet key, not a server
issuer key. Issuer signing remains the deployment's responsibility.

The actual initiation request is `POST /v1/issuance`, with snake_case identifiers
and `credential_subject`. A successful response is an OID4VCI offer, **not the
signed badge**. The learner then discovers issuer/authorization metadata,
exchanges the pre-authorized code, obtains a proof nonce, sends an ES256 holder
proof, and receives the signed artifact.

## What is checked

| Check | Evidence |
| --- | --- |
| Missing and invalid API keys fail | Read-only template GET receives 401/403. |
| Scoped machine key can read its template | Public GET succeeds and template identity matches configuration. |
| Actual course issuance | Offer matches organization/template and is saved privately. |
| Separate learner claim | Retained learner key signs OID4VCI proof with advertised nonce and audience. |
| Portable signature | Native Node crypto verifies JWT against the configured issuer's published DID assertion key. |
| Issuer/course/recipient binding | Issuer, VC/JWT ID, OB3 types/context, achievement ID, criteria, learner ID and proof-key binding match. |
| Dates | VC dates and JWT `nbf`/`exp` are checked when present. |
| Tampering | Changing the course name while retaining the signature is rejected. |
| Durable record | Transaction is `issued`; record ID, organization/template, artifact hash and flow ID match. |

The independent verifier uses Node cryptography instead of ElevenID's verifier.
It performs explicit structural checks, **not complete JSON Schema/JSON-LD or
certification validation**. It records whether a status reference is present;
revocation/status-list validation is **not performed**, and the report says so.
An `ACTIVE` internal record is persistence evidence, not a substitute for public
revocation checking. Trust in a real-world issuer is a separate business decision.
The credential's JWT `jti` supplies its signed identifier; if an embedded `vc.id`
is present it must match. The fixture records whether the embedded ID is present.
Do not apply a bare JSON credential schema to `payload.vc` without first assessing
the applicable JWT envelope mapping.

The criteria check requires an object and permits empty or extension objects;
`id` and `narrative` are optional in the OB3 Criteria schema. This particular
course supplies a narrative, and the client separately compares the signed
criteria with its exact journaled request. It does not invent criteria for a
credential that lacks them.

This intentionally narrow fixture supports inline pre-authorized offers,
`jwt_vc_json`, `did:web`, and endpoints on the configured HTTPS origin. It rejects
redirects, unconfigured external authorization servers, transaction-code offers,
deferred issuance and SD-JWT responses. Those refusals are fixture limitations,
not claims that the protocol prohibits those features.

## Separate official-schema assessment

`validate-ob3.py` is a local helper using the full pinned 1EdTech
AchievementCredential JSON Schema. It assesses a subset of OB3 requirements;
it is not the official 1EdTech validator or a certification result. Install its
small Python dependencies in an environment you own:

```sh
python3 -m venv .schema-venv
.schema-venv/bin/python -m pip install -r requirements-schema.txt
.schema-venv/bin/python validate-ob3.py \
  --credential-file /absolute/private-state/credential.jwt \
  --schema-file /absolute/path/ob3-achievementcredential-schema.json \
  --compare-jti-mapping \
  --criteria-negative-test \
  --output /absolute/private-state/ob3-schema-report.json
```

Download the schema from its authoritative URL and supply its local path with
the required `--schema-file` option:

```sh
curl --fail --location --output ob3-achievementcredential-schema.json \
  https://purl.imsglobal.org/spec/ob/v3p0/schema/json/ob_v3p0_achievementcredential_schema.json
```

The helper requires SHA-256
`b7358e895f492e74055dc6bfc7ffc420d0e497f90c4579fb83d9519b86d393ea`;
it refuses changed schema bytes, external schema retrieval, duplicate JSON
members, and absent date/date-time format checkers. This preserves the exact
schema revision used for this trial. Schema format checking does not test
whether the credential is currently expired or not yet valid.

If the published schema bytes change, the helper stops. Review and pin that
revision explicitly rather than bypassing its hash check. The downloaded schema
and generated private state are excluded from this example's Git inputs.

The report preserves the raw embedded `payload.vc` schema result. With the
explicit `--compare-jti-mapping` flag, it separately copies a present JWT `jti`
into an absent credential `id` in memory. It never overwrites a contradictory
ID or changes the artifact. The older VC 1.1 JWT mapping provides the reference
for this comparison; applying it to this signer's VC 2.0 context does not prove
conformance to a VC 2.0 securing profile. A raw missing-ID schema error and a
mapped comparison pass must remain visible together. Other missing fields are
not repaired.

`--criteria-negative-test` removes only achievement `criteria` in a further
in-memory copy and checks for the required-property rejection. It calls this an
isolated successful negative test only when its baseline passed the schema.
This is structural validation, not a cryptographic tamper test. The independent
Node JWS/tamper checks remain separate, correlated through the SHA-256 of the
trimmed compact JWT.

The helper emits hashes and bounded, redacted diagnostics, never credential
values. An output file is created with mode `0600`; an existing report is not
overwritten. Exit `0` means the raw credential schema passed, exit `1` means it
failed, and exit `2` means the assessment could not run. Exit `1` alone is not a
whole-JWT conformance verdict. Use explicit `--input-format vc-json` for an
unsigned JSON fixture or `--input-format jwt-payload-json` for a retained decoded
payload. Do not pass the private HTTP response envelope as a credential.

## Replay and privacy behavior

The fixture uses a stable completion-event ID as `Idempotency-Key`. The baseline
gateway has response replay caching, while its issuance adapter omitted this
header from the downstream durable service request. A cache replay alone does
not prove durable deduplication. Qualify the selected release's downstream
behavior before enabling automatic retries. This client writes a journal
**before** issuance or token exchange, never retries a mutating request, and
refuses a second attempt in the same directory. If a response is lost, preserve
the directory and reconcile the server's actual transaction. Do not delete the
journal and reissue simply to get past a failure.

For explicit qualification of an already successful issuance, use the separate
[controlled retry probe](./RETRY-QUALIFICATION.md). It preserves the original
event and request bytes, records warm-cache replay and conflict behavior, then
uses a distinct same-organization key to test durable recovery through an
unused gateway namespace. It does not enable automatic retries in this client.

The separate [scope and lifecycle probe](./SCOPE-LIFECYCLE-QUALIFICATION.md)
checks the same retained synthetic course JWT with a `credentials:read` key and
a `credentials:read` plus `trust:read` key, then tests suspend → reinstate → revoke
with current public verification evidence. It requires an existing narrow course
policy, owned trust profile and operator session. It is one-shot, permanently
revokes the synthetic credential last, and does not provision authority or retry
unknown writes. Its fake tests do not establish a live qualification result.

The state directory is mode `0700`; keys, offers, responses and credentials are
mode `0600`. It contains sensitive pre-authorized codes, tokens, wallet key and
credentials. Keep it private. The console emits bounded, redacted diagnostics;
share a reviewed `report.json`, not the entire state directory. No real learner
identity or email is needed for this synthetic scenario.

Rejected HTTP responses retain the local step `code`, numeric `httpStatus`, a
conservative `serverErrorCode` when supplied, and a sanitized `diagnostic` of at
most 500 characters. The client accepts the protocol's `error_description` as
well as the gateway's nested error message; it never serializes arbitrary error
objects or raw response bodies into the console/report diagnostic. Known
secrets, API keys, compact JWTs, private-key PEMs and offer query values are
redacted before truncation. Preflight, issuance, token and credential requests
retain the complete response in their existing private response files. These
fields describe the server's response; they do
not establish whether a credential was signed or persisted, and do not enable
automatic retries.

Malformed configuration, subject, retained-state and inline-offer JSON produces
a fixed stop code and message. The client does not print parser excerpts, which
can contain a capability or claim before it is known to the redactor. The
malformed input remains untouched; an already malformed `report.json` is
also preserved instead of being replaced. Compact-JWT JSON decoding already
uses a fixed diagnostic, and non-JSON HTTP responses do not expose parser text.

Use private filesystem ACLs on Windows; Unix mode checks cannot establish those
ACLs. Keep generated state under the default ignored `private-*` directories or
outside the repository. Do not commit local configuration or live artifacts.

## Source provenance

Run the local boundary checks without a deployment:

```sh
node ob3-client.cjs offline-check
node --test client.test.cjs probe-retries.test.cjs probe-scope-lifecycle.test.cjs
```

These cover local signatures and tampering, signed identifiers, criteria shape,
issuer/learner/course mismatches, dates, offer limitations, and operator form and
cookie boundaries, plus protocol/gateway diagnostics, redaction and one-attempt
error handling. They do not replace a live installation or claim test.

Adapted from these exact primary code sources at
`b7c7055830722d10512ccac042b1e0abe0e1ecec`:

- [Public machine authentication](https://github.com/ElevenID/marty-ui/blob/b7c7055830722d10512ccac042b1e0abe0e1ecec/docs/API_MACHINE_AUTHENTICATION.md)
- [Public issuance request contract](https://github.com/ElevenID/marty-ui/blob/b7c7055830722d10512ccac042b1e0abe0e1ecec/rust/services/gateway/src/issuance_create.rs)
- [Existing OID4VCI/DID/JWS helper](https://github.com/ElevenID/marty-ui/blob/b7c7055830722d10512ccac042b1e0abe0e1ecec/tests/scripts/run-canvas-oss-standard-contract.js)
- [Existing persistence acceptance checks](https://github.com/ElevenID/marty-ui/blob/b7c7055830722d10512ccac042b1e0abe0e1ecec/tests/scripts/run-kubernetes-acceptance.cjs)
- [Open Badges 3 specification](https://www.imsglobal.org/spec/ob/v3p0/)

The reference source is not evidence of the currently deployed application SHA.
Record the actual signed runtime/build with each live trial.
