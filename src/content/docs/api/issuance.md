---
title: Issuance API
description: Initiate an OID4VCI offer and follow it through learner claim and readback.
---

## Initiate the offer

```http
POST /v1/issuance
X-API-Key: <organization API key>
Content-Type: application/json
Idempotency-Key: canyon-safety-learner-a-completion-001
```

For the course example, send snake_case identifiers and a `credential_subject`:

```json
{
  "organization_id": "REPLACE_WITH_ORGANIZATION_UUID",
  "credential_template_id": "REPLACE_WITH_COURSE_TEMPLATE_UUID",
  "issuer_did": "did:web:gateway.example.org:orgs:canyon-skills-academy",
  "subject_did": "REPLACE_WITH_LEARNER_DID_JWK",
  "holder_did": "REPLACE_WITH_LEARNER_DID_JWK",
  "credential_subject": {
    "id": "REPLACE_WITH_LEARNER_DID_JWK",
    "type": ["AchievementSubject"],
    "learner_id": "synthetic-learner-a",
    "achievement": {
      "id": "https://canyon-skills.example/achievements/workplace-safety-foundations",
      "type": ["Achievement"],
      "name": "Workplace Safety Foundations",
      "description": "Completed the synthetic workshop and assessment.",
      "criteria": {
        "narrative": "Complete the workshop and score at least 80 percent on the practical assessment."
      }
    }
  }
}
```

The executable [course example](/guides/ob3-course-integration/) generates the
learner's P-256 key and `did:jwk` before sending this request. Replace placeholders
with observed identifiers. The `.example` achievement URL is a synthetic course
identifier, not a hosted course page.

### Request rules

- `organization_id` is required and must match the authenticated organization.
- Supply `credential_template_id` or `issuer_did`. The course workflow uses an
  active template and its exact issuer. An explicit issuer cannot override the
  template's issuer.
- Select one content input: `claims`, `credential_subject`, or
  `credential_document`. Do not combine a subject/document with nonempty claims.
- The template selects the payload format and issuance protocol. There is no
  top-level `format: "vc"` option on this route.
- Unknown top-level fields are rejected. Template, issuer, and profile access
  are checked by their owning services.

The course client uses `templates:read`, `credentials:issue`, and
`credentials:read` to cover its preflight, initiation, and readback.

## Read the response as an offer

The response contains an issuance transaction, including `id`,
`organization_id`, `credential_template_id`, and `credential_offer_uri`.
The `openid-credential-offer:` URI contains or references the offer. It may carry
a pre-authorized code and must be handled as sensitive data.

This response is an invitation to claim. The learner must still:

1. Read the offer's `credential_issuer` and discover its credential issuer metadata.
2. Resolve the advertised authorization-server metadata if needed.
3. Exchange the pre-authorized code at the discovered token endpoint.
4. Obtain the advertised nonce and sign a holder proof with the learner's key.
5. Request the credential at the discovered credential endpoint.

The dependency-free example implements this bounded flow for an inline,
pre-authorized `jwt_vc_json` offer and independently verifies the result.

## Check persistence and handle retries

Read `GET /v1/issuance/{transaction-id}` for the transaction and
`GET /v1/issued-credentials/{credential-id}` for the issued record. Verify that
their organization, template, state, and artifact binding match the request.
An `ACTIVE` stored record does not replace a public credential-status check.

Keep a durable client journal before initiating an offer. Retain the same logical
event identifier and request when reconciling a lost response. A new event key can
create a new credential. Confirm downstream durable idempotency in the installed
release before using automatic retries; an immediate gateway cache replay alone
does not establish it.

## CLI distinction

CLI v0.3.6 `marty credentials issue` targets the separate
`POST /v1/credentials/issue` flow-associated contract. Its required options are
`--credential-template-id`, `--flow-execution-id`, and `--subject-claims`.
It is not a shortcut for this `POST /v1/issuance` offer workflow. Use this public
API or the course example for the complete offer/claim integration.

Sources: [public request contract](https://github.com/ElevenID/marty-ui/blob/b7c7055830722d10512ccac042b1e0abe0e1ecec/rust/services/gateway/src/issuance_create.rs),
[gateway orchestration](https://github.com/ElevenID/marty-ui/blob/b7c7055830722d10512ccac042b1e0abe0e1ecec/rust/services/gateway/src/runtime_profile_operations.rs),
and [CLI v0.3.6](https://github.com/ElevenID/marty-cli/blob/v0.3.6/crates/marty-cli/src/commands/mod.rs).
