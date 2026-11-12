---
title: marty verify
description: Start verification flows or evaluate credentials against a saved policy.
sidebar:
  order: 5
---

## Start and inspect an asynchronous flow

```sh
marty --global-output json verify start --policy REPLACE_WITH_POLICY_UUID --dry-run
marty --global-output json verify status REPLACE_WITH_SESSION_ID
marty --global-output json verify sessions --limit 50
marty --global-output json verify inspect REPLACE_WITH_SESSION_ID
```

`start` sends `presentation_policy_id`, the configured `organization_id`, and an
optional `--trust-profile` to `/v1/flows/verify`. Remove `--dry-run` to create the
intended flow. In automation, supply `--policy` explicitly; the interactive
selection path is not appropriate for an unattended client. `status` reads
`/v1/flows/instances/{id}`. Creating a session does not itself verify a credential.

`verify submit <session-id> --presentation '<JSON>'` sends the supplied JSON body
to `/v1/flows/instances/{id}/submit`. Use the submission shape required by the
selected flow and installed API. `--presentation` accepts literal JSON, not a
file path. Add `--dry-run` to inspect a synthetic submission before sending it.

## Evaluate a saved policy directly

```sh
marty --global-output json verify evaluate \
  --policy REPLACE_WITH_POLICY_UUID \
  --credential REPLACE_WITH_ACTUAL_CREDENTIAL --dry-run
```

This targets `/v1/presentation-policies/{id}/evaluate`, sending the supplied
credential as `vp_token`, with an optional `--trust-profile`. The returned value
is the policy service's evaluation. The current command does not expose
challenge/domain options; use the [VC-API](/api/verification/) when the
presentation needs those explicit inputs.

`--credential` is a literal credential/token, not a filename. For private
credentials, prefer an HTTP client that reads a private file rather than placing
the value in process arguments. A direct saved-policy evaluation requires policy
read/evaluate access; the VC-API adapter additionally checks permission to execute
verification, as described in its API reference.

Source: [CLI v0.3.6 verification commands](https://github.com/ElevenID/marty-cli/blob/v0.3.6/crates/marty-cli/src/commands/mod.rs).
