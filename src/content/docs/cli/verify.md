---
title: marty verify
description: Verify credentials using trust profiles and presentation policies.
sidebar:
  order: 1
---

Verify the authenticity and validity of verifiable credentials against configured trust profiles.

## Commands

### `marty verify start`

Start a new credential verification session.

```bash
marty verify start [options]
```

| Option | Description |
|--------|-------------|
| `--trust-profile <id>` | Trust profile to verify against |
| `--credential <path>` | Path to credential file (JSON) |
| `--json` | Output result as JSON |

**Example:**

```bash
marty verify start \
  --trust-profile eudi-pid \
  --credential ./credential.json \
  --json
```

**Response:**

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

### `marty verify status`

Check the status of a verification session.

```bash
marty verify status <session-id> [--json]
```

### `marty verify submit`

Submit a presentation to an existing verification session.

```bash
marty verify submit <session-id> [options]
```
