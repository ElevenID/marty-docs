---
title: Wallet Integration
description: Select an issuance or presentation profile and qualify an exact wallet journey.
sidebar:
  order: 3
---

## Start with the installed protocol contract

Read the deployment's `/v1/protocol-support` catalog and issuer metadata. Select
an exact credential format, proof algorithm, issuance flow, and presentation
flow before choosing a wallet. A protocol name or SDK family alone does not
establish interoperability.

For issuance, the wallet receives a credential offer, discovers the issuer's
metadata, obtains an access token, supplies any required holder proof, and
requests the credential. For presentation, the verifier's policy and request
determine which credentials, claims, challenge, audience, and holder binding
are required.

## Reproduce a bounded learner claim

The [OB3 course integration](/guides/ob3-course-integration/) includes a standalone
learner client for inline pre-authorized `jwt_vc_json` offers. It uses a separately
retained P-256 learner key, published `did:web` issuer keys, and independent JWS
verification. That client does not qualify a mobile wallet or prove full standards
conformance.

For an external wallet, supply a stable hostname reachable from the wallet and
TLS certificates it accepts. A private localhost tunnel and test CA can exercise
a local client while remaining unsuitable for a public wallet.

## Record wallet-specific evidence

| Area | Evidence to retain |
| --- | --- |
| Versions | Exact Marty release, wallet release, protocol version, and securing profile |
| Issuance | Offer import, metadata discovery, token grant, nonce/proof handling, credential receipt |
| Subject binding | The issued learner identifier and actual wallet proof key agree |
| Verification | Signature, issuer trust, policy, freshness, holder binding, and status outcomes |
| Negative cases | Wrong issuer/audience/nonce, altered credential, expired/revoked credential, and replay rejection |
| Operations | Lost response, duplicate event, interrupted claim, key rotation, and lifecycle recovery |

There is no blanket tested-wallet claim on this page. Publish a named wallet
compatibility result only with reproducible evidence for the exact versions and
flow. Separate unsupported features in a test client from capabilities of the
protocol itself.

Sources: [installed protocol catalog implementation](https://github.com/ElevenID/marty-ui/blob/b7c7055830722d10512ccac042b1e0abe0e1ecec/rust/services/gateway/src/discovery.rs)
and [OID4VCI client example](https://github.com/ElevenID/marty-docs/tree/main/examples/ob3-course).
