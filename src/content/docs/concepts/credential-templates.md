---
title: Credential Templates
description: How credential templates define the structure and format of issued credentials.
sidebar:
  order: 2
---

A **credential template** defines the schema, format, and claims for a credential that can be issued. It is the blueprint for credential issuance.

## What a credential template defines

| Component | Purpose |
|-----------|---------|
| **Schema** | The structure and data types of credential subject claims |
| **Format** | Output format: W3C VC, SD-JWT, mDoc, or Open Badge |
| **Issuer configuration** | Which DID and key material to use for signing |
| **Validity** | Expiration rules and renewal policies |
| **Revocation** | How and whether credentials can be revoked |

## Example

```json
{
  "id": "ct_university-degree",
  "name": "University Degree",
  "format": "vc",
  "credentialType": "UniversityDegreeCredential",
  "schema": {
    "degree": { "type": "object", "properties": {
      "type": { "type": "string" },
      "name": { "type": "string" }
    }},
    "university": { "type": "string" }
  },
  "validity": {
    "duration": "P5Y"
  }
}
```

## CLI usage

```bash
marty ct list --json
marty ct inspect <template-id> --json
marty ct create --json
```

## Related

- [Trust Profiles](/concepts/trust-profiles/)
- [Issuance API](/api/issuance/)
