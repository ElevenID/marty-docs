---
title: CLI Overview
description: Overview of the Marty CLI and all available commands.
sidebar:
  order: 0
---

The **Marty CLI** (`marty`) is the primary developer interface for ElevenID. It wraps every API operation into composable terminal commands with structured JSON output.

## Usage

```bash
marty <command> [subcommand] [options]
```

All commands support `--json` for structured output, making them suitable for scripting, CI/CD pipelines, and AI coding assistants.

## Command reference

| Command | Description |
|---------|-------------|
| [`marty init`](/cli/init/) | Initialize CLI configuration interactively |
| [`marty auth`](/cli/auth/) | Authenticate with ElevenID (login, whoami) |
| [`marty health`](/cli/health/) | Check API connectivity |
| [`marty orgs`](/cli/orgs/) | List and switch organizations |
| [`marty verify`](/cli/verify/) | Verify credentials (start, status, submit) |
| [`marty creds`](/cli/credentials/) | Manage credentials (list, inspect, issue, revoke) |
| [`marty trust`](/cli/trust/) | Manage trust profiles (list, inspect, create) |
| [`marty ct`](/cli/credential-templates/) | Manage credential templates (list, inspect, create) |
| [`marty compliance`](/cli/compliance/) | Manage compliance profiles (list, inspect, create) |
| [`marty flows`](/cli/flows/) | List identity flows |
| [`marty config`](/cli/config/) | View and set local configuration |
| [`marty test`](/cli/test/) | Run end-to-end test scenarios |
| [`marty completion`](/cli/completion/) | Generate shell completions (bash, zsh, fish) |

## Global options

| Option | Description |
|--------|-------------|
| `--json` | Output results as JSON |
| `--help` | Show help for a command |
| `--version` | Show CLI version |

## For AI agents

AI coding assistants (GitHub Copilot, Cursor, Windsurf) can run Marty CLI commands directly from the terminal. The `--json` flag ensures structured output that agents can parse reliably.

```bash
# Example: AI agent verifies a credential
marty verify start --trust-profile eudi-pid --credential ./cred.json --json
```
