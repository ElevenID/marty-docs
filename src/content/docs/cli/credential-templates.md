---
title: marty ct (credential-templates)
description: Read, create, and activate credential templates with CLI v0.3.6.
sidebar:
  order: 4
---

## Read templates

```sh
marty --global-output json ct list --limit 50
marty --global-output json ct inspect REPLACE_WITH_TEMPLATE_UUID
```

Select the organization with `marty orgs switch <organization-uuid>`. Template
reads need `templates:read`; creation and activation need `templates:write`
or corresponding human permissions.

## Create and activate

`ct create` requires `--name`, `--credential-type`, `--compliance-profile-id`,
`--claims`, and `--issuer-did`. Its optional fields include `--trust-profile-id`,
`--format`, `--vct`, `--doctype`, `--issuance-protocol`, and `--privacy-posture`.
`--claims` is a nonempty literal JSON array. Inspect the exact flags before
constructing a template:

```sh
marty ct create --help
marty ct activate REPLACE_WITH_TEMPLATE_UUID --dry-run
```

The default format is `SD_JWT_VC`, which requires `--vct`; `MDOC` and `ZK_MDOC`
require `--doctype`. For the course integration, explicitly select `VC_JWT`,
`OpenBadgeCredential`, and `OID4VCI_PRE_AUTH`. The seeded internal value
`open_badge` is not an accepted public credential-type name for creation.

The CLI create command does not expose every public template field, including
`revocation_profile_id`. The [course setup helper](/guides/ob3-course-integration/)
uses the public API to bind the selected compliance, trust, and revocation profiles and checks
that the resulting template is active before issuance.

Sources: [released template commands](https://github.com/ElevenID/marty-cli/blob/v0.3.6/crates/marty-cli/src/commands/mod.rs)
and [credential template concept](/concepts/credential-templates/).
