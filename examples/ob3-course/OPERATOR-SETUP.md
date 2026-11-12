# Public operator login and course setup

These helpers run on Node.js 24 or later with no npm packages. They operate on
the installation's public HTTPS origin, including a loopback origin such as
https://localhost:18443. They use the ordinary operator login and public APIs.

## Configure the observed installation

Copy **onboarding-config.example.json** to **onboarding-config.json**. Confirm the
actual HTTPS origin, operator email and installed customer display name.
The example expects the installation-created **Canyon Skills Academy**
organization. Keep self-registration and organization creation disabled.

The optional expectedOrganizationId, bootstrapCredentialTemplateId and issuerDid
fields can pin values already observed through public inventory. Do not fill
them from an unrelated prior deployment. Ambiguous inventory stops provisioning.

For a private CA, first obtain and verify the CA through the owner-controlled
deployment output. Point NODE_EXTRA_CA_CERTS at that file. TLS and hostname
verification stay enabled. NODE_TLS_REJECT_UNAUTHORIZED=0 is refused.

## Obtain a normal operator session

The reviewed source has no direct public password-login API. Its ordinary flow is:

1. GET /v1/auth/login?redirect_uri=%2F.
2. Redirect to managed Keycloak with Authorization Code, PKCE S256, nonce and state.
3. Submit the returned kc-form-login username/password form, including a
   username-first/password-only sequence when presented.
4. Keycloak redirects to /v1/auth/callback with code and state.
5. The application exchanges the code and sets sessionId. The helper confirms
   /v1/auth/me identifies the configured operator before saving the session.

The application owns the token exchange. The helper never uses a password grant,
Keycloak administration API, service token or hidden browser state. Cookies stay
in an in-memory jar until the validated application session is saved. Passwords,
cookies, codes, tokens and API-key values are never printed.

Run from this directory, using the actual absolute CA and mode-0600 password paths:

~~~sh
export NODE_EXTRA_CA_CERTS=/absolute/path/installation-ca.pem
export MARTY_OPERATOR_PASSWORD_FILE=/absolute/path/operator-password.txt
node public-login.cjs login onboarding-config.json
unset MARTY_OPERATOR_PASSWORD_FILE
export MARTY_SESSION_ID_FILE="$PWD/private-operator/session-id.txt"
~~~

All redirects, forms and cookies must remain on the configured HTTPS origin and
observed realm. The helper checks callback state and refuses repeated password
submissions. It stops on MFA, consent, required actions or an unexpected page;
these are unsupported helper steps, not claims that the server cannot perform
them. The installed operator is expected to have a normal, non-temporary
password without additional enrollment requirements.

Native Compose publishes its managed realm at /realms/<realm>; the reviewed
Kubernetes route uses /auth/realms/<realm>. The helper admits only these two
authorization-route shapes and then binds every form submission to the exact
realm prefix observed in that login. The first live Compose attempt stopped at
its initial redirect because the original helper assumed the Kubernetes prefix;
no credentials were submitted. This was corrected in the helper, with the
first attempt preserved and a new login-state directory used for retry.

The private-operator/login-report.json file contains navigation paths, statuses
and bounded failure details. The session file is mode 0600 in a mode-0700
directory. A login attempt is journaled. To retry after a diagnosed failure, use
a new loginStateDirectory and matching sessionFile; retain earlier evidence.

## Inspect, then provision

~~~sh
node onboard-course.cjs inspect onboarding-config.json
node onboard-course.cjs provision onboarding-config.json
~~~

Inspection performs public reads and writes a local private-onboarding/
provisioning-plan.json. Provisioning repeats inventory before changes:

- Confirms the normal operator session and existing customer organization using
  GET /v1/organizations/mine, whose response includes the caller's membership.
  The general organization list omits membership; the original helper's use of
  that list stopped inspection before any mutations and has been corrected.
