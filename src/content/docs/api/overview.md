---
title: API Overview
description: REST API overview for ElevenID credential verification, issuance, and trust management.
---

The ElevenID REST API provides HTTP endpoints for all credential operations. The full specification is available as an [OpenAPI document](https://elevenidllc.com/openapi.yaml).

## Base URL

```
https://elevenidllc.com/api/v1
```

## Authentication

All API requests require authentication via Bearer token or API key header.

```bash
# Bearer token (from OAuth2 login)
Authorization: Bearer <token>

# API key
X-API-Key: <api-key>
```

## Endpoints

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/verify` | [Verify a credential](/api/verification/) |
| `GET` | `/verify/:id` | Check verification status |
| `POST` | `/credentials` | [Issue a credential](/api/issuance/) |
| `POST` | `/credentials/revoke` | Revoke a credential |
| `GET` | `/trust-profiles` | [List trust profiles](/api/trust-registry/) |
| `POST` | `/trust-profiles` | Create a trust profile |
| `GET` | `/credential-templates` | List credential templates |
| `POST` | `/credential-templates` | Create a credential template |
| `GET` | `/compliance-profiles` | List compliance profiles |
| `GET` | `/flows` | List identity flows |
| `GET` | `/organizations` | List organizations |
| `GET` | `/health` | Health check |

## Response format

All responses return JSON. Successful responses use standard HTTP status codes:

- `200` — Success
- `201` — Created
- `400` — Invalid request
- `401` — Authentication required
- `404` — Resource not found

## OpenAPI specification

The machine-readable OpenAPI specification is available at:

```
https://elevenidllc.com/openapi.yaml
```

AI agents and developer tools can ingest this spec to generate integrations automatically.
