---
title: Quick Start
description: Check your deployment and issue a synthetic course completion badge.
---

This quick start uses a realistic, bounded client: **Canyon Skills Academy** issues
a **Workplace Safety Foundations** achievement after a workshop and an assessment
score of at least 80 percent. Use synthetic learner data in a deployment you own.

## 1. Check the release and connection

[Install the native CLI](/getting-started/installation/) and configure an
[organization API key](/getting-started/authentication/) with
`templates:read`, `credentials:issue`, and `credentials:read`.

```sh
marty --version
marty config set apiUrl https://gateway.example.org
marty orgs switch REPLACE_WITH_ORGANIZATION_UUID
marty --global-output json health
marty --global-output json ct list
```

The first read checks connectivity; the second checks authenticated template
access. These examples target CLI v0.3.6. Use `--global-output json` for structured
output; the CLI does not have a universal `--json` option.

## 2. Select the course template

Use an active, organization-owned `OpenBadgeCredential` template configured for
`VC_JWT` and `OID4VCI_PRE_AUTH`. It needs the intended managed issuer, trust and
revocation profiles, a string `learner_id` claim, and an object `achievement`
claim. Its `vct` must identify the course achievement.

```sh
marty --global-output json ct inspect REPLACE_WITH_COURSE_TEMPLATE_UUID
```

The installation's membership badge is not the course template. If you need to
create the course configuration, the
[OB3 course guide](/guides/ob3-course-integration/) includes a public operator
setup helper that inspects the organization, creates a separate template, and
creates an expiring scoped key.

## 3. Run the executable client

Get the [course example](https://github.com/ElevenID/marty-docs/tree/main/examples/ob3-course)
from this documentation repository. It requires Node.js 24 or later and no npm
packages. Copy `config.example.json` to `config.json`, replace all placeholders
with observed deployment values, and supply a private API-key file through
`MARTY_API_KEY_FILE`.

From `examples/ob3-course`:

```sh
node ob3-client.cjs offline-check
node ob3-client.cjs prepare config.json
node ob3-client.cjs preflight config.json
node ob3-client.cjs issue config.json
node ob3-client.cjs claim config.json
node ob3-client.cjs verify config.json
node ob3-client.cjs readback config.json
```

`offline-check` tests only the example's local cryptography. The subsequent
commands make real requests to your configured deployment. `issue` creates an
OID4VCI offer. `claim` redeems that offer using a separately retained learner
key and saves the signed credential. `verify` independently checks its signature
and the expected issuer, learner, course, and criteria; `readback` checks the
stored transaction and credential record.

The example journals mutations before sending them and refuses an automatic
repeat after an uncertain result. Preserve the private state directory if a
request fails. Follow the [guide's troubleshooting steps](/guides/ob3-course-integration/)
before attempting another completion event.

## 4. Assess the result

A complete run should show unauthorized template reads denied, the scoped key's
read accepted, a course offer created, learner claim completed, independent
signature and binding checks passed, tampering rejected, and the persisted record
matched. Review the generated `report.json`; keep offers, tokens, keys, and the
credential private.

This example does not perform revocation-list validation, a full OB3 conformance
assessment, or third-party wallet qualification. Its separate schema helper
checks a pinned official schema and keeps envelope/profile questions visible.
See the [course guide](/guides/ob3-course-integration/) for the exact tested
boundary and remaining acceptance work.
