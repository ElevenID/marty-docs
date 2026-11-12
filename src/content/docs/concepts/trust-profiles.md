---
title: Trust Profiles
description: How trust profiles work — defining who is trusted and under what rules.
sidebar:
  order: 1
---

A **trust profile** defines the rules for verifying credentials within a specific context. It answers the question: *who do we trust, for what, and under which policies?*

## What a trust profile contains

| Component | Purpose |
|-----------|---------|
| **Trust framework** | The regulatory or organizational framework (e.g., eIDAS2, Open Badges) |
| **Accepted formats** | Which credential formats are accepted (VC, SD-JWT, mDoc) |
| **Trusted issuers** | Which DIDs or organizations are authorized to issue specific credential types |
| **Policies** | Verification policies: minimum disclosure, holder binding, revocation checking |

## Trust configuration and policy evaluation

A trust profile and a presentation policy have distinct roles. Select an active,
organization-owned trust profile with the supported algorithms and formats;
configure a presentation policy for the credential requirements and claims your
application needs. Use the installed API's snake_case contract when creating
these resources. The policy evaluator combines authenticated credential facts
with the selected trust and policy configuration.

For the synchronous VC-API route, the caller supplies an organization ID and
saved presentation-policy ID. A machine client needs both verification execution
and policy read/evaluate authority. The [verification API](/api/verification/)
describes those scopes and the actual verdict shape.

A profile name such as an education or regulatory framework is configuration
metadata. It does not establish certification or legal compliance by itself.

## CLI usage

```bash
marty --global-output json trust list
marty --global-output json trust inspect <profile-id>
marty trust create --help
```

## Related

- [Credential Templates](/concepts/credential-templates/)
- [Marty Identity Protocol](/concepts/marty-protocol/)
- [Trust Profile API](/api/trust-registry/)

Source: [policy authorization and evaluation](https://github.com/ElevenID/marty-ui/blob/b7c7055830722d10512ccac042b1e0abe0e1ecec/rust/services/presentation-policy/src/application.rs).
