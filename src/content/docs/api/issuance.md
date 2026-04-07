---
title: Issuance API
description: Issue verifiable credentials and Open Badges via the ElevenID REST API.
---

## Issue a credential

```
POST /api/v1/credentials
```

Issue a new verifiable credential or Open Badge using a credential template.

### Request

```json
{
  "templateId": "university-degree",
  "subject": {
    "id": "did:key:z6Mkh...",
    "degree": {
      "type": "BachelorDegree",
      "name": "Bachelor of Computer Science"
    }
  },
  "format": "vc"
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `templateId` | string | Yes | Credential template identifier |
| `subject` | object | Yes | Credential subject claims |
| `format` | string | No | Output format: `vc`, `sd-jwt`, `mdoc`, `open-badge`. Default: `vc` |

### Response

```json
{
  "credentialId": "cred_xyz789",
  "credential": { ... }
}
```

## Revoke a credential

```
POST /api/v1/credentials/revoke
```

### Request

```json
{
  "credentialId": "cred_xyz789"
}
```

## CLI equivalent

```bash
marty creds issue --template university-degree --subject ./subject.json --json
marty creds revoke <credential-id> --json
```
