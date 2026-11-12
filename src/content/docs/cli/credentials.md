---
title: marty credentials (creds)
description: Read issued credentials and distinguish flow-associated issuance from OID4VCI offers.
sidebar:
  order: 2
---

## Organization inventory

```sh
marty --global-output json credentials list --org --limit 50
marty --global-output json credentials inspect REPLACE_WITH_CREDENTIAL_ID --org
```

Select the organization first with `marty orgs switch <organization-uuid>`.
`list --org` reads `/v1/issued-credentials` with that organization filter;
`inspect --org` reads the organization-owned issued record. Without `--org`,
these commands use the current principal's personal credential inventory.
Use `--org` for an organization machine client.

## Flow-associated issuance

CLI v0.3.6 exposes this exact command shape:

```sh
marty --global-output json credentials issue \
  --credential-template-id REPLACE_WITH_TEMPLATE_UUID \
  --flow-execution-id REPLACE_WITH_FLOW_EXECUTION_ID \
  --subject-claims '{"given_name":"Synthetic learner"}' \
  --holder-identifier REPLACE_WITH_HOLDER_IDENTIFIER \
  --dry-run
```

The three required options are `--credential-template-id`, `--flow-execution-id`,
and `--subject-claims`; `--holder-identifier` is optional. JSON is passed as a
literal string, not a filename. This command targets `/v1/credentials/issue`.
A dry run only checks the command's request construction.

For the public course offer/claim journey, use
[`POST /v1/issuance`](/api/issuance/) or the
[executable OB3 example](/guides/ob3-course-integration/). That route accepts
`credential_subject` and returns an offer for a learner to redeem.

## Revoke a record

```sh
marty credentials revoke REPLACE_WITH_CREDENTIAL_ID \
  --reason "Synthetic exercise completed" --dry-run
```

The command targets `/v1/issued-credentials/{id}/revoke`; `--immediate` is an
additional supported option. Review the preview before removing `--dry-run`.
Revocation needs the corresponding credential-revoke permission or key scope.

## Verification command distinction

`credentials verify --credential <literal-value>` targets
`/v1/credentials/verify`. For a named saved presentation policy, use
[`verify evaluate`](/cli/verify/) or the documented
[VC-API verification endpoint](/api/verification/). They have distinct response
contracts; do not substitute one for another without checking the installed API.

Source: [released credential commands](https://github.com/ElevenID/marty-cli/blob/v0.3.6/crates/marty-cli/src/commands/mod.rs).
