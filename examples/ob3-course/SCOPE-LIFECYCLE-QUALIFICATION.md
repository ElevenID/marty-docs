# Optional course scope and lifecycle qualification

This optional probe qualifies one already issued **synthetic** course credential. Its fake-transport tests check client orchestration only; they do not establish native or AWS qualification. Review the selected signed deployment and existing resources before execution.

The runner consumes one already issued synthetic course JWT and the original private issuance journal. It verifies the scope boundary against one existing course policy, then performs exactly **suspend → reinstate → revoke**, with verification and public record readback between transitions. **Revocation is the terminal action.** It creates no policies, keys, credentials, or offers and reads no issuer signing keys.

## Exact public routes

| Purpose | Method and route | Authentication / expected result |
|---|---|---|
| Course template | `GET /v1/credential-templates/{template_id}` | Existing operator session; exact active course and issuer |
| Saved course policy | `GET /v1/presentation-policies/{policy_id}` | Existing operator session; owned active policy |
| Selected trust profile | `GET /v1/trust-profiles/{trust_profile_id}` | Existing operator session; owned active CUSTOM profile |
| Credential record | `GET /v1/issued-credentials/{encoded_jti}` | Existing operator session; exact artifact hash and expected status |
| API-key metadata | `GET /v1/api-keys?organization_id={org}&limit=500&offset=0` | Existing operator session; complete inventory with fewer than 500 entries |
| Scope / status verification | `POST /v1/vc-api/credentials/verify?organization_id={org}&presentation_policy_id={policy_id}` | R or V key; body `{"verifiableCredential": "<same retained JWT>", "options": {}}` |
| Detailed denial evidence | `POST /v1/presentation-policies/{policy_id}/evaluate` | Existing operator session; body `{"vp_token": "<same retained JWT>", "nonce": null, "audience": null}` |
| Lifecycle transition | `POST /v1/issued-credentials/{encoded_jti}/{suspend\|reinstate\|revoke}` | Existing operator session; static `reason` and `comments` only |

There is no public `/status` suffix. The lifecycle POST and record GET return the same public record shape, with uppercase `ACTIVE`, `SUSPENDED`, or `REVOKED` status. The runner verifies `id == credential_id == signed jti`, the exact original transaction, organization, template, issuer, subject, format, and SHA-256 of the retained compact JWT.

No request carries `Idempotency-Key`. The runner rejects an unexpected `Idempotency-Replayed` header. This prevents a cached verification response from standing in for a new status evaluation.

## Inputs and existing authority

