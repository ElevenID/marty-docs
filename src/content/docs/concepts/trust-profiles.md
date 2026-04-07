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

## Example

```json
{
  "id": "trust-profile-eudi-pid",
  "name": "EUDI PID Verification",
  "version": "1.0.0",
  "trustFramework": "eIDAS2",
  "acceptedFormats": ["sd-jwt", "mdoc"],
  "trustedIssuers": [
    {
      "did": "did:web:gov.example",
      "credentialTypes": ["PersonIdentificationData"]
    }
  ],
  "policies": {
    "minimumDisclosure": true,
    "holderBinding": "required",
    "revocationCheck": "mandatory"
  }
}
```

## How trust profiles are used

1. A verifier selects a trust profile for a verification session
2. When a credential is presented, ElevenID evaluates it against the profile's rules
3. Each check (signature, expiration, revocation, issuer trust) runs against the profile's policies
4. The result indicates which checks passed or failed

## CLI usage

```bash
marty trust list --json
marty trust inspect <profile-id> --json
marty trust create --json
```

## Related

- [Credential Templates](/concepts/credential-templates/)
- [Marty Identity Protocol](/concepts/marty-protocol/)
- [Trust Registry API](/api/trust-registry/)
