---
title: marty creds
description: Manage credentials — list, inspect, issue, and revoke.
sidebar:
  order: 2
---

Manage verifiable credentials and Open Badges.

## Commands

### `marty creds list`

List credentials in your organization.

```bash
marty creds list [--json]
```

### `marty creds inspect`

Inspect a specific credential.

```bash
marty creds inspect <credential-id> [--json]
```

### `marty creds issue`

Issue a new credential from a template.

```bash
marty creds issue [options]
```

| Option | Description |
|--------|-------------|
| `--template <id>` | Credential template to use |
| `--subject <path>` | Path to subject claims file (JSON) |
| `--json` | Output result as JSON |

**Example:**

```bash
marty creds issue \
  --template university-degree \
  --subject ./subject.json \
  --json
```

### `marty creds revoke`

Revoke an issued credential.

```bash
marty creds revoke <credential-id> [--json]
```
