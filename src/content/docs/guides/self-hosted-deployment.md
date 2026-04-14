---
title: Self-Hosted Deployment
description: Deploy ElevenID in your own environment with Docker or Kubernetes while keeping secrets and licensing supportable.
sidebar:
  order: 2
---

ElevenID self-hosting is designed around a simple contract that works across Docker Compose, Kubernetes, and regulated customer environments:

- Non-secret configuration stays in environment variables or config files.
- Secrets are supported as either direct environment variables or file-backed values.
- Licensed deployments should keep license material out of `.env` and treat it like any other secret.
- The product should integrate with the secret manager your environment already uses instead of forcing a single vendor-specific backend.

## What customers typically expect

When customers buy a self-hosted Docker product, the standard expectation is:

- The vendor ships one or more container images.
- The vendor provides a reference `compose.yaml`, Helm chart, or Kubernetes manifests.
- `.env` is used for non-secret settings such as hostnames, ports, feature flags, and organization identifiers.
- Secrets are injected from files, platform secrets, or external secret managers.
- Licensing works offline or semi-offline through a key or signed license file.

That is the least surprising deployment model for enterprise buyers and the easiest one to support over time.

## The recommended secret contract

For every secret, support both forms:

- `VAR`
- `VAR_FILE`

Examples:

- `POSTGRES_PASSWORD` or `POSTGRES_PASSWORD_FILE`
- `MARTY_API_CLIENT_SECRET` or `MARTY_API_CLIENT_SECRET_FILE`
- `LICENSE_KEY` or `LICENSE_KEY_FILE`
- `LICENSE_PUBLIC_KEY` or `LICENSE_PUBLIC_KEY_FILE`

The runtime behavior should be:

1. If both `VAR` and `VAR_FILE` are set, fail fast.
2. If `VAR_FILE` is set, read the file contents and export the final runtime variable.
3. If only `VAR` is set, use it directly.
4. If neither is set for a required secret, fail with a clear startup error.
5. If the supplied value is blank or still matches a shipped placeholder such as `change-me-...`, fail before the service starts.

This model works the same way whether the deployment source is Docker Compose secrets, a mounted Kubernetes Secret, or a file written by a secret-manager agent.

## Keep `.env` non-secret

For self-hosted deployments, `.env` should contain only non-secret values such as:

- public hostnames
- callback URLs
- organization IDs
- ports
- feature flags
- environment names

Do not store these in `.env` for production installs:

- database passwords
- admin passwords
- client secrets
- SMTP passwords
- Cloudflare tunnel tokens
- signing keys
- license keys or license files

## Docker Compose pattern

For Docker Compose, the most typical industry pattern is:

1. Keep non-secret settings in `.env`.
2. Mount secrets as files using Compose `secrets:` or bind-mounted files.
3. Pass `*_FILE` variables to the container.
4. Let the container entrypoint or bootstrap logic export the final runtime environment variables before the application starts.

Example:

```yaml
services:
  app:
    image: elevenid/self-hosted:latest
    environment:
      PUBLIC_DOMAIN: example.com
      BAO_ADDR: https://vault.example.com
      POSTGRES_PASSWORD_FILE: /run/secrets/postgres_password
      BAO_TOKEN_FILE: /run/secrets/openbao_service_token
      MARTY_API_CLIENT_SECRET_FILE: /run/secrets/marty_api_client_secret
      LICENSE_KEY_FILE: /run/secrets/license_key
      LICENSE_PUBLIC_KEY_FILE: /run/secrets/license_public_key
      MARTY_LICENSE_REQUIRED_PLAN_TIER: system
    secrets:
      - postgres_password
      - openbao_service_token
      - marty_api_client_secret
      - license_key
      - license_public_key

secrets:
  postgres_password:
    file: /opt/elevenid/secrets/postgres_password
  openbao_service_token:
    file: /opt/elevenid/secrets/openbao_service_token
  marty_api_client_secret:
    file: /opt/elevenid/secrets/marty_api_client_secret
  license_key:
    file: /opt/elevenid/secrets/license_key
  license_public_key:
    file: /opt/elevenid/secrets/license_public_key
```

This is effectively the contract used by the current ElevenID self-host reference stack.

