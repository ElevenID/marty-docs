---
title: Trust Registry API
description: Query and manage trust profiles, trusted issuers, and trust frameworks via the REST API.
---

## List trust profiles

```
GET /api/v1/trust-profiles
```

Returns all trust profiles configured in your organization.

### Response

```json
{
  "profiles": [
    {
      "id": "tp_eudi-pid",
      "name": "EUDI PID Verification",
      "trustFramework": "eIDAS2",
      "acceptedFormats": ["sd-jwt", "mdoc"],
      "status": "active"
    }
  ]
}
```

## Create a trust profile

```
POST /api/v1/trust-profiles
```

### Request

```json
{
  "name": "EUDI PID Verification",
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

## CLI equivalent

```bash
marty trust list --json
marty trust inspect <profile-id> --json
marty trust create --json
```
