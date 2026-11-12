---
title: CLI Overview
description: Command contracts for the released native Marty CLI v0.3.6.
sidebar:
  order: 0
---

This reference targets **Marty CLI v0.3.6**. Check `marty --version` and use
`marty <command> --help` to inspect the binary you installed. The CLI covers
selected public operations; the installed gateway's `/openapi.json` describes
the broader API.

## Usage and output

```sh
marty --global-output json <command> <subcommand> [options]
```

`--global-output` accepts `table`, `json`, or `json-compact` and applies to commands
that render structured results. Many read commands also accept `--output` / `-o`.
There is no universal `--json` flag. Informational messages and `--dry-run`
previews can still be text; do not assume every command emits one JSON document.

| Command | Purpose |
| --- | --- |
| `marty init` | Interactive local configuration |
| [`marty auth`](/cli/auth/) | Save or clear credentials; inspect saved authentication |
| `marty api-keys` | List, create, and revoke organization machine keys |
| `marty health` | Check gateway connectivity |
| `marty orgs` | List, inspect, and select organizations |
| [`marty verify`](/cli/verify/) | Start flows, read status, submit a presentation, or evaluate a policy |
| [`marty credentials` / `creds`](/cli/credentials/) | Read issued records and use flow-associated credential operations |
| `marty applications` / `apps` | Manage credential applications |
| [`marty trust`](/cli/trust/) | Read and create trust profiles |
| [`marty credential-templates` / `ct`](/cli/credential-templates/) | Read, create, and activate credential templates |
| [`marty compliance`](/cli/compliance/) | Read and create compliance profiles |
| `marty flows` | Manage supported flow operations |
| `marty config show` / `set` | Read and change local configuration |
| `marty completion <shell>` | Generate bash, zsh, or fish completions |
| `marty test` | Run the CLI's selected test scenarios |
| `marty license` | Manage license activation and status |

## Configuration and automation

```sh
marty config set apiUrl https://gateway.example.org
marty orgs switch REPLACE_WITH_ORGANIZATION_UUID
marty --global-output json ct list
```

The origin has no `/api` or `/v1` suffix. `MARTY_API_URL`, `MARTY_ORG_ID`, and
`MARTY_CONFIG_DIR` can override the corresponding runtime settings. Supply an
organization API key through `MARTY_API_KEY` using your secret mechanism, or use
`marty auth login` and choose its masked API-key prompt.

For supported mutations, `--dry-run` prints the destination and payload without
sending the request. It validates command syntax, not server acceptance. The
[course example](/guides/ob3-course-integration/) provides a complete public
OID4VCI offer and learner claim flow; `marty credentials issue` uses a different
flow-associated endpoint.

Sources: [v0.3.6 command definitions](https://github.com/ElevenID/marty-cli/blob/v0.3.6/crates/marty-cli/src/commands/mod.rs)
and [configuration](https://github.com/ElevenID/marty-cli/blob/v0.3.6/crates/marty-cli/src/config.rs).
