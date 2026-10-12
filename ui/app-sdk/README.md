# CAIPE App SDK

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

## Release

- SDK versions are independent of host image and application package versions.
- This release candidate is not a stable release; manifest and component ABI stay `2.0`.
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
