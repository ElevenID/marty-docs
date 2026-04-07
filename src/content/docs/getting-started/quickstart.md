---
title: Quick Start
description: Verify your first credential with ElevenID in under 5 minutes.
---

This guide walks you through verifying a credential using the Marty CLI.

## Prerequisites

- [CLI installed](/getting-started/installation/)
- [Authenticated](/getting-started/authentication/)

## 1. Check connectivity

```bash
marty health
```

You should see a successful health check response.

## 2. List available trust profiles

```bash
marty trust list --json
```

This returns the trust profiles configured in your organization. Each trust profile defines which issuers are trusted and which verification policies apply.

## 3. Start a verification

```bash
marty verify start \
  --trust-profile <profile-id> \
  --credential ./credential.json \
  --json
```

Example response:

```json
{
  "verified": true,
  "trustProfile": "eudi-pid",
  "checks": [
    { "name": "signature", "passed": true },
    { "name": "expiration", "passed": true },
    { "name": "revocation", "passed": true },
    { "name": "issuer_trust", "passed": true }
  ]
}
```

## 4. Explore credential templates

```bash
# List available templates
marty ct list --json

# Inspect a specific template
marty ct inspect <template-id> --json
```

## 5. Issue a credential

```bash
marty creds issue \
  --template <template-id> \
  --subject ./subject.json \
  --json
```

## What's next

- [CLI Reference](/cli/overview/) — full command documentation
- [API Overview](/api/overview/) — REST API endpoints
- [Trust Profiles](/concepts/trust-profiles/) — understand trust configuration
