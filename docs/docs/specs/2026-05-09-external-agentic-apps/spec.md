# Feature Specification: External Agentic Apps Platform

**Feature Branch**: `2026-05-09-external-agentic-apps`
**Created**: 2026-05-09
**Status**: Draft
**Input**: User description: "Create a generic Agentic Apps platform where CAIPE hosts installable external apps through manifests, PDP-backed authorization, app-scoped tokens, a generic webhook gateway, shared SDK and optional React UI kit, reference external apps for FinOps, Weather, and Agentic SDLC, and CAIPE-owned contextual assistant overlay driven by app context."

## Overview

CAIPE needs to become a generic host for independently owned agentic web apps without keeping private or domain-specific product code in the OSS host. Teams should be able to build apps such as FinOps, Weather, Agentic SDLC, or customer-specific internal tools as external apps, install them through a common manifest contract, and run them under CAIPE-controlled navigation, policy, audit, and assistant experiences.

The platform boundary is:

- CAIPE owns app discovery, install state, launch policy, PDP decisions, app-scoped tokens, request forwarding, generic webhook routing, audit events, shared SDK packages, optional shell chrome, and the contextual assistant overlay.
- Each external app owns its own UI, persistence, domain APIs, provider tokens, provider webhook secrets, background processing, and domain-specific authorization beyond the host contract.
- CAIPE OSS must not contain hardcoded private app names, private manifests, imports from private app code, or product-specific branches for private/internal apps.
- FinOps, Weather, and Agentic SDLC may remain in the repository only as external reference apps under a dedicated `agentic-apps` area. They must use the same install, authorization, webhook, and assistant contracts that any third-party app would use.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Install and launch any trusted external app (Priority: P1)

As a CAIPE administrator, I want to register and install a trusted external app from a manifest so that users can discover and launch it without CAIPE developers hardcoding app-specific pages or navigation entries.

**Why this priority**: This is the core platform promise. Without a generic install and launch path, every app continues to require bespoke CAIPE source changes.

**Independent Test**: Register a neutral external app manifest, install it for a test group, and confirm that an authorized user can find it in the Apps Hub and launch it while an unauthorized user sees a blocked reason.

**Acceptance Scenarios**:

1. **Given** an admin has a valid external app manifest and origin, **When** they import and install the app, **Then** the app appears in admin management, the Apps Hub, and user launch surfaces according to manifest and installation policy.
2. **Given** two apps request the same public route or app id, **When** an admin attempts to install the second app, **Then** CAIPE rejects the install with a route or id conflict and records an audit event.
3. **Given** an app is disabled, unhealthy, uninstalled, unsupported, or unauthorized for the current user, **When** the user opens the Apps Hub or launch URL, **Then** CAIPE blocks launch with a clear, non-leaking reason and does not contact the app runtime.

---

### User Story 2 - Authorize app requests with PDP decisions and app-scoped tokens (Priority: P1)

As a security owner, I want every external app request to be authorized by CAIPE policy and represented to the app by a short-lived app-scoped token so that apps do not receive browser cookies, root provider tokens, or unrestricted user credentials.

**Why this priority**: External apps become part of the user journey. Request authorization and token boundaries must be correct before broad app installation is safe.

**Independent Test**: Launch an installed app as users with different roles and resource access, then verify that allowed requests reach the app with an app-scoped token and denied requests stop at CAIPE with auditable PDP decision metadata.

**Acceptance Scenarios**:

1. **Given** a user launches an installed app, **When** CAIPE receives the proxied request, **Then** CAIPE strips browser cookies and client-supplied identity headers before evaluating the request.
2. **Given** PDP allows the request, **When** CAIPE forwards it to the app, **Then** the app receives a short-lived token whose audience, app id, user identity, scopes, and decision id are specific to that app and request context.
3. **Given** PDP denies the request because the user lacks app, route, method, resource, or tenant access, **When** CAIPE handles the request, **Then** no app runtime is contacted and an audit event records the denied action.
4. **Given** an app needs finer-grained domain authorization, **When** the app asks CAIPE to authorize a declared resource action, **Then** CAIPE returns an allow or deny decision that the app can enforce without sharing CAIPE session cookies.

---

### User Story 3 - Route provider webhooks to installed apps generically (Priority: P1)

As an external app owner, I want CAIPE to expose a generic webhook gateway for my installed app so that providers can send webhooks through CAIPE while my app still owns provider-specific verification and processing.

**Why this priority**: Agentic SDLC needs GitHub webhooks, and future apps may need GitHub, Slack, Jira, GitLab, or other provider callbacks. CAIPE needs one secure perimeter instead of app-specific webhook endpoints in the host.

