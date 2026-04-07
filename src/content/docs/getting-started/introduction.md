---
title: Introduction
description: What is ElevenID and what problems does it solve?
---

ElevenID is infrastructure for issuing and verifying **verifiable credentials**, **Open Badges**, and **identity documents** using the [Marty Identity Protocol (MIP)](/concepts/marty-protocol/).

## What ElevenID does

ElevenID provides the operational layer for digital credentials — the trust governance, policy enforcement, and deployment configuration that sits above format and exchange standards.

| Capability | Description |
|------------|-------------|
| **Credential Verification** | Verify W3C VCs, SD-JWT, mDoc, and Open Badges against configurable trust policies |
| **Credential Issuance** | Issue credentials and badges using templates, trust profiles, and deployment profiles |
| **Trust Management** | Define trusted issuers, verifiers, and trust frameworks |
| **Compliance Automation** | Map regulatory requirements to technical policy enforcement |

## Supported standards

- **W3C Verifiable Credentials** Data Model 2.0
- **OpenID4VCI** / **OpenID4VP** — credential issuance and presentation exchange
- **ISO/IEC 18013-5** — mobile documents (mDL, mDoc)
- **SD-JWT** — Selective Disclosure JSON Web Tokens
- **Open Badges v3.0** — achievement credentials
- **DID** — Decentralized Identifiers

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
