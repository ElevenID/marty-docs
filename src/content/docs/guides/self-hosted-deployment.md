---
title: Self-Hosted Deployment
description: Marty installer status, customer operating responsibilities, and self-hosted design reference.
sidebar:
  order: 2
---

## Start with the release-specific installer guidance

Marty deployments are customer-operated. Your organization or selected
integrator owns installation, monitoring, backup, recovery, and production
operation. The current commercial direction excludes managed hosting,
guaranteed support response, an uptime SLA, or 24/7 operations.

Use the active service-plane documentation for an actual installation:

- [Installer bootstrap, requirements, and admission](https://github.com/ElevenID/marty-ui/blob/main/docs/installer-bootstrap.md)
- [Exact-release disposable qualification](https://github.com/ElevenID/marty-ui/blob/main/docs/selfhost-disposable-qualification-runbook.md)
- [Console-free source composition and its qualification boundary](https://github.com/ElevenID/marty-ui/blob/main/docs/SELFHOST_API_ONLY.md)

As of the 2026-10-28 reconciliation, the bootstrap targets Linux amd64 with a
local Docker Engine and Compose. Rootless Docker, user namespace remapping,
remote Docker contexts, macOS, Windows, and other architectures are not supported
by that bootstrap. A Kubernetes design example does not establish a supported
Kubernetes distribution. The API-only source overlay is not yet a qualified
published headless installer package.

Normal release selection requires signed admission. Candidate-test mode remains
explicitly unqualified. The current operator keeps `installation_ready: false`
until its trust-onboarding and installed-journey gate is complete, even when
read-only validation checks pass. Keep evaluation synthetic until the selected
workflow, customer operating controls, and required security/privacy approvals
are evidenced. See the linked guides for the current release's status.

## Reference design patterns

The remaining sections preserve earlier deployment-design guidance. They are
not a current platform support matrix or a substitute for the exact release's
manifests and runbook. Verify variable names, secret delivery, licensing,
storage, and KMS behavior against that release before using a pattern. New
hardening designs require implementation and qualification before they become
supported behavior.

The reference design explores these goals:

- Non-secret configuration stays in environment variables or config files.
- Secret inputs have explicit delivery and validation contracts for each component.
- Licensed deployments should keep license material out of `.env` and treat it like any other secret.
- The product should integrate with the secret manager your environment already uses instead of forcing a single vendor-specific backend.

## Packaging design goals

The earlier packaging design proposed:

- The vendor ships one or more container images.
- The vendor provides a reference `compose.yaml`, Helm chart, or Kubernetes manifests.
- `.env` is used for non-secret settings such as hostnames, ports, feature flags, and organization identifiers.
- Secrets are injected from files, platform secrets, or external secret managers.
- Licensing works offline or semi-offline through a key or signed license file.

These are design goals to reconcile with the selected release, not commitments
that every packaging format or offline licensing path is available.

## Earlier secret-input proposal

The earlier proposal used two input forms. Verify which are implemented and
appropriate for each secret in the selected release:

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

The intended interface allowed file-backed values from different secret-delivery
systems. Each runtime adapter still needs its own implementation and tests.

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

Illustrative design example only. The image, paths, and tier label below are not
a verified current release selection or approved commercial offer:

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

Compare this pattern with the exact release's Compose files and secret contract;
do not use it as an installer manifest.

In this reference design, host-published HTTP surfaces stay loopback-only by
default. If you are fronting a deployment with Cloudflare Tunnel, a reverse
proxy, or another edge, do not also expose the admin and gateway ports broadly
on the host unless you have explicit firewall and TLS controls in place.

The security goal is to keep runtime application tokens separate from vault root
and unseal material. Application containers should only receive the scoped
authority they need for signing or trust operations. Verify custody and recovery
in the selected deployment rather than inferring them from this example.

The earlier design assumed an operator-managed external Vault or OpenBao
instance. Current installer provisioning has its own OpenBao lifecycle; follow
the release's documented bootstrap, key-custody, and recovery model. An external
KMS option and a proposed bootstrap-root retirement design each need their own
implementation and acceptance evidence.

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

The earlier reference configuration used a signed-license startup check and
`plan_tier=system`. Verify the current runtime mapping and failure behavior for
the selected release. That label does not define a current product tier, price,
commercial entitlement, or production authorization.

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

## Earlier external-KMS reference design

The earlier reference design described:

- a dedicated production Compose stack
- file-backed secrets mounted through Compose
- an operator-managed external Vault/OpenBao address plus a scoped runtime token delivered as a secret file
- runtime secret loaders that export the final process environment
- persistent storage for database, cache, and applicant data

This list does not qualify same-host, small-cluster, or Kubernetes operation.
Use the release-specific platform matrix and independently exercise the selected
installation, workload, restart, backup/restore, and cleanup behavior.

This external-KMS design keeps vault bootstrap and recovery outside the
application stack. Its assumptions must not silently replace the current
installer's provisioning contract. Record the actual customer custody and
recovery responsibilities for the chosen deployment before production use.

Verify rate limiting in the selected gateway and edge configuration. A reference
design recommendation does not prove that limits are enabled in an installed
release.

## Next steps

- [Installation](/getting-started/installation/)
- [Authentication](/getting-started/authentication/)
- [Wallet Integration](/guides/wallet-integration/)
