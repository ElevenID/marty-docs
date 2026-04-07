---
title: Authentication
description: Authenticate the Marty CLI with your ElevenID account.
---

The Marty CLI supports two authentication methods: **interactive login** (OAuth2) and **API keys**.

## Interactive login

```bash
marty auth login
```

This opens a browser window for OAuth2 authentication. After completing the flow, your credentials are stored locally at `~/.marty/credentials.json`.

## Check your identity

```bash
marty whoami
```

## API key authentication

For CI/CD pipelines and automated workflows, use an API key:

```bash
marty config set apiKey <your-api-key>
```

API keys are scoped to an organization and can be created from the ElevenID console.

## Switch organizations

If you belong to multiple organizations:

```bash
# List your organizations
marty orgs list

# Switch to a different organization
marty orgs switch <org-id>
```

## Configuration

View your current configuration:

```bash
marty config show
```

Configuration is stored at `~/.marty/config.json`.

## Next steps

- [Run the quick start](/getting-started/quickstart/)