**Independent Test**: Configure a provider webhook for an installed app, send a signed raw payload through CAIPE, and confirm that CAIPE applies app install and policy checks, forwards the exact raw body and provider headers to the app, and audits the result.

**Acceptance Scenarios**:

1. **Given** an installed app declares a webhook provider and channel, **When** a provider sends a webhook to CAIPE's generic webhook gateway, **Then** CAIPE resolves the target app and forwards the raw body to the app-owned webhook handler if policy allows.
2. **Given** the app is disabled, unknown, not installed, missing the requested webhook channel, or blocked by policy, **When** CAIPE receives a webhook for it, **Then** CAIPE rejects or drops the request according to configured safety rules and never forwards it to the app.
3. **Given** the app chooses upstream verification, **When** CAIPE forwards the webhook, **Then** CAIPE preserves the raw body bytes and relevant provider signature headers so the app can verify the provider signature itself.
4. **Given** webhook traffic exceeds configured limits, **When** requests arrive, **Then** CAIPE applies size and rate safeguards before forwarding and emits observable outcomes for accepted, denied, and failed forwards.

---

### User Story 4 - Use contextual CAIPE assistant overlay from an external app (Priority: P2)

As an external app user, I want the CAIPE assistant bubble to understand the page I am viewing in an embedded app so that I can ask contextual questions without the app importing CAIPE's chat internals.

**Why this priority**: Agentic SDLC needs contextual chat, but sharing CAIPE's chat store and components directly would couple external apps to CAIPE internals and make independent deployment fragile.

**Independent Test**: Open an embedded reference app, publish app context for a repo or work item, open the CAIPE assistant overlay, and confirm the assistant receives only the validated context for the active app and route.

**Acceptance Scenarios**:

1. **Given** an installed app has assistant support enabled, **When** CAIPE renders the embedded app shell, **Then** CAIPE renders the assistant overlay outside the app frame and keeps ownership of conversations, auth, model routing, and audit.
2. **Given** the external app publishes page context, **When** CAIPE receives the message, **Then** CAIPE validates the source app, app id, message version, and payload size before using the context.
3. **Given** a user asks the assistant about the current app page, **When** CAIPE starts or continues the chat, **Then** the assistant receives the validated app context and no app secrets, browser cookies, provider tokens, or unrelated user data.
4. **Given** an app attempts to publish malformed, oversized, cross-app, or untrusted context, **When** CAIPE receives it, **Then** CAIPE ignores it and records a diagnostic event without breaking the app frame.

---

### User Story 5 - Build external apps with a stable SDK and optional React UI kit (Priority: P2)

As an app developer, I want a small framework-neutral SDK and an optional React UI kit so that my external app can integrate with CAIPE context, assistant controls, authorization helpers, and CAIPE-looking UI without importing private CAIPE modules.

**Why this priority**: External app teams need a supported integration surface. A stable SDK prevents copy-pasted message contracts, and a UI kit gives reference apps a consistent feel without exposing the CAIPE shell or chat internals.

**Independent Test**: Build a small external app that uses the SDK to publish assistant context and uses the React UI kit for basic layout controls, then verify that it runs independently and does not import CAIPE host source aliases or stores.

**Acceptance Scenarios**:

1. **Given** an app developer installs the SDK, **When** they publish context, request assistant open/close, or read host-provided claims, **Then** they can use documented, versioned helpers without depending on CAIPE internal file paths.
2. **Given** an app developer installs the React UI kit, **When** they build app screens, **Then** they can use approved controls such as buttons, icon buttons, status badges, page headers, metric cards, empty states, tabs, toolbars, and assistant triggers.
3. **Given** an external app uses the UI kit, **When** CAIPE changes its internal chat or shell implementation, **Then** the external app remains compatible as long as the SDK and UI kit major versions are supported.
4. **Given** the UI kit is optional, **When** an app uses its own design system, **Then** it can still integrate with CAIPE through the SDK and manifest contract.

---

### User Story 6 - Provide reference external apps without polluting CAIPE OSS host logic (Priority: P2)

As a platform contributor, I want FinOps, Weather, and Agentic SDLC to live as reference external apps so that developers can copy real examples while CAIPE remains a clean generic host.

**Why this priority**: Reference apps make the framework understandable and testable, but they must not reintroduce hardcoded app-specific logic into the host.

**Independent Test**: Run the reference apps as separately owned app runtimes, install each through the same manifest and admin flow, and confirm removing or disabling a reference app does not require changing CAIPE host source code.

**Acceptance Scenarios**:

