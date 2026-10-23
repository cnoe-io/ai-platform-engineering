# CAIPE App SDK

The **CAIPE App Contract** covers the shared application manifest and the
rendering-profile interfaces. The SDK supplies its types and conformance checks;
neither the contract nor its version checks provide a security sandbox.

Package `@caipe-io/app-sdk@2.0.0-rc.1` supports native component contract `2.0` and the shared
`AgenticAppManifest` API version `2.0`. Native `1.1` is explicitly retained
for compatibility; a legacy module is never silently relabeled as `2.0`.
The checker is intentionally
dependency-free at runtime and does not install or constrain a consumer's frameworks.
Native component types require the compatible host-provided React and Next.js
dependencies. The native application package, not this validation SDK, declares
the host framework peers checked by `caipe-native-check` and the final host build.
The current reference host uses Next.js `16.3.8` and React `19.2.8`; publishers
must run integration checks against each supported host release.

## Install and validate

After registry publication:

```bash
npm install --save-dev --save-exact @caipe-io/app-sdk@2.0.0-rc.1
npx caipe-app-check ./manifest.json
npx caipe-native-check ./unpacked-app-package
```

Framework-neutral consumers import types and validators from
`@caipe-io/app-sdk/manifest-contract`. Native component publishers import the
host interface types from `@caipe-io/app-sdk`.

## Native chat feedback

- Optional `chat.Panel.feedbackPrompt` supplies app-owned `message`, `actionLabel`, and optional `trailingText`. An empty message renders the link and trailing text alone.
- The host opens its existing feedback form and respects `reportProblemEnabled`. Without a prompt or when reporting is disabled, it renders the standard disclaimer.
- Optional `showAuditNotice` defaults to true. Setting it false hides the footer sentence without changing audit logging.
- **Include your chat** starts unchecked. Opting in displays an editable snapshot of the latest question and response, plus its chat reference. Each message is limited to 6,000 characters with a truncation marker; partial responses are labeled.
- Tool payloads and attachments are excluded. Unchecking omits the excerpt from the submission. Closing the form or switching conversations resets consent.
- These optional presentation properties preserve App Contract 2.0. Older hosts retain their previous footer.

## Release

- SDK versions are independent of host image and application package versions.
- This release candidate is not a stable release; the CAIPE App Contract's manifest and native component versions stay `2.0`.
- `publishConfig` defaults to public npm access and the `next` dist-tag.
- Maintainers must have publishing access to the npm `@caipe-io` scope.
- Check the packed artifact with `node --test ui/scripts/__tests__/app-sdk-package.test.mjs`
  from the repository root before publication.
- From `ui/app-sdk`, run `npm pack --dry-run`, then `npm publish --access public --tag next`.
- An authorized maintainer can bootstrap publication with `npm login`. Never commit tokens.
- For subsequent releases, configure npm trusted publishing with GitHub OIDC,
  a protected release environment, and provenance. Do not publish on PR events.
- Run native artifact and final host integration checks; schema validation alone
  is not a security certification or a runtime integration test.

Publishing the SDK does not enable runtime loading of native apps. Approved native
packages are still compiled into the CAIPE host image. Hosted apps can deploy
independently. Permission declarations do not grant access or provision agents.

Publisher CI can install a pinned SDK version or tarball from a supported CAIPE release
and run `caipe-native-check ./native-package` after compiling the app. Run the
same check against each host release the package claims to support. The CLI
checks manifest ownership syntax, client-only exports, shared peer runtimes,
client-component entry declarations, CSS document selectors, and bundle budgets. The CAIPE
host also checks cross-package route/API/slot collisions and lockfile integrity
when building the final image.

`caipe-app-check ./manifest.json` validates the shared declaration for native,
hosted, UI-only, and service-only apps. Types and pure validation functions are
available from `@caipe-io/app-sdk/manifest-contract`. Capability and
permission requests are declarations, not registration or grants. Runtime
origins and selected UI profiles belong to deployment-owned installations.

