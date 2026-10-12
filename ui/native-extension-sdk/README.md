# CAIPE native extension SDK

Version `2.0.0` aligns native component contract `2.0` with the shared
`AgenticAppManifest` API version `2.0`. Native `1.1` is explicitly retained
for compatibility; a legacy module is never silently relabeled as `2.0`.
The checker is intentionally
dependency-free at runtime; the type declarations use the host's React and
Next.js peer dependencies.

Publisher CI can install a pinned SDK tarball from a supported CAIPE release
and run `caipe-native-check ./native-package` after compiling the app. Run the
same check against each host release the package claims to support. The CLI
checks manifest ownership syntax, client-only exports, shared peer runtimes,
client-component entry declarations, CSS document selectors, and bundle budgets. The CAIPE
host also checks cross-package route/API/slot collisions and lockfile integrity
when building the final image.

`caipe-app-check ./manifest.json` validates the shared declaration for native,
hosted, UI-only, and service-only apps. Types and pure validation functions are
available from `@caipe/native-extension-sdk/manifest-contract`. Capability and
permission requests are declarations, not registration or grants. Runtime
origins and selected UI profiles belong to deployment-owned installations.

New native packages publish the full shared manifest and do not repeat their
policy in the runtime catalog. The generator derives a UI descriptor retaining
the native profile's declared component ABI. See `docs/docs/features/agentic-app-manifest.md`
and `ui/examples/agentic-apps/shared/manifest.json` for the reference contract.

An optional `assistant` claim (`agentId`, `label`, `name`) lets the host render
its own floating chat for a config-driven agent. The host fetches the agent
through its RBAC-protected API and sends bounded route context with turns. The
app must seed the agent and its MCP server separately; the native package does
not receive credentials or create agents at runtime.

The `2.0` release retains the existing component props and trust model; the
aligned numbering is not a new rendering engine, sandbox, or permission grant.
New packages must declare `2.0` in both their native profile and module export.
The host rejects mismatches and unknown versions before mounting a component.
The browser-safe `./contract-version` export exposes the supported versions.
A breaking interface change requires a new contract version and a matching
SDK major version. App package versions remain independently versioned.
