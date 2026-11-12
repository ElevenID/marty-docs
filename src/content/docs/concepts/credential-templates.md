---
title: Credential Templates
description: Bind claims, issuer identity, format, protocol, and profiles in a credential template.
sidebar:
  order: 2
---

A credential template binds the claims your application supplies to the issuer,
payload format, issuance protocol, and supporting profiles. Use the public API's
snake_case field names when creating or reading templates.

| Field | Purpose in the course integration |
| --- | --- |
| `organization_id` | Owns the template and bounds access |
| `credential_type` | `OpenBadgeCredential` on public creation |
| `credential_payload_format` | `VC_JWT` for the demonstrated signed artifact |
| `issuance_protocol` | `OID4VCI_PRE_AUTH` for the learner claim |
| `issuer_did` | The intended active managed issuer identity |
| `vct` | Course achievement identifier, matched to `achievement.id` |
| `claims` | Required `learner_id` string and `achievement` object |
| `compliance_profile_id`, `trust_profile_id`, `revocation_profile_id` | Customer-owned profile references |
| `status` | Must be active for the intended issuance workflow |

Open Badges is the achievement credential model; the payload format and exchange
protocol are separate choices. Use the supported public type name
`OpenBadgeCredential`. An internal seed's `open_badge` alias cannot simply be
copied into a public template create request.

The [course setup example](/guides/ob3-course-integration/) creates a separate
course template, checks issuer/profile ownership, and activates it through the
public lifecycle route. It does not repurpose the installation's membership badge.

```sh
marty --global-output json ct list
marty --global-output json ct inspect REPLACE_WITH_TEMPLATE_UUID
marty ct create --help
marty ct activate REPLACE_WITH_TEMPLATE_UUID --dry-run
```

A local create preview validates CLI construction. Server-side validation,
activation, issuance, learner claim, and independent artifact validation are
separate checks.

Sources: [public template persistence and validation](https://github.com/ElevenID/marty-ui/blob/b7c7055830722d10512ccac042b1e0abe0e1ecec/rust/services/credential-template/src/persistence.rs)
and [issuance request contract](https://github.com/ElevenID/marty-ui/blob/b7c7055830722d10512ccac042b1e0abe0e1ecec/rust/services/gateway/src/issuance_create.rs).