New native packages publish the full shared manifest and do not repeat their
policy in the runtime catalog. The generator derives a UI descriptor retaining
the native profile's declared component contract. See `docs/docs/features/agentic-app-manifest.md`
and `ui/examples/agentic-apps/shared/manifest.json` for the reference contract.
Both the publisher CLI and host generator read the `./manifest` export;
the JSON may be at the package root or in a compiled directory such as `dist/`.

An optional `assistant` claim (`agentId`, `label`, `name`) lets the host render
its own floating chat for a config-driven agent. The host fetches the agent
through its RBAC-protected API and sends bounded route context with turns. The
app must register its agent separately; Dynamic Agents assistants also configure
their tools separately. The native package does not receive credentials or create
agents at runtime.

An installed app may declare `ui.assistant.streamPath` as a safe `/api/`
path on its private runtime. Browser chat, the app assistant overlay and
linked-user bot conversations use the same host chat routes and conversation ID.
The host resolves the saved agent against installed app declarations; client
metadata cannot choose a backend origin or substitute an agent.

| Assistant declaration | Host operation | App response |
|---|---|---|
| `streamPath` | `/api/v1/chat/stream/start` | AG-UI SSE |
| `resumePath` (optional) | `/api/v1/chat/stream/resume` | AG-UI SSE |
| `cancelPath` (optional) | `/api/v1/chat/stream/cancel` | JSON with `cancelled: boolean` |

Use the host's default `agui` chat protocol for app streams. Each path must have an
allowed POST policy; resume/cancel declarations require `streamPath`. The host
forwards the existing operation body unchanged, including the authorized
conversation ID and untrusted client context. Apps implement their own runtime,
session mapping, deadlines, source access and optional verification controls.
Keep runtime origins and private services server-side.

Agent-use and conversation-write checks run first. The same resolved user then
passes through the app gateway's launch and HTTP policy checks and configured
token mode. Service accounts cannot substitute for an interactive user.
Declaring a stream grants no access. A conflicting/unavailable app configuration,
a denial, or an upstream failure does not invoke a different agent runtime.

A missing resume/cancel capability returns `501`; it never resumes or cancels a
Dynamic Agents run. Without an app stream claim, existing Dynamic Agents behavior
continues. Start/resume permit up to 16 minutes at the host boundary; applications
must enforce their own bounded deadline, emit SSE heartbeats and honor aborts.
The host preserves AG-UI events and cancellation acknowledgements. It does not
implement SDK-specific sessions, automatic retries or durable stream replay.

The `2.0` release retains the existing component props and trust model; the
aligned numbering is not a new rendering engine, sandbox, or permission grant.
New packages must declare `2.0` in both their native profile and module export.
The host rejects mismatches and unknown versions before mounting a component.
The browser-safe `./contract-version` export exposes the supported versions.
A breaking interface change requires a new contract version and a matching
SDK major version. App package versions remain independently versioned.

### Installed assistant identity

A deployment may bind `installations[].bindings.resources.assistant` to its
registered agent ID. This replaces the manifest assistant's logical `agentId`
for discovery and stream routing. It does not change stream paths, authorization
policies, or the pinned publisher artifact. The app must declare `ui.assistant`.

Native packages that render their own assistant UI declare
`ui.assistant.overlay: "app"`. The host skips its default launcher while retaining
assistant discovery and stream routing. Omitting this field retains the host UI.

### Host-owned native chat sessions

Declare required `host.chat@1.0` and render `props.chat.Panel` with the saved
conversation ID and deployment-bound agent ID. The host owns the request, shared
chat store, persistence, stop action and green live-response bar. Removing the
native screen does not abort its turn. Native packages should not render their
bundled chat consumer alongside this panel.

