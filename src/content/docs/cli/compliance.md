---
title: marty compliance
description: Inspect compliance configuration and preview supported create commands.
sidebar:
  order: 6
---

```sh
marty --global-output json compliance list --limit 50
marty --global-output json compliance inspect REPLACE_WITH_PROFILE_UUID
marty compliance create --help
```

`compliance create` requires `--name` and `--compliance-code`. Optional flags are
`--credential-format`, `--issuance-protocol`, `--presentation-protocol`, and
`--revocation-mechanism`. The released defaults are `SD_JWT_VC`, `OID4VCI`, and
`OID4VP` respectively. Use `--dry-run` to inspect the proposed payload and confirm
the supported profile values in the installed API before creating it.

Reads require `compliance:read`; creation requires `compliance:write` or the
corresponding human permissions. A compliance profile expresses configuration;
its existence alone does not establish legal or standards compliance.

Source: [CLI v0.3.6 compliance commands](https://github.com/ElevenID/marty-cli/blob/v0.3.6/crates/marty-cli/src/commands/mod.rs).
