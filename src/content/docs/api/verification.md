---
title: Verification API
description: Verify a credential or presentation against an organization-owned saved policy.
---

## Verify a credential synchronously

Use the policy-backed VC-API adapter with an existing presentation policy:

```http
POST /v1/vc-api/credentials/verify?organization_id=<organization-uuid>&presentation_policy_id=<policy-uuid>
X-API-Key: <organization API key>
Content-Type: application/json
```

```json
{
  "verifiableCredential": "REPLACE_WITH_ACTUAL_COMPACT_CREDENTIAL",
  "options": {}
}
```

Both query parameters are required. Use the exact credential returned by issuance;
a decoded payload or an incomplete unsigned JSON example cannot demonstrate a
successful cryptographic verification.

For a presentation, use `/v1/vc-api/presentations/verify` with the same query
parameters and a `verifiablePresentation` field. Supported inputs include signed
token strings and the adapter's supported proof-bearing JSON/envelope forms.
Confirm the exact format against your installed `/openapi.json` and protocol
catalog. When required by the selected presentation protocol, pass the expected
challenge and domain as `options.challenge` and `options.domain`; they map to
the policy evaluator's nonce and audience checks.

## Required authorization

For the least-privilege API-key example, grant **`credentials:read` and
`trust:read`**. The first authorizes verification execution; the second authorizes
reading/evaluating the saved presentation policy. A `flows:execute` grant is an
alternative to `credentials:read` for verification execution, and `trust:write`
also includes policy read access. Select the narrower grants your client needs.

The key must belong to the requested organization, and the policy must be owned
by that organization. Having one of these scopes does not waive the other check.
Normal human sessions need the corresponding verification and presentation-policy
permissions.

## Interpret the verdict

A successful response has HTTP `200`, `verified: true`, the underlying evaluation
under `results`, and an empty `problemDetails` array. Inspect the policy results
to understand what was accepted. A rejected verification is returned as an error,
including HTTP `422` where applicable; do not treat any JSON response as success.

| Status | Meaning to investigate |
| --- | --- |
| `401` | Missing or invalid authentication |
| `403` | Organization, resource, or scope access denied |
| `413` | Request exceeds the gateway body limit |
| `422` | Invalid input or rejected credential/presentation |
| `502` | Policy dependency unavailable or returned an invalid response |

The saved policy determines the credential, issuer, trust, freshness, binding,
and status requirements. A signature check in a standalone client proves less
than an accepted policy evaluation. Conversely, an internal record marked
`ACTIVE` is not proof of signature validity or public revocation status.

## CLI and asynchronous flows

The released CLI's direct policy evaluation command is:

```sh
marty --global-output json verify evaluate \
  --policy REPLACE_WITH_POLICY_UUID \
  --credential REPLACE_WITH_ACTUAL_CREDENTIAL --dry-run
```

This targets `/v1/presentation-policies/{id}/evaluate` and returns the policy
service's response, not the VC-API wrapper. `--credential` is a literal value,
not an implicit filename; use a private programmatic HTTP client when the
credential must not appear in process arguments.

`marty verify start --policy …` starts a separate asynchronous verification flow.
Its status is read with `marty verify status <session-id>`. See the
[CLI verification reference](/cli/verify/) for those exact commands.

Sources: [VC-API adapter](https://github.com/ElevenID/marty-ui/blob/b7c7055830722d10512ccac042b1e0abe0e1ecec/rust/services/gateway/src/vc_api.rs),
[gateway routes](https://github.com/ElevenID/marty-ui/blob/b7c7055830722d10512ccac042b1e0abe0e1ecec/rust/services/gateway/src/runtime.rs),
[scope policy](https://github.com/ElevenID/marty-ui/blob/b7c7055830722d10512ccac042b1e0abe0e1ecec/rust/crates/api-key-policy/src/lib.rs),
and [saved-policy authorization](https://github.com/ElevenID/marty-ui/blob/b7c7055830722d10512ccac042b1e0abe0e1ecec/rust/services/presentation-policy/src/application.rs).