Hosts may also expose `props.chat.ConversationActions`. Feature-detect this
optional component in each history row and pass that row's conversation/agent IDs
and `onArchived` (refresh history; select or create another chat only when the
archived chat was active). It reuses GRID's share control and recoverable archive
API without adding an archive browser. Only owners see share/archive actions;
all mutations still use host conversation authorization.
Apps must not add a second sharing or archive implementation.

Apps may supply a composer header and bounded per-question `requestOptions`; these
are forwarded as `forwarded_props` and must be validated by the app. Agent binding
and authorization remain server-owned.

For another tab to observe an active response, declare `ui.assistant.statusPath`.
It is an authenticated POST accepting `conversation_id` and `agent_id`, returning
`{running: boolean, turnId?: string}`. Return only the caller's current turn; never
include SDK IDs, credentials or retained model context. Status uses the same app
gateway and conversation-write/agent-use authorization boundary as start.

The host polls active status and authorized saved messages, with a bounded watch
and a short final-save grace period. It never resubmits the question. Apps that
omit status keep their existing behavior. This capability does not promise durable
SSE replay after the browser owning the request closes.

### Assistant routing snapshot

Startup validates the deployment catalog and records its assistant bindings. Routing
uses that last successfully validated snapshot for the same catalog path. A failed
catalog read does not send app-owned chats to Dynamic Agents or block unclaimed
agents. App proxy calls still validate the live catalog and fail closed when it
is unavailable. Successful `loadConfiguredAgenticApps()` calls explicitly refresh
the snapshot; a UI restart revalidates it before serving traffic.

## App identity in agent catalogs

- `catalog.icon` names a same-origin asset: `/app-icons/<app-id>/<filename>`.
  Supported extensions: `svg`, `png`, `webp`, `jpg`, `jpeg`. URLs, query strings,
  encoded paths and traversal are rejected. Legacy symbolic icon names remain valid
  and use the generic app icon.
- Native publishers include the asset at `public/app-icons/<app-id>/<filename>`
  in the pinned npm package. The host copies the declared file during generation;
  missing files, symlinks outside the package and images over 256 KiB fail the build.
  Hosted installations may provision the same public asset namespace on the host.
  Logos are public, reviewed assets; never put private content in this directory.
- Authorized agent responses include read-only `presentation: { app: { id, name,
  icon? }, available }`. The BFF derives it from the resolved
  `bindings.resources.assistant` identity. Stored or submitted presentation fields
  are ignored. Runtime origins and stream paths are not exposed in this projection.
- App agents use their packaged app logo with an `App: Example App` tooltip.
  Missing, invalid, or broken logos fall back to a filled app tile with a large
  cutout spark. The hub heading and generic app fallbacks use this same mark.
  Catalog cards also display packaged app branding. The Apps sidebar destination
  retains the nine-dot launcher; legacy `layout-grid` navigation keeps its grid icon.
  The app's internal SDK is not inferred from an absent `execution_harness_id`.
  Legacy platform agents keep their existing Deep Agents fallback.
- Agent CAS permissions still apply. App role/launch policy further restricts the
  chat catalog; an app stream also requires an interactive user. Disabled or
  uninstalled apps are excluded from new-chat choices, while authorized details
  retain app identity with `available: false`. Duplicate assistant claims fail
  closed. Presentation never selects a runtime or grants access.

## Native conversation controls

- `chat.ConversationActions` is optional. Feature-detect it before rendering history actions.
- Pass `conversationId`, `agentId`, `onArchived`, and optional `disabled`. The host renders Share and Archive for owners using its existing dialogs and store.
- The host checks app launch access, agent availability and conversation binding before restoring the panel or its actions. Server authorization still applies to every mutation.
- Closing a native view restores the previous selection while the host retains the stream. Native packages do not own another chat store.
- Hosts without `ConversationActions` continue to support `chat.Panel`; older native packages need no changes.

## Iframe navigation, host routes and the shared assistant

