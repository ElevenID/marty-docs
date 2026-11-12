---
title: OB3 Course Integration
description: Reproduce a scoped API-key course completion offer, learner claim, and independent verification.
sidebar:
  order: 1
---

## Scenario and acceptance boundary

Canyon Skills Academy's learning backend records completion of **Workplace Safety
Foundations**. The learner completes the workshop and scores at least 80 percent
on an assessment. The backend initiates an achievement credential; a separate
learner key claims it through OID4VCI.

The [executable example](https://github.com/ElevenID/marty-docs/tree/main/examples/ob3-course)
uses Node.js 24 or later, built-in Node libraries, and public HTTPS endpoints.
It keeps operator setup, backend API-key authentication, and the learner's proof
key separate. It uses synthetic identifiers and requires no learner email or
account. The example is a bounded test client, not a production wallet SDK.

The reference journey was exercised against UI source `b7c70558` on
2026-11-12. Ordinary API-key template access, issuance, learner claim, independent
JWS verification, issuer/course/recipient binding, tamper rejection, and issued
record readback passed. That result does not qualify every wallet, securing
profile, or deployment. Record your actual release and rerun the checks below.

## Prepare the deployment

Use the [release-specific installer guidance](/guides/self-hosted-deployment/).
Confirm the selected release's exact Docker/Compose requirements and supported
host capacity before provisioning. A cloud account's free-tier eligibility does
not establish that a small instance can run this stack.

The client needs valid HTTPS. For a private CA, obtain its public certificate and
fingerprint through the authenticated operator channel, verify them, and set
`NODE_EXTRA_CA_CERTS` before starting Node. The example refuses disabled TLS
verification. A `localhost` origin can test a tunneled/private deployment; an
external wallet needs a reachable stable hostname and a TLS trust path that
wallet accepts.

Retain the installed `/.well-known/marty-release` identity with your results.
Keep API keys, learner keys, offers, tokens, and credentials in private files.
On Unix, secret files must be mode `0600` and generated state directories mode
`0700`; on Windows, enforce equivalent private ACLs.

## Provision the course once

An authorized operator must already own the installation's customer organization
and bootstrap profiles. The example does not open self-registration or create
an administrative identity.

The [operator setup instructions](https://github.com/ElevenID/marty-docs/blob/main/examples/ob3-course/OPERATOR-SETUP.md)
provide a normal public login helper and an inspect-then-provision workflow:

```sh
node public-login.cjs login onboarding-config.json
node onboard-course.cjs inspect onboarding-config.json
node onboard-course.cjs provision onboarding-config.json
```

Read those instructions and configure private password/session files first.
The login helper stops when it encounters MFA, consent, required actions, or an
unexpected page; those interactions need the ordinary supported operator flow.
It never uses a password grant or a Keycloak administrator token.

Provisioning confirms the existing organization and its membership, then creates
a separate course template and an expiring client key. Its decisions are explicit:

| Setting | Required value or check |
| --- | --- |
| Public credential type | `OpenBadgeCredential`; do not copy the seeded `open_badge` alias into a public create request |
| Payload and issuance | `VC_JWT` and `OID4VCI_PRE_AUTH` |
| Course identifier | Template `vct` equals the subject's `achievement.id` |
| Issuer selection | Active organization-owned DID + `vc_jwt_issuer` purpose + `VC_JWT` + `ES256` |
| Profiles | Selected compliance profile, plus active customer-owned trust and revocation profiles |
| Claims | Required `learner_id` string and `achievement` object |
| Client key | Explicit `templates:read`, `credentials:issue`, `credentials:read`; bounded expiry |

The issuer inventory can contain another identity with the same DID and purpose
for `SD_JWT_VC`. Select the full tuple above. The setup helper refuses ambiguous
or incompatible inventory, journals mutations, and reuses only an observable
matching result. A named key without this run's retained secret is not recoverable.

Alternatively, provision those objects through the console/public API and copy
`config.example.json` to `config.json`, replacing every placeholder with actual
observed values. Keep the course subject and template course identifier aligned.

## Execute the backend and learner journey

Set `MARTY_API_KEY_FILE` to the absolute path of the private one-time API-key
file. With the setup helper, use its generated `private-onboarding/client-config.json`.
For manual setup, use `config.json`:

```sh
node ob3-client.cjs offline-check
node ob3-client.cjs prepare config.json
node ob3-client.cjs preflight config.json
node ob3-client.cjs issue config.json
node ob3-client.cjs claim config.json
node ob3-client.cjs verify config.json
node ob3-client.cjs readback config.json
```

`run config.json` executes preflight through readback. The individual commands
show the first failing integration stage. The client writes a mutation journal
before transmission and refuses automatic mutation replay.

| Stage | Expected evidence |
| --- | --- |
| Prepare | Separate P-256 learner key retained privately; subject and holder use its `did:jwk` |
| Preflight | Missing/invalid keys denied; scoped key reads the expected owned active template |
| Initiate | `POST /v1/issuance` accepts snake_case identifiers and `credential_subject`; saves the matching transaction/offer |
| Claim | Metadata and endpoints stay on the configured HTTPS origin; pre-authorized code exchange and nonce-bound holder proof produce a signed credential |
| Verify | Independent Node cryptography checks JWS, issuer key, signed identifiers, learner/course binding, criteria, and time claims; changed content fails the signature check |
| Readback | Transaction is issued; stored record matches organization, template, credential ID, artifact hash, and flow binding |

The API key belongs to the backend. The learner uses the offer and its separate
proof key to claim the credential; it does not receive the backend's API key.
Successful initiation is an offer, not the final signed achievement.

## Separate structure, signature, status, and policy checks

The Node verifier checks the scenario's explicit fields and cryptographic
binding. It does not run a full JSON Schema/JSON-LD validator, verify a public
status list, or perform issuer trust adjudication. `ACTIVE` in the server's
record proves persistence state, not all those properties.

The optional `validate-ob3.py` helper checks the full pinned
[1EdTech AchievementCredential schema](https://purl.imsglobal.org/spec/ob/v3p0/schema/json/ob_v3p0_achievementcredential_schema.json).
Its instructions, dependency versions, and required schema SHA-256 are in the
[example README](https://github.com/ElevenID/marty-docs/blob/main/examples/ob3-course/README.md).
It runs locally and refuses external schema retrieval. It reports a structural
assessment, not 1EdTech certification.

The baseline signer used a nested `payload.vc` with a signed JWT `jti`, and did
not include an embedded `vc.id`. Its raw embedded credential failed the schema
for the missing ID; a separately labeled diagnostic copy with `jti` mapped to
`id` passed. That comparison never changes the original credential or proves a
VC 2.0 securing profile. If an embedded ID is present, the client requires it to
match `jti`. Record raw schema results separately from envelope interpretation.

A controlled baseline negative test removed only `achievement.criteria`. The
server still signed and persisted it, while the client and schema rejected it.
Treat server rejection of missing/null/non-object criteria as a regression gate
for the selected updated release. The course's criteria narrative is a business
requirement; the schema's `criteria` object alone does not require that particular
narrative. Followup implementation changes need a newly built release and a fresh
live run before updating the baseline qualification.

For a server-side policy decision, provision an appropriate presentation policy
and a separate key with `credentials:read` and `trust:read`, then use the
[verification API](/api/verification/). The course client's local verification
is intentionally independent of that endpoint.

## Diagnose the first failure

| Symptom | Check or recovery action |
| --- | --- |
| Installer host check passes but installation rejects Compose | Use the release's signed compatibility check where available and install its exact supported Compose version |
| Public operator login stops at the realm redirect | Native Compose uses `/realms/<realm>`; the legacy Kubernetes route may use `/auth/realms/<realm>`. The helper follows the observed permitted prefix |
| Operator inventory appears to lack membership | `/v1/organizations/mine` includes caller membership; the general organization list deliberately omits it |
| Template creation rejects its type | Use public `OpenBadgeCredential`, not the seeded `open_badge` alias |
| Issuer selection appears ambiguous | Compare DID, purpose, format, algorithm, active state, and organization together |
| Machine read returns `401` | Check the key file, key lifetime, API-key credential type, and configured origin |
| Machine operation returns `403` | Check scopes and tenant/profile ownership; do not replace the key with internal headers |
| Offer exists but no credential was received | Diagnose metadata, token exchange, nonce, proof audience, and learner-key binding separately |
| Request times out or loses its response | Preserve the journal and reconcile the server transaction; do not delete state and issue a new event blindly |
| Signature passes but structure fails | Keep the original artifact; assess required fields and the exact JWT securing profile independently |
| Resume fails after the host was offline | Use the retained native operator's documented lifecycle recovery and inspect credential expiry; do not rerun bootstrap as a recovery shortcut |

The baseline organization service intentionally supports scoped API-key service
principals. Its normal machine template-read and issuance path passed. No human
session fallback or authentication relaxation is required for that path.

## Remaining qualification

Before adopting this example for a real client, separately exercise duplicate
and conflicting event retries beyond the gateway cache lifetime, expired and
revoked credentials, wrong issuer/learner/course, cross-organization access,
client-key expiry/revocation, lifecycle recovery, and the chosen external wallet.
The current fixture supports inline pre-authorized `jwt_vc_json` offers,
`did:web` issuers, and a single configured HTTPS origin. Redirects, external
authorization servers, transaction-code offers, deferred issuance, and SD-JWT
need an explicitly extended client and their own acceptance evidence.

Sources: [public API and issuer orchestration](https://github.com/ElevenID/marty-ui/blob/b7c7055830722d10512ccac042b1e0abe0e1ecec/rust/services/gateway/src/runtime_profile_operations.rs),
[organization service-principal handling](https://github.com/ElevenID/marty-ui/blob/b7c7055830722d10512ccac042b1e0abe0e1ecec/rust/services/organization/src/grpc_service.rs),
and [native lifecycle recovery](https://github.com/ElevenID/marty-ui/blob/main/docs/installer-lifecycle.md).
