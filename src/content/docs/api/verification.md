---
title: Verification API
description: Verify verifiable credentials using trust policies via the ElevenID REST API.
---

## Verify a credential

```
POST /api/v1/verify
```

Verify the authenticity and validity of a verifiable credential against a trust profile.

### Request

```json
{
  "credential": {
    "@context": ["https://www.w3.org/2018/credentials/v1"],
    "type": ["VerifiableCredential", "OpenBadgeCredential"],
    "issuer": "did:web:university.example",
    "credentialSubject": {
      "achievement": {
        "name": "Bachelor of Computer Science"
      }
    }
  },
  "format": "vc",
  "policies": ["signature", "expiration", "revocation", "issuer_trust"]
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `credential` | object | Yes | The credential to verify |
| `format` | string | No | Format: `vc`, `sd-jwt`, or `mdoc`. Default: `vc` |
| `policies` | string[] | No | Specific policies to evaluate |

### Response

```json
{
  "verified": true,
  "checks": [
    { "name": "signature", "passed": true },
    { "name": "expiration", "passed": true },
    { "name": "revocation", "passed": true },
    { "name": "issuer_trust", "passed": true }
  ]
}
```

## Check verification status

```
GET /api/v1/verify/:id
```

Poll the status of an asynchronous verification session.

### Response

```json
{
  "id": "ver_abc123",
  "status": "completed",
  "verified": true
}
```

## CLI equivalent

```bash
marty verify start --trust-profile <id> --credential ./cred.json --json
```