All supported renderers use the same installation access policy and public app
catalog. `ui.navigation` contributes one entry after Chat in expanded and collapsed
navigation. The entry is omitted for disabled, hidden, uninstalled or unauthorized
apps. Optional installation `navigation_overrides` supports `visible`, `label` and
numeric `order`; it cannot change the target into another app's route.

### Host route takeover

A publisher declares `ui.routes`; an operator must explicitly approve iframe host
claims on the installation:

```yaml
# Installation of a publisher manifest declaring /projects.
- app_id: example-app
  installed: true
  enabled: true
  selected_ui_profile: hosted
  host_route_claims: [/projects]
  navigation_overrides:
    label: Example Projects
    order: 20
  bindings:
    runtimeOrigin: http://example-app.example.svc:3000
```

- `/projects` and nested paths render the iframe inside the host shell. The address
  bar stays at the public route, including query parameters and fragments.
- The iframe still loads through `/apps/example-app/projects/...`; its private
  runtime origin is never sent to the browser. Build assets and API URLs for that
  gateway mount. Same-origin iframe hosting is a trust boundary, not JavaScript
  isolation from the host.
- `/apps/example-app` redirects to the approved public entry; nested aliases retain
  owned deep links. With no approved host routes, the normal `/apps` entry remains.
- Native packages retain their compiled route contract. Switching to an iframe
  profile uses the same public routes when those routes are approved.
- Conflicting active owners fail closed with a configuration error. Reserved host,
  authentication and API routes cannot be claimed by an iframe.
- Disabling/uninstalling the installation or removing its claims restores normal
  host routing. Refresh an open page after an operator changes its UI profile.
- App admission is enforced at the host route and gateway. An alias or route claim
  never grants access to an app or its downstream resources.

### One assistant owner

`ui.assistant.overlay` defaults to `host`. Set it to `app` only when the app owns
its launcher and popup. Both renderers honor this; app ownership does not remove
the assistant's registration, agent-use policy or stream binding.

For one consistent experience, select `host` and use the host capability:

```ts
// Native package. Optional capabilities must be checked before use.
props.chat?.assistant?.open({ route: props.pathname, title: "Selected project" });
```

```ts
// Iframe: import the standalone client, not host stores or UI source.
import { createAgenticAppBridge } from "@caipe-io/app-sdk/iframe-bridge";
const bridge = createAgenticAppBridge({
  appId: "example-app",
  onStatus: status => showBridgeStatus(status),
  onNavigate: href => synchronizeAppRouter(href),
});
// Enable Ask only after onStatus("ready") and handle unavailable capabilities.
bridge.openAssistant({ route: "/projects/example", title: "Selected project" });
bridge.navigate("/projects/example?view=wiki#overview");
// On unmount:
bridge.dispose();
```

The host validates exact iframe source, same origin, app ID, bridge version and
owned navigation paths. Context uses the existing size/secret filters and is
forwarded as untrusted user-visible data, never instructions or an access grant.
The host advertises bridge `1.0` capabilities; version mismatch, unavailable
assistant and unsupported composer extensions produce explicit errors. This uses
the existing context/open protocol and does not implement the broader bridge
lifecycle proposal in #2948.

Native and iframe host assistants share popup sizing, branding, chat history,
rename/share/archive controls and conversation binding. Deep links to owned chats
can still use the main Chat page. The shared popup also restores an authorized
`?assistant_chat=<conversation-id>` deep link; an invalid link never creates a
replacement conversation. History selection validates the installation,
agent and conversation again before loading it. Account changes remount assistant
state; authorization is enforced again on every API operation.

Host-owned popups currently support validated page context and suggested prompts.
App-specific source pickers and other composer controls remain available through
native `chat.Panel` composition (`composerHeader`/`requestOptions`); they are not
negotiated into the host popup. Iframe requests for these extensions are rejected
explicitly. An app requiring its own controls can retain `overlay: "app"`.