- Reads the owned bootstrap OB3 template for issuer/profile references and
  confirms active customer-owned trust and revocation profiles.
- Creates a managed ES256 VC-JWT issuer only when no matching identity exists,
  then rereads its scoped inventory. Selection matches the complete active
  DID/purpose/VC_JWT/ES256 tuple in the organization-scoped inventory; SD_JWT_VC
  identities sharing the DID and purpose are separate valid identities.
  An incompatible existing VC_JWT identity stops automatic creation.
- Creates a separate **OpenBadgeCredential** course template and activates it.
  Public create requires PascalCase or reverse-domain credential types. The
  seeded open_badge value cannot be copied into a public create request.
  OBJECT is supported for the achievement claim.
- Creates one expiring test key with exactly templates:read, credentials:issue
  and credentials:read, saving its one-time secret privately.

Creates and activation are journaled before transmission. Mutations are never
retried automatically. A rerun may reuse an exactly matching observable result.
A journal without a matching result, ambiguous matches, changed ownership, or
an existing named key without this run's retained secret stops further changes.
The helper does not revoke keys, replace issuers or alter existing profiles.

Successful provisioning writes these files inside private-onboarding:

- client-config.json: actual public origin and runtime IDs.
- course-subject.json: synthetic learner and course criteria.
- client-api-key.txt: mode-0600 one-time key secret.
- instructor-config.json: a separate, explicitly selected instructor-session
  experiment with a different completion-event ID and state directory.
- onboarding-report.json: bounded setup evidence.

Provisioning success is not a credential-issuance or machine-integration result.

## Run the client

~~~sh
export MARTY_API_KEY_FILE="$PWD/private-onboarding/client-api-key.txt"
node ob3-client.cjs run private-onboarding/client-config.json
~~~

The live ordinary API-key journey passed template lookup, issuance, learner
claim, independent signature/recipient/course checks, tamper rejection, and
issued-credential readback. Missing and invalid authentication returned 401.
No instructor-session fallback was needed. The earlier template-membership
blocker hypothesis was retracted after tracing the complete authorization path.

The service-authenticated organization GetMember operation intentionally
recognizes an api_key:<UUID> principal and loads the current key for the requested
organization. It returns an active service-principal membership view whose
permissions derive from the key's scopes, narrowed by any explicit service
membership restrictions. The view has no human roles, owner privilege, or
console access. Tenant, principal, key validity, and deployment-scope guards
remain enforced. See pinned [organization gRPC handling](https://github.com/ElevenID/marty-ui/blob/b7c7055830722d10512ccac042b1e0abe0e1ecec/rust/services/organization/src/grpc_service.rs#L64),
[tenant-bound key lookup](https://github.com/ElevenID/marty-ui/blob/b7c7055830722d10512ccac042b1e0abe0e1ecec/rust/services/organization/src/api_keys.rs#L315),
and [gateway tenant/scope checks](https://github.com/ElevenID/marty-ui/blob/b7c7055830722d10512ccac042b1e0abe0e1ecec/rust/services/gateway/src/authorization.rs#L71).

An instructor-session journey remains an explicitly selectable separate
experiment using instructor-config.json and a normal session file. It was not
run in this trial. Neither path needs a learner account; the learner retains a
separate proof key.

## Local verification and provenance

Syntax and an offline simulation of observed public login/cookie/provisioning
contracts passed. The simulation covered username-first/password-only login,
external-form refusal, cookie path restrictions, zero-mutation inspection,
journaled provisioning and repeat provisioning without new mutations. It is
not a live deployment test or proof that the installation is healthy.

Source: ElevenID/marty-ui at b7c7055830722d10512ccac042b1e0abe0e1ecec.
Reviewed authApi.js, auth HTTP/HTTP-kernel/OIDC source, Keycloak login.ftl and
login-username.ftl, credential-template/persistence.rs and the public setup
sources listed in operator-onboarding.json.
