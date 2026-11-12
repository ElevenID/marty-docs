---
title: marty auth
description: Authenticate the native CLI with a supported organization API key.
sidebar:
  order: 1
---

## Interactive API-key login

```sh
marty auth login
```

Choose **API Key** and enter the key at the masked prompt. This stores local
credentials; it does not launch an OAuth browser flow or validate the key with
the server. Check access using an operation covered by the key's scopes:

```sh
marty --global-output json ct list
```

`ct list` requires template read access. An issuance-only key should instead be
checked with a request it is actually authorized to perform.

## Automation

Supply `MARTY_API_KEY` through your job's secret mechanism. It takes precedence
over saved credentials. Although `auth login --api-key` exists, passing a live
key as an argument can expose it in shell history and process listings; use the
environment mechanism or masked prompt for real secrets.

The CLI also offers `--client-id`, `--client-secret`, and `--token-url` for obtaining
an OAuth client-credentials token. Current Marty gateway machine authentication
requires an organization API key; obtaining an OAuth token does not establish
access to that gateway.

## Inspect and clear saved credentials

```sh
marty --global-output json auth whoami
marty auth logout
```

`whoami` describes the saved credential, with a masked key or token expiry. It
makes no server request and does not inspect `MARTY_API_KEY`. `logout` removes
saved credentials; it neither revokes a server-side key nor clears an environment
variable. Saved credentials normally reside in `~/.marty/credentials.json`, or
inside the directory selected with `MARTY_CONFIG_DIR`.

See [Authentication](/getting-started/authentication/) for organization bootstrap,
scopes, and key rotation.

Source: [CLI v0.3.6 authentication implementation](https://github.com/ElevenID/marty-cli/blob/v0.3.6/crates/marty-cli/src/commands/mod.rs).