Use an isolated signed deployment containing the API scope correction from [UI #1895](https://github.com/ElevenID/marty-ui/pull/1895) and OB3 profile corrections from [Core #419](https://github.com/ElevenID/marty-core/pull/419), after its source and native lifecycle gates pass. A repository merge alone does not prove those changes are deployed. The existing original course client configuration must point to that exact HTTPS origin and its private successful issuance directory. The runner reads only these three original files:

- `issuance-requested.json`: the original six-field direct course body, synthetic learner, full achievement and completion event.
- `issuance-response.json`: the successful public issuance response for the same organization and template.
- `credential.jwt`: the retained ES256 compact OB3 JWT, including `vc.id == jti`, exact original learner and achievement, and a current validity period.

The recipient is required to have a `synthetic-` learner identifier. The original state directory remains unchanged. The probe resolves both directory paths before creating evidence state and rejects the original directory or any descendant, including ancestor aliases and an uncreated child. Subsequent reads and writes use the admitted canonical paths. The probe uses a separate 0700 directory; secret and original files must be regular private 0600 files. No copied JWT, full claims, offer capability, key secret, or session token is written to probe evidence.

The existing normal operator session must be able to read these resources and key inventory, evaluate the saved policy, and perform the three lifecycle transitions. The public direct saved-policy evaluation route uses its normal policy permission; it is separate from the narrower VC-API verification scope check. Do not grant a wider API-key scope to make the diagnostics work.

Provide two **fresh, unused**, distinct same-organization API keys through their real UUIDs and private secret files:

| Key | Exact scopes | Initial verification |
|---|---|---|
| R | `credentials:read` | HTTP 403 |
| V | `credentials:read`, `trust:read` | HTTP 200; verified true; policy allow |

Both must be enabled organization keys, without a deployment-profile restriction, and unexpired. API-key creation is outside this runner. Keep the ordinary key-creation evidence with the operator’s onboarding records. Run in an isolated observation window with no other calls using R/V and no concurrent changes to the organization's key inventory.

Before and after **each** R/V verification, the runner reads inventory using only the human session. It requires exactly the expected key UUID’s `last_used_at` to advance, with unchanged ownership, grants, other key usage and inventory. This works for the authenticated 403 response as well: the native organization owner records usage before gateway scope authorization. Subsecond UTC precision is preserved. No timestamp change, a changed wrong key, a second changed key, or changed metadata stops the run. This is explicitly an observed public identity binding, not a cryptographic secret-to-UUID introspection claim.

## Required existing policy and trust profile

The probe accepts one deliberately narrow saved policy. Prepare and review it using the normal operator workflow before this runner; the runner does not create or modify it.

- Owned by the original course organization, status `active`, same OB3 baseline compliance ID as the course template (`10000000-0000-0000-0000-000000000003`), and accepted type exactly `OpenBadgeCredential`.
- Exactly one required `VC_JWT` requirement for the course template. The top-level and requirement `trust_profile_id` must be the same explicit UUID.
- Exactly two requested claims, `learner_id` and `achievement`. Each must be required, nonselective, not derived, with no predicate and one `equals` constraint containing its **complete exact value from the original journal**. An achievement-ID-only constraint is insufficient.
- `holder_binding.required: false`. This exercises credential verification; it does not establish a fresh presentation or wallet-holder proof.
- Freshness requires `require_not_revoked: true`, `max_age_seconds: null`, and an explicit revocation grace from 0 to 300 seconds. The requirement does not request fresh issuance and has no maximum-age limit.
- No top-level required claims, alternative requirements, prerequisite profile, issuer constraints, fallback policy, predicates, or supported circuits. The issuer allowlist is enforced by the selected trust profile.

The trust profile must be owned by the same organization, `profile_type: CUSTOM`, `status: ACTIVE`, algorithms exactly `ES256`, formats exactly `VC_JWT`, allowed issuers exactly the observed managed course issuer DID, and empty denied issuers / additional trust sources. This is a dedicated course verification profile. The runner does not edit the installation’s bootstrap profiles or template references.

The active course template must retain its achievement URI as `vct`, use `OpenBadgeCredential` / `VC_JWT`, and declare only required nonselective `learner_id: STRING` and `achievement: OBJECT` claims. The probe rereads and hashes the template, policy and trust profile before every lifecycle mutation. Configuration drift stops further transitions.

## Sequence and evidence

1. Claim a one-shot run marker before any network call. Read and validate the exact template, policy, trust profile and active public credential record. Observe the two fresh keys and their exact scopes.
2. Send the same JWT and policy through R, require 403, and observe only R’s usage advance. Send it through V, require 200/allow, and observe only V’s usage advance. Require signature, trust and active status evidence for the exact credential.
3. Reread all bound resources, suspend the synthetic credential once, and require a matching `SUSPENDED` record from both the mutation and fresh GET. V must return 422/verified false. The operator’s separate saved-policy evaluation must prove the authenticated credential is currently suspended.
4. Reread bound resources, reinstate once, and require `ACTIVE` readbacks plus V’s new 200/allow result.
5. Reread bound resources, revoke once, and require `REVOKED` readbacks, V’s 422 denial, and the operator’s detailed revoked-status result. Save the terminal record and finish. No subsequent lifecycle action is permitted.

VC-API intentionally returns only `verified: false` and `errors: ["verification_failed"]` for a policy rejection. This generic response cannot prove a status reason. The detailed saved-policy evaluation must have a current `evaluation_timestamp`, `decision: deny`, `result: failed`, and one matching credential result with `signature_valid: true`, `trust_check_passed: true`, `freshness_check_passed: true`, `revocation_checked: true`, `not_revoked: false`, lowercase `revocation_status: suspended|revoked`, and `error_codes: ["credential_revoked"]`. Both suspension and revocation use that same error code; the status field distinguishes them. Missing status evidence, stale evidence, expired credentials, and signature/trust failures do not pass.

For the inspected native VC-JWT/OpenbadgeV3 paths, the verified-facts orchestrator reads current PostgreSQL-backed managed status on each evaluation. The default outbound client has no HTTP response cache. No TTL delay is needed after a successful mutation and readback on this specific path. Confirm the signed deployment uses the default native managed-status resolver. A custom `MIP_CREDENTIAL_STATUS_URL_TEMPLATE` or another status implementation needs separate review. The public API provides no status-checked-at field; the runner does not invent one or claim stronger freshness evidence.

Every POST gets an exclusive request-hash journal **before** transport, including verification and operator evaluation. If a write times out or returns an unexpected response, the probe stops and never retries it. An attempted run cannot be restarted. The last observed record and attempted request remain available for operator reconciliation; deleting state to replay a transition is not a supported recovery procedure.

Reports contain fixed route/method labels, HTTP status, UUID correlation IDs (other correlation strings are hashed), key UUIDs/scopes and bounded usage observations, resource/request/credential hashes, decision/status evidence and a static stop code. They do not persist response bodies or evaluation claims. A passed fake test suite proves orchestration behavior only; actual signed-runtime results remain pending.

## Validation and execution

The files are `probe-scope-lifecycle.cjs`, `probe-scope-lifecycle.test.cjs`, and `scope-lifecycle-config.example.json`. They use the same local public transport and compact-JWT decoder as the course client. Copy the configuration example to `scope-lifecycle-config.json` and replace every placeholder with observed values and private file locations. Node.js 24 or later is required; no extra npm dependencies are needed.

```sh
node --test probe-scope-lifecycle.test.cjs
node --check probe-scope-lifecycle.cjs
```

After reviewing the resources, credential and terminal revocation, use the explicit execution entrypoint:

```sh
node probe-scope-lifecycle.cjs run scope-lifecycle-config.json
```

Use the normal Node TLS trust configuration for the installation certificate. Certificate validation and HTTPS remain enabled.

Public route and response contracts were reconciled against UI `44864dcf9bc823778eaf70efe4e861a0e77f172b`: [public credential records](https://github.com/ElevenID/marty-ui/blob/44864dcf9bc823778eaf70efe4e861a0e77f172b/rust/services/gateway/src/response_projection.rs), [VC-API adaptation](https://github.com/ElevenID/marty-ui/blob/44864dcf9bc823778eaf70efe4e861a0e77f172b/rust/services/gateway/src/vc_api.rs), [saved-policy evaluation](https://github.com/ElevenID/marty-ui/blob/44864dcf9bc823778eaf70efe4e861a0e77f172b/rust/services/presentation-policy/src/http_service.rs), and [native managed-status resolution](https://github.com/ElevenID/marty-ui/blob/44864dcf9bc823778eaf70efe4e861a0e77f172b/rust/services/presentation-policy/src/control_plane.rs). Reconcile any changed signed candidate with these contracts before execution.
