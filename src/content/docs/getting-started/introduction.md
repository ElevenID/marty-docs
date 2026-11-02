---
title: Introduction
description: Marty workflows, customer operating responsibilities, and release evidence.
---

ElevenID develops **Marty**, customer-operated identity and document-verification
infrastructure. Marty combines credential workflows, trust policy, and deployment
configuration in one product. The [Marty Identity Protocol (MIP)](/concepts/marty-protocol/)
describes its operational building blocks.

## Choose a bounded workflow

The current product direction covers three use cases with shared infrastructure.
Availability must be established for the exact component, release, format, and
deployment profile you intend to use.

| Use case | Workflow to evaluate | Scope to establish |
|----------|----------------------|--------------------|
| **Education and workforce credentials** | Issue a defined achievement, deliver it to a holder, and verify it against policy | Supported credential/profile, holder flow, trust decisions, and rejected cases |
| **Applicant and document verification** | Evaluate a named document input and its demonstrated checks | Distinguish structural checks, cryptographic authenticity, and holder binding |
| **Travel Trust** | Import trust material, record provenance, apply customer policy, and use it in verification | Synthetic or authorized sources, source rights, freshness, and customer acceptance policy |

Each workflow needs its own evidence. A successful example in one track does not
establish readiness for the others. Travel Trust does not include an
ElevenID-operated certificate authority, shared trust network, redistributed
certificate feed, or guarantee of international acceptance.

## Customer operation and release status

Your organization or selected integrator installs, monitors, backs up, and
operates its deployment. The current commercial direction is a bounded annual
software license; managed deployment, guaranteed support response, uptime SLAs,
and 24/7 operations are not included. Released scope and any commercial terms
must be explicit in the applicable order and component licenses.

Delivery work prioritizes Linux amd64 and API/CLI use. Review the current
[installer requirements and admission rules](https://github.com/ElevenID/marty-ui/blob/main/docs/installer-bootstrap.md)
before selecting a release. The
[console-free source profile](https://github.com/ElevenID/marty-ui/blob/main/docs/SELFHOST_API_ONLY.md)
has a separate qualification boundary; a source overlay does not establish a
qualified headless installer distribution.

Start with synthetic data. Independent installation, the selected credential or
document journey, operating controls, and required security/privacy review must
be evidenced before real data or production use. Published artifacts, a health
check, or a demonstration alone do not establish those outcomes.

## Standards and interoperability scope

The documentation references these standards and formats:

- **W3C Verifiable Credentials** Data Model 2.0
- **OpenID4VCI** / **OpenID4VP** — credential issuance and presentation exchange
- **ISO/IEC 18013-5** — mobile documents (mDL, mDoc)
- **SD-JWT** — Selective Disclosure JSON Web Tokens
- **Open Badges v3.0** — achievement credentials
- **DID** — Decentralized Identifiers

This list identifies technical scope, not blanket conformance, certification,
EUDI readiness, or acceptance by every wallet or institution. Confirm the exact
version/profile and reproducible interoperability evidence for your workflow.
Policy configuration can express requirements; it does not itself establish
legal or regulatory compliance.

## How to interact with ElevenID

| Interface | Best for |
|-----------|----------|
| **Marty CLI** | Developers, CI/CD pipelines, AI coding assistants |
| **REST API** | Application integrations, backend services |
| **Console UI** | Organization setup, visual management |

## Next steps

- [Install the CLI](/getting-started/installation/)
- [Authenticate](/getting-started/authentication/)
- [Run the quick start](/getting-started/quickstart/)
