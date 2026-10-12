# CAIPE native extension SDK

Version `1.2.0` checks native component contract `1.1` packages and the shared
`AgenticAppManifest` API version `2.0`. Legacy native descriptors remain supported.
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
policy in the runtime catalog. The generator derives the legacy UI descriptor
for the unchanged component ABI. See `docs/docs/features/agentic-app-manifest.md`
and `ui/examples/agentic-apps/shared/manifest.json` for the reference contract.

An optional `assistant` claim (`agentId`, `label`, `name`) lets the host render
its own floating chat for a config-driven agent. The host fetches the agent
through its RBAC-protected API and sends bounded route context with turns. The
app must seed the agent and its MCP server separately; the native package does
not receive credentials or create agents at runtime.

Contract additions keep the `1.1` interface compatible; a breaking interface
change requires a new contract version and a matching SDK major version.
