---
title: Marty Identity Protocol
description: Overview of the Marty Identity Protocol (MIP) — the operational layer for digital credentials.
sidebar:
  order: 3
---

The **Marty Identity Protocol (MIP)** is an open specification that defines the core building blocks for managing digital credentials across their full lifecycle.

## The problem MIP solves

Existing standards define credential *formats* (W3C VC, SD-JWT, mDoc) and *exchange protocols* (OID4VCI, OID4VP). But they don't answer:

- Who decides which issuers are trusted?
- What policies govern what can be disclosed?
- How do you configure a deployment for a specific regulation?
- How do you orchestrate multi-step identity workflows?

MIP defines the **operational layer** that sits above these format and exchange standards.

## Protocol primitives

| Primitive | Purpose |
|-----------|---------|
| **Trust Profile** | Defines who is trusted, under what rules, and for which credential types |
| **Credential Template** | Specifies the schema, format, and claims for issued credentials |
| **Presentation Policy** | Declares what must be disclosed and what can be withheld during verification |
| **Deployment Profile** | Configures how credential infrastructure is deployed in a specific environment |
| **Flow** | Orchestrates multi-step credential issuance, presentation, and verification |
| **Compliance Profile** | Bridges regulatory requirements to technical policy enforcement |

## Design principles

- **Format agnostic** — works with VC, SD-JWT, mDoc, and Open Badges
- **Separation of concerns** — policy is separate from implementation
- **Composable** — primitives combine to support any identity workflow
- **Open** — Apache 2.0 licensed

## Learn more

- [Full Specification](https://elevenidllc.com/protocol)
- [Introducing MIP](https://elevenidllc.com/blog/introducing-mip) (blog)
- [MIP JSON Schemas Walkthrough](https://elevenidllc.com/blog/mip-json-schemas-walkthrough) (blog)