For the current reference stack, the host-published HTTP surfaces should stay loopback-only by default. If you are fronting the deployment with Cloudflare Tunnel, a reverse proxy, or another edge, do not also expose the admin and gateway ports broadly on the host unless you have explicit firewall and TLS controls in place.

The current reference stack also keeps the runtime application token separate from vault root and unseal material. Application containers should only see the least-privilege token they need for signing or trust operations.

For the current self-host reference deployment, that vault token should come from an operator-managed external Vault or OpenBao instance. Do not rely on an in-cluster bootstrap vault persisting root or unseal material alongside the application runtime.

## Kubernetes pattern

For Kubernetes, the standard pattern is similar:

- store secret material in `Secret` resources or an external secret system
- mount or project the secret into the pod
- pass the path through `*_FILE`
- optionally support direct env injection for platforms that prefer it

Typical integrations include:

- native Kubernetes Secrets
- External Secrets Operator
- Vault Agent Injector
- CSI Secret Store drivers
- cloud secret managers such as AWS Secrets Manager, Azure Key Vault, or Google Secret Manager

The product should not require one specific secret manager. It should only require the `VAR` / `VAR_FILE` runtime contract.

## Licensing for self-hosted installs

Customers who pay for self-hosting usually expect one of two licensing models:

- `LICENSE_KEY` or `LICENSE_KEY_FILE`
- `LICENSE_PATH` pointing at a signed offline license file

If the runtime does not already bake in the issuer public key, also support `LICENSE_PUBLIC_KEY` and `LICENSE_PUBLIC_KEY_FILE` so the same license can be validated in file-backed deployments.

The offline file pattern is especially common for regulated, air-gapped, or procurement-heavy environments.

Recommended behavior:

- support `LICENSE_KEY` and `LICENSE_KEY_FILE`
- support a mounted signed license file when offline activation is required
- support `LICENSE_PUBLIC_KEY` and `LICENSE_PUBLIC_KEY_FILE` when the public key is not image-baked
- keep license material out of `.env`
- validate the license early and fail with a clear operator-facing error when the license is missing or invalid

The current ElevenID self-host reference stack validates the signed license before migrations and service startup, and defaults to requiring `plan_tier=system` for the licensed deployment.

If the installation also seeds an initial organization administrator, require that administrator identity to be explicitly customer-controlled before first startup. Do not rely on a shipped personal email default in a customer deployment.

## Secret manager integration

Docker Compose does not directly fetch secrets from secret managers. It mounts files.

That means secret managers usually integrate in one of two ways:

- they materialize secret files before `docker compose up`
- they run an agent or sidecar that writes files or exports runtime values

Common approaches:

- **1Password CLI** for simple operator-managed installs
- **Vault or OpenBao** for larger automated environments
- **Doppler** or **Infisical** for managed secret distribution
- **cloud secret managers** when the customer already standardizes on one cloud

The product contract should stay the same regardless of which backend the customer chooses.

## AI agent safety note

Local Docker Compose secrets are not hidden from AI agents if the real secret files live inside the same workspace the agent can read.

For agent-safe operation:

- keep the real secret directory outside the repo
- keep the real secret directory outside the agent-visible workspace
- keep only placeholder secret templates in the repository

Compose secrets reduce accidental Git exposure, but they do not create a separate trust boundary from tools that can already read the host files.

## Current ElevenID self-host reference deployment

The current ElevenID self-host reference deployment uses:

- a dedicated production Compose stack
- file-backed secrets mounted through Compose
- an operator-managed external Vault/OpenBao address plus a scoped runtime token delivered as a secret file
- runtime secret loaders that export the final process environment
- persistent storage for database, cache, and applicant data

This reference deployment is appropriate for same-host and small-cluster installs. Larger enterprise deployments should use the same runtime secret contract with Kubernetes-native secret delivery and license management.

The current reference deployment expects vault bootstrap and recovery to stay outside the application stack. For regulated production, keep initialization, unseal, and root material in your external vault operating model and hand the application only a least-privilege runtime token.

The reference gateway stack should also ship with a non-zero default rate limit. Treat rate limiting as enabled by default and only disable it when equivalent controls already exist at the edge.

## Next steps

- [Installation](/getting-started/installation/)
- [Authentication](/getting-started/authentication/)
- [Wallet Integration](/guides/wallet-integration/)