---
title: marty trust
description: Manage trust profiles — define who is trusted and under what rules.
sidebar:
  order: 3
---

Trust profiles define which issuers and verifiers are trusted within your organization, and under what policies.

## Commands

### `marty trust list`

List all trust profiles.

```bash
marty trust list [--json]
```

### `marty trust inspect`

Inspect a trust profile's configuration.

```bash
marty trust inspect <profile-id> [--json]
```

### `marty trust create`

Create a new trust profile.

```bash
marty trust create [options] [--json]
```

## Related

- [Trust Profiles concept](/concepts/trust-profiles/)