1. **Given** the repository includes reference apps, **When** a contributor searches CAIPE host code, **Then** FinOps, Weather, and Agentic SDLC are not hardcoded into navigation, hub presentation, proxy routing, access checks, or package registry logic.
2. **Given** Agentic SDLC is installed as a reference app, **When** it runs, **Then** it owns its persistence, GitHub token/config, GitHub webhook verification, repo onboarding, sync logic, live update mechanism, and domain APIs.
3. **Given** FinOps and Weather are installed as reference apps, **When** they launch, **Then** they use the same generic proxy, token, PDP, assistant, SDK, and webhook contracts available to any app.
4. **Given** a private/internal app is installed by an operator, **When** the operator configures it, **Then** no private app name, manifest, route branch, or import is added to CAIPE OSS source.

---

### User Story 7 - Operate and audit the app platform safely (Priority: P3)

As an operator, I want app install, launch, policy, token, webhook, and health outcomes to be observable and auditable so that I can support external apps without reading app-specific code.

**Why this priority**: Operations and auditability are essential for production, but the first user value can be demonstrated with install, launch, authorization, and webhook flows.

**Independent Test**: Generate success and failure events for import, install, launch, PDP denial, token issue, webhook forward, and health check, then confirm an operator can trace the reason and impacted app from CAIPE audit surfaces.

**Acceptance Scenarios**:

1. **Given** an admin changes app installation or access policy, **When** the change is saved, **Then** CAIPE records who changed what, when, and which app or package was affected.
2. **Given** a launch or webhook forward is denied, **When** an operator reviews audit output, **Then** they can see the app id, decision id, reason code, and safe request metadata without exposing secrets.
3. **Given** an app health check fails, **When** users view launch surfaces, **Then** users see a clear unavailable or degraded state while admins can inspect the operational detail.

### Edge Cases

- An app manifest is valid but its runtime origin is missing, malformed, or unreachable.
- Two installed apps try to claim the same public route, webhook channel, or app id.
- An app is installed and visible but the current user lacks the required role, group, tenant, or resource permission.
- The PDP is temporarily unavailable during app launch or webhook forwarding.
- A short-lived app token expires while a user keeps the app page open.
- An external app sends assistant context before CAIPE has finished validating the frame.
- An app sends assistant context for a different app id or from an unexpected frame.
- A provider retries a webhook delivery and the app receives a duplicate provider delivery id.
- CAIPE receives a provider webhook with a body too large to forward safely.
- A reference app is removed from the local repo but an operator has an existing installation record.
- A private app is installed through environment or admin data and must not appear in OSS code, docs examples, or test names.
- Agentic SDLC is migrated externally while users still have old bookmarks to prior in-host routes.

## Requirements *(mandatory)*

### Functional Requirements

#### Generic app registration and launch

- **FR-001**: CAIPE MUST provide a generic app manifest contract that describes app identity, display metadata, public route ownership, runtime mode, launch surfaces, access requirements, assistant capabilities, webhook channels, health checks, and catalog metadata.
- **FR-002**: CAIPE MUST allow trusted administrators or deployment automation to register app packages from validated manifest data without uploading executable frontend bundles into the CAIPE host.
- **FR-003**: CAIPE MUST persist installation state separately from package data, including installed/enabled status, visibility, runtime overrides, access overrides, health status, and audit metadata.
- **FR-004**: CAIPE MUST deny app launch by default when the app platform is disabled, the app is unknown, not installed, disabled, unsupported, route-conflicting, unhealthy by policy, or unauthorized for the current user.
- **FR-005**: CAIPE MUST render user-facing app discovery and launch surfaces from manifest, package, installation, health, and policy data instead of hardcoded app-specific source branches.
- **FR-006**: CAIPE MUST support external apps that are accessed under CAIPE-owned app routes while the app runtime remains independently deployed and owned by the app team.
- **FR-007**: CAIPE MUST support both full-page launch and embedded launch modes, with embedded mode keeping CAIPE-owned chrome and overlays outside the app frame.

#### PDP, authorization, and app-scoped tokens

