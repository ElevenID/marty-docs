---
title: Authentication
description: Use an organization-scoped API key for unattended Marty integrations.
---

## Machine clients use organization API keys

Send your deployment's organization API key in `X-API-Key`. The gateway also
recognizes an API key in `Authorization: Bearer`, with a supported `mk_live_`,
`mk_test_`, `pk_live_`, or `pk_test_` prefix. An ordinary OAuth access token or OIDC
ID token is not a gateway machine credential. Keycloak administration credentials
are not customer integration credentials.

An authorized operator first provisions the organization and initial credential
through the installation's approved bootstrap process. There is no unauthenticated
customer bootstrap API. Once bootstrapped, a key with `admin:full` can manage keys
within its own organization. Human operators need the corresponding API-key
management permissions. Use narrower keys for day-to-day clients.

## Choose explicit scopes

| Client task | Scopes for the examples here |
| --- | --- |
| Read a credential template | `templates:read` |
| Run the course offer, claim, and readback example | `templates:read`, `credentials:issue`, `credentials:read` |
| Verify a credential through the policy-backed VC-API | `credentials:read`, `trust:read` |
| Revoke an issued credential | `credentials:revoke` |

Verification requires both permission to execute verification and permission to
read/evaluate the selected presentation policy. A key restricted to issuance does
not automatically gain verification or policy access. Organization ownership is
checked independently of scopes.

Create a course-client key using an authorized operator or bootstrap key:

```http
POST /v1/api-keys?organization_id=REPLACE_WITH_ORGANIZATION_UUID
Content-Type: application/json
```

```json
{
  "name": "canyon-course-client",
  "description": "Synthetic course completion integration",
  "scopes": ["templates:read", "credentials:issue", "credentials:read"],
  "is_test": true
}
```

The response includes the secret in `key` **once**. Store it privately; listing
keys returns metadata and cannot recover the secret. Always provide `scopes`
explicitly: omission currently defaults to `credentials:read` and
`credentials:issue`. An optional `expires_at` must be a future RFC 3339 timestamp.
The `is_test` prefix does not create an isolated environment.

## Authenticate the CLI

For an interactive terminal, run `marty auth login` and choose **API Key**. Its
masked prompt avoids putting the secret in shell history or process arguments.
This command stores local credentials; it does not open a browser login.

For automation, supply `MARTY_API_KEY` through the job's secret mechanism:

```sh
marty config set apiUrl https://gateway.example.org
marty orgs switch REPLACE_WITH_ORGANIZATION_UUID
marty --global-output json ct list
```

The CLI reads the environment key before saved credentials. `marty auth whoami`
describes saved local credentials; it does not validate an environment key against
the server. Validate that key with an authorized read such as `ct list`.

Local configuration and saved credentials are normally under `~/.marty/`;
`MARTY_CONFIG_DIR` selects another directory. `marty auth logout` clears saved
credentials. It does not unset `MARTY_API_KEY` or revoke a server-side key.

The CLI can obtain an OAuth token with its client-credentials login options, but
that token does not authenticate the current Marty gateway. Use the supported
API-key path above for these integrations.

## Key management and rotation

CLI v0.3.6 includes the following commands. Creation prints the one-time secret,
so direct that output to your private secret-handling process.

```sh
marty api-keys list --organization-id REPLACE_WITH_ORGANIZATION_UUID
marty api-keys create --organization-id REPLACE_WITH_ORGANIZATION_UUID \
  --name credential-reader --scope credentials:read --dry-run
marty api-keys revoke REPLACE_WITH_KEY_ID \
  --organization-id REPLACE_WITH_ORGANIZATION_UUID --dry-run
```

Repeat `--scope` for multiple scopes. Remove `--dry-run` only for the intended
change. Rotate by creating a replacement, moving the client to it, verifying the
client's authorized operation, and then revoking the previous key.

Source: [gateway machine authentication](https://github.com/ElevenID/marty-ui/blob/b7c7055830722d10512ccac042b1e0abe0e1ecec/docs/API_MACHINE_AUTHENTICATION.md),
[scope policy](https://github.com/ElevenID/marty-ui/blob/b7c7055830722d10512ccac042b1e0abe0e1ecec/rust/crates/api-key-policy/src/lib.rs),
and [released CLI authentication](https://github.com/ElevenID/marty-cli/blob/v0.3.6/crates/marty-cli/src/commands/mod.rs).
