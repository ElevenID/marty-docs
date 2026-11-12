---
title: Trust Profile API
description: Inspect organization-owned trust profiles using the current public API.
---

## Read the organization's profiles

```http
GET /v1/trust-profiles?organization_id=<organization-uuid>
X-API-Key: <organization API key>
```

The current list contract returns an array of profile objects. Use the observed
`id` to read one profile at `GET /v1/trust-profiles/{id}`. The organization must
match the key's scope; reads require `trust:read` or `trust:write`.

```sh
marty --global-output json trust list
marty --global-output json trust inspect REPLACE_WITH_PROFILE_UUID
```

Select the organization in CLI configuration before listing profiles. Do not
infer trust acceptance merely from a profile's presence; inspect its lifecycle
state and the policy that actually uses it.

## Creation and lifecycle

The public collection route is `POST /v1/trust-profiles`. Use the installed
`/openapi.json` for its current snake_case fields and lifecycle operations.
The CLI exposes selected creation fields through `marty trust create --help`;
preview them with `--dry-run`. Creation requires `trust:write` or the corresponding
human permission and does not itself establish external issuer acceptance.

For the course integration, the operator setup helper reads and binds the
existing active customer-owned trust and revocation profiles. See
[OB3 Course Integration](/guides/ob3-course-integration/) for the observed setup.

Sources: [gateway contract](https://github.com/ElevenID/marty-ui/blob/b7c7055830722d10512ccac042b1e0abe0e1ecec/rust/services/gateway/src/runtime_profile_operations.rs)
and [shared scope policy](https://github.com/ElevenID/marty-ui/blob/b7c7055830722d10512ccac042b1e0abe0e1ecec/rust/crates/api-key-policy/src/lib.rs).