- **FR-008**: CAIPE MUST act as the policy enforcement point for app launch, proxied app requests, webhook forwarding, and app-to-CAIPE authorization checks.
- **FR-009**: CAIPE MUST call a PDP, or equivalent policy decision layer, with the authenticated subject, app id, requested action, route or channel, method, tenant context, and resource context before allowing protected app actions.
- **FR-010**: CAIPE MUST strip browser cookies, client-supplied authorization headers, and client-supplied CAIPE identity headers before forwarding requests to external apps.
- **FR-011**: CAIPE MUST issue or forward only short-lived app-scoped tokens to external apps, with audience restricted to the target app and scopes limited to the allowed decision.
- **FR-012**: CAIPE MUST include a decision identifier and request correlation identifier with allowed forwarded requests so downstream app logs can be tied back to CAIPE audit decisions.
- **FR-013**: CAIPE MUST reject app requests when the PDP is unavailable unless an explicitly documented fail-open policy exists for a read-only, non-sensitive action. The default MUST be fail-closed.
- **FR-014**: External apps MUST be able to verify the CAIPE-issued app token and MUST NOT need CAIPE browser cookies or root provider tokens to identify the current user.
- **FR-015**: External apps MUST be able to request additional CAIPE authorization decisions for app-owned resources without receiving unrestricted CAIPE session credentials.

#### Generic webhook gateway

- **FR-016**: CAIPE MUST expose a generic app webhook gateway that routes provider webhook requests to installed apps based on app id, provider, and channel.
- **FR-017**: CAIPE MUST allow app manifests to declare webhook providers, channels, upstream delivery path, allowed methods, verification ownership, maximum body size, and policy action metadata.
- **FR-018**: CAIPE MUST preserve raw webhook body bytes and relevant provider signature headers when the app owns upstream provider verification.
- **FR-019**: CAIPE MUST be able to enforce host-side webhook safeguards, including app install/enabled checks, channel registration checks, body size limits, rate limits, PDP decisions, health policy, and audit logging.
- **FR-020**: CAIPE MUST forward generic webhook requests with app-scoped CAIPE identity and correlation metadata but MUST NOT require CAIPE to understand provider-specific payload semantics.
- **FR-021**: External apps MUST own provider tokens, provider webhook secrets, provider signature verification, domain event processing, persistence, and retry idempotency unless a manifest explicitly opts into CAIPE-managed provider verification.

#### Contextual assistant bridge

- **FR-022**: CAIPE MUST own the contextual assistant overlay, conversation state, session binding, model routing, chat audit, and chat safety controls for embedded external apps.
- **FR-023**: External apps MUST provide contextual assistant input through a versioned, validated app-context bridge rather than importing CAIPE chat components, stores, or internal modules.
- **FR-024**: CAIPE MUST validate app context messages by source frame, app id, schema version, payload shape, payload size, and current installation before using them in assistant prompts.
- **FR-025**: CAIPE MUST ensure assistant context contains only app-approved, non-secret, user-visible data and MUST reject context payloads that include tokens, secrets, cookies, or provider credentials.
- **FR-026**: CAIPE MUST allow manifests to declare whether assistant support is enabled, which assistant or agent capability is requested, and whether user-facing suggestions may be provided by the app.
- **FR-027**: CAIPE MUST provide user-visible controls to open, close, and clear the assistant context for the active app session.

#### SDK and optional React UI kit

- **FR-028**: CAIPE MUST provide a framework-neutral app SDK containing versioned types and helpers for manifest data, context publishing, assistant controls, claim handling, and optional authorization requests.
- **FR-029**: CAIPE MUST provide an optional React UI kit for external apps that want CAIPE-looking controls without importing CAIPE host source.
- **FR-030**: The React UI kit MUST include at minimum buttons, icon buttons, status badges, page headers, metric cards, empty states, tabs, toolbars, and assistant trigger controls.
- **FR-031**: The SDK and UI kit MUST maintain semantic versioning and a documented compatibility policy so external apps can upgrade intentionally.
- **FR-032**: The SDK and UI kit MUST NOT expose CAIPE's private chat store, app shell internals, session cookies, root provider tokens, or host-only source aliases.

#### Reference external apps

- **FR-033**: CAIPE MUST provide FinOps and Weather as reference external apps in a dedicated reference apps area, using the same manifest, install, launch, token, PDP, assistant, and health contracts as any third-party app.
- **FR-034**: CAIPE MUST provide Agentic SDLC as an optional installable external reference app rather than a required CAIPE built-in.
- **FR-035**: The Agentic SDLC reference app MUST own its own persistence, GitHub token/config, GitHub webhook verification, repo onboarding, sync/backfill, live updates, and domain APIs.
- **FR-036**: CAIPE MUST remove or avoid host-side hardcoded references to private/internal apps and MUST keep FinOps, Weather, and Agentic SDLC references confined to their own reference app directories or neutral documentation examples.
- **FR-037**: CAIPE MUST include documentation showing how to run, install, authorize, test, and remove each reference app without changing CAIPE host code.

#### OSS cleanliness, migration, and compatibility

