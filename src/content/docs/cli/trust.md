---
title: marty trust
description: Read and create trust profiles with the released CLI.
sidebar:
  order: 3
---

```sh
marty --global-output json trust list --limit 50
marty --global-output json trust inspect REPLACE_WITH_PROFILE_UUID
marty trust create --help
```

Select your organization before listing or creating profiles. Reads require
`trust:read`; creation requires `trust:write` or the corresponding human
permission.

`trust create` requires `--name`. The released command also accepts
`--profile-type` (default `standard`), `--allowed-algorithms`,
`--supported-formats`, and `--key-storage` (default `software`). Use `--dry-run`
to inspect a prospective request. Check accepted profile values in the installed
API before sending it; a locally constructed request does not establish server
acceptance or activate a profile.

For the course example, use the already provisioned, active customer-owned
profile selected by the [operator setup helper](/guides/ob3-course-integration/).
See [Trust Profiles](/concepts/trust-profiles/) for the configuration's role.

Source: [CLI v0.3.6 trust commands](https://github.com/ElevenID/marty-cli/blob/v0.3.6/crates/marty-cli/src/commands/mod.rs).