- **FR-038**: CAIPE MUST provide a migration path for existing Agentic SDLC bookmarks and users so externalization does not break the public user journey.
- **FR-039**: CAIPE MUST keep private app manifests and private app source outside the OSS host. Operators may configure private apps through deployment values, admin APIs, or external package records.
- **FR-040**: CAIPE MUST reject manifests that contain secret-like fields in public package data and MUST document where app teams should store private provider credentials.
- **FR-041**: CAIPE MUST log app lifecycle, launch, token, PDP, webhook, assistant-context, and denied-action events with safe metadata suitable for audit.
- **FR-042**: CAIPE MUST expose health and blocked-reason states in user-facing surfaces without leaking private configuration, tokens, provider payloads, or inaccessible resource names.

### Assumptions

- CAIPE remains the host and security boundary for user sessions, install policy, request enforcement, audit, and assistant overlay.
- External apps are trusted by the deploying organization but independently owned and deployed.
- Agentic SDLC, FinOps, and Weather are acceptable as OSS reference apps when they live outside the CAIPE host app and exercise the generic contracts.
- Private/internal apps are installed by operators through manifests and runtime configuration that are not committed to CAIPE OSS.
- The PDP may initially be implemented by CAIPE policy services or adapters, but the product requirement is a policy decision boundary, not a specific policy engine.
- Provider-specific webhook verification remains app-owned by default because apps own provider tokens and secrets.
- App-scoped tokens are short-lived and revocable by policy changes, installation disablement, or user session invalidation.

### Out of Scope

- Public marketplace submission, moderation, and app review workflows for untrusted end users.
- Uploading arbitrary executable app bundles into CAIPE for runtime execution.
- Sharing CAIPE's private chat store, internal React component tree, or root shell as a public package.
- Moving every existing CAIPE feature into an external app in the first implementation.
- CAIPE storing private GitHub, Slack, Jira, or cloud provider tokens for externally owned apps by default.
- Hard budget enforcement, billing, or marketplace monetization for installed apps.

### Key Entities *(include if feature involves data)*

- **Agentic App Manifest**: The app's public contract: identity, routes, runtime mode, access needs, assistant support, webhook channels, health checks, and catalog metadata.
- **App Package**: A trusted, validated manifest plus catalog and provenance metadata that can be installed by an administrator.
- **App Installation**: Environment-specific state that says whether a package is installed, enabled, visible, healthy, and accessible to particular users or groups.
- **App Runtime**: The independently deployed app service that owns domain UI, data, persistence, provider credentials, and provider-specific processing.
- **PDP Decision**: A policy outcome for launch, request forwarding, webhook forwarding, or app-owned resource authorization.
- **App-Scoped Token**: A short-lived token issued for one app and decision context, carrying only the user and scopes CAIPE allows.
- **Webhook Channel**: A provider/channel binding declared by an app and routed by CAIPE's generic webhook gateway to the app runtime.
- **Assistant Context Message**: A validated, versioned payload from an embedded app that describes the user's current app page or selection for CAIPE-owned contextual chat.
- **Reference App**: A sample external app kept under the reference apps area to demonstrate the generic framework without being hardcoded into the CAIPE host.
- **Audit Event**: A safe record of app lifecycle, authorization, token, webhook, launch, assistant context, or denial activity.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A new neutral external app can be registered, installed, discovered, launched, disabled, and removed without editing CAIPE host navigation, routing, or app-specific source files.
- **SC-002**: 100% of external app launch and proxied request attempts are evaluated by CAIPE policy before the app runtime is contacted.
- **SC-003**: 100% of forwarded external app requests strip browser cookies and client-supplied identity headers before forwarding.
- **SC-004**: 100% of allowed forwarded external app requests include a correlation id and app-specific authorization context that an app can verify independently.
- **SC-005**: A denied app launch, denied proxied request, and denied webhook forward each produce a user-appropriate reason and an operator-auditable decision record.
- **SC-006**: A generic provider webhook can be routed to an installed reference app with raw body and signature headers preserved, while an unregistered webhook channel is denied before reaching any app.
- **SC-007**: An embedded reference app can update CAIPE assistant context and receive contextual assistant behavior without importing CAIPE chat internals.
- **SC-008**: FinOps, Weather, and Agentic SDLC can be run as external reference apps and installed through the same app package flow used by neutral third-party apps.
- **SC-009**: A source search of CAIPE host code finds no hardcoded private/internal app references and no FinOps, Weather, or Agentic SDLC logic outside generic host code, neutral documentation, or their own reference app directories.
- **SC-010**: External app developers can build a basic integrated app using the documented SDK and optional React UI kit in under one business day without reading CAIPE host internals.
- **SC-011**: Operators can trace app import, install, launch, token issue, PDP denial, webhook forward, health failure, and assistant context rejection events by app id and correlation id.
