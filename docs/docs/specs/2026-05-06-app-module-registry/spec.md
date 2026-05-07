# App Module Registry — Tier 1 plugin model for the CAIPE platform

> **Status:** DRAFT — for user review before implementation.
> **Author:** Sri Aradhyula (assisted-by Cursor claude-opus-4.7)
> **Date:** 2026-05-06
> **Type:** Platform / architecture
> **Companion of:** `docs/docs/specs/2026-05-05-agentic-sdlc-ship-loop-ui/`
> **Tracking PR:** TBD (no implementation has started)

---

## 1. Problem

CAIPE’s Next.js UI today hosts a growing set of feature areas — Chat, Skills, Knowledge Bases, Dynamic Agents, Admin, Insights, and now Ship Loop. Each one is **folder-modular** (`ui/src/components/<feature>/`, `ui/src/app/(app)/<feature>/`, `ui/src/app/api/<feature>/`) but its *integration with the platform* is hand-wired in three or four places:

- Top-nav pill in `ui/src/components/layout/AppHeader.tsx` (manual edit, with feature-specific gating logic inline).
- Per-user feature flag in the static `FEATURE_FLAGS` array in `ui/src/store/feature-flag-store.ts`.
- Server-side env booleans in `ui/src/lib/config.ts` (`Config` and `ClientConfig` interfaces).
- Documentation in `ui/env.example`.

Every new feature — even small ones — must touch all four files, plus its own folders. There is no single place that says *“this is what Ship Loop owns”* or *“these are the modules currently installed in the platform.”* This is fine for a handful of features owned by one team, but it does not scale to:

1. A platform that wants third teams or contributors to add features without coordinating through a single shared header file.
2. A future where feature areas are *eventually* extracted as npm packages (Tier 2 in the brainstorming session this spec descends from).
3. A near-term need to add overlays (e.g. the in-progress Ship Loop chat bubble), command-palette entries, and background workers (e.g. webhook ingest workers) without proliferating cross-cutting hand edits.

The Python platform side already lives one tier ahead: `ai_platform_engineering/multi_agents/agent_registry.py` discovers enabled agents from `ENABLE_*` env vars and composes them via A2A at runtime. The UI side should adopt an analogous pattern.

## 2. Goals

- Each feature area declares **everything it owns** in a single typed manifest (`AppModule`).
- The host **reads from a registry**, not from hand-edited switch-statements, when computing nav, flags, env requirements, MongoDB collections, overlays, command-palette entries, and background workers.
- Adding a new feature is **adding a module + flipping a manifest entry**, not editing `AppHeader.tsx`, `feature-flag-store.ts`, `config.ts`, and `env.example`.
- Only enabled modules are imported into the app bundle, via lazy dynamic imports keyed by env flags. Disabled modules cost zero kilobytes in the client.
- The contract is **stable enough** that a module can be lifted into an npm package in Tier 2 without rewriting it. In other words: **Tier 1 is Tier 2 living in a single repo.**
- Migration is **incremental**. Existing feature areas can adopt the registry one at a time. Nothing breaks if some areas haven’t migrated yet.

## 3. Non-goals

- **Runtime plugin install** (downloading + loading plugins without a redeploy). That is Tier 3 and is out of scope.
- **Plugin marketplace UI**. Out of scope.
- **Plugin sandboxing** (process or iframe isolation, capability restriction). All modules trust each other.
- **Federated module loading** (Webpack Module Federation, etc.). Build-time presence is sufficient for Tier 1.
- **Replacing the Python `AgentRegistry`** or changing how agents are composed. UI modules and Python agents are orthogonal axes.
- **Rewriting any feature area’s internals.** Only the integration surface (nav, flags, env, etc.) is centralized.

## 4. Direction at a glance

```text
                          ┌──────────────────────────────────────────────┐
                          │  ui/src/modules/<id>/module.ts  (per module) │
                          │   ─ exports default AppModule manifest       │
                          └──────────────────────────────────────────────┘
                                                │
                                                ▼
       ┌─────────────────────────────────────────────────────────┐
       │  ui/src/modules/_registry.ts                            │
       │   ─ thin wrapper:  for each id in MODULES_ENABLED        │
       │      → import(`./${id}/module`)                          │
       │      → cache + freeze                                    │
       └─────────────────────────────────────────────────────────┘
              │ derives                                  │ provides
              ▼                                          ▼
   ┌───────────────────────────┐         ┌─────────────────────────────────┐
   │ AppHeader: nav from       │         │ feature-flag-store: flags from  │
   │ registry.contributions    │         │ registry.featureFlags           │
   │ getServerConfig: env keys │         │ env.example: generated section  │
   │ from registry.requiredEnv │         │ overlay slot: registry.overlays │
   └───────────────────────────┘         └─────────────────────────────────┘
```

## 5. The `AppModule` contract

A single typed object per feature, lives at `ui/src/modules/<id>/module.ts`, exports `default`.

```ts
// ui/src/modules/_types.ts
export interface AppModule {
  /** Stable, kebab-case id. Becomes the URL prefix and the registry key. */
  id: string;

  /** Human-readable name shown in nav, settings panel, and audit logs. */
  displayName: string;

  /** lucide-react icon name (string, not the React component, for SSR sanity). */
  icon: string;

  /** SemVer of this module's manifest. Lets the host warn on incompatible
   *  contracts after Tier 2 extraction. Bumped when the manifest shape changes
   *  in a way modules need to know about. */
  apiVersion: "1.0";

  /** Top-nav contribution. Omit if the module has no main pill (e.g. an
   *  overlay-only module or an admin-only module that lives under /admin). */
  nav?: {
    /** Where the pill links to. Must start with `/`. */
    href: string;
    /** Order weight. Lower = further left. Conflicts resolved alphabetically. */
    order: number;
    /** Optional badge text (e.g. "Preview"). */
    badge?: "preview" | "beta" | string;
  };

  /** Server-env declaration. The host generates env.example from this and
   *  exposes a single `getModuleConfig(id)` helper. Secrets stay server-only. */
  env?: {
    /** REQUIRED: env var name → human description for env.example. */
    required?: Record<string, string>;
    /** OPTIONAL with defaults. */
    optional?: Record<string, { default: string | boolean | number; description: string }>;
    /** Names of vars whose values must NEVER reach the browser. Enforced
     *  by the host's getClientConfig() filter. */
    serverOnly?: string[];
  };

  /** Server-level kill switch. Function so it can read process.env at
   *  runtime; called once per request on the server. Defaults to `true`. */
  serverEnabled?: () => boolean;

  /** Per-user feature flag declaration. The host adds this to
   *  feature-flag-store's FEATURE_FLAGS array at registry-build time. Omit
   *  if the module is on whenever serverEnabled() is true. */
  userFlag?: {
    id: string;                  // store key, e.g. "shipLoop"
    label: string;
    description: string;
    detail: string;
    defaultValue: boolean;
    category: "ai" | "chat" | "developer";
    preferencesKey: string;      // MongoDB-side key, kept stable across renames
    docsUrl?: string;
  };

  /** MongoDB collection names this module owns. The host can audit /
   *  generate migration scripts / refuse to start if collections collide. */
  mongoCollections?: string[];

  /** Cross-module UI contributions. Each is optional. */
  contributions?: {
    /** Bottom-right (or other anchored) overlays. The host renders these
     *  in a single floating layer with deterministic z-index. */
    overlays?: Array<{
      id: string;
      load: () => Promise<{ default: React.ComponentType }>;
      placement: "bottom-right" | "bottom-left" | "top-right";
    }>;

    /** Command-palette / user-menu entries. */
    menuItems?: Array<{
      id: string;
      label: string;
      icon?: string;
      href?: string;
      action?: string;            // string id resolved by the module
    }>;

    /** Background workers / projectors / queue consumers. The host starts
     *  these in process at boot when the module is enabled. Each is
     *  responsible for its own lifecycle (graceful shutdown via AbortSignal). */
    workers?: Array<{
      id: string;
      load: () => Promise<{ default: (signal: AbortSignal) => Promise<void> }>;
    }>;
  };

  /** Optional self-test the host can run on startup or via /healthz to
   *  verify the module is configured correctly (DB indexes present, env
   *  vars resolved, etc). Returns null on success or a string explaining
   *  the failure. Does NOT throw. */
  healthcheck?: () => Promise<string | null>;
}
```

**What is NOT in the contract:**

- React components for the module's pages and API routes are still discovered through Next.js's filesystem routing (`ui/src/app/(app)/<id>/`, `ui/src/app/api/<id>/`). The contract is about *cross-cutting* registration, not about routing — Next.js already does routing.
- Direct access to host-internal modules (`@/lib/mongodb`, `@/lib/auth-config`, etc.) is not part of the contract today. Modules import them directly. Tier 2 will introduce a `@caipe/host-sdk` import surface so modules can drop the `@/` aliases — but Tier 1 leaves that as-is to keep the diff small.

## 6. The registry

```ts
// ui/src/modules/_registry.ts
//
// Tiny, dependency-free registry. Lazy dynamic imports keyed by env flags
// mean disabled modules cost zero KB on the client.
//
// MODULES_ENABLED is a comma-separated env var, e.g.
//   MODULES_ENABLED=ship-loop,dynamic-agents,knowledge-bases

import type { AppModule } from "./_types";

const ALL_MODULE_IDS = [
  "ship-loop",
  "dynamic-agents",
  "skills",
  "knowledge-bases",
  "admin",
  "insights",
] as const;

let cache: ReadonlyArray<AppModule> | null = null;

export async function getEnabledModules(): Promise<ReadonlyArray<AppModule>> {
  if (cache) return cache;
  const enabled = (process.env.MODULES_ENABLED ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const valid = ALL_MODULE_IDS.filter((id) => enabled.includes(id));
  const modules: AppModule[] = [];
  for (const id of valid) {
    const mod = await import(`./${id}/module`);
    if (mod?.default?.id !== id) {
      throw new Error(`module ${id} did not export a default AppModule with matching id`);
    }
    modules.push(mod.default);
  }
  Object.freeze(modules);
  cache = modules;
  return modules;
}
```

Two important properties of this implementation:

1. **`MODULES_ENABLED` is the single source of truth** for what is installed at boot. `SHIP_LOOP_ENABLED`, `DYNAMIC_AGENTS_ENABLED`, etc. become *internal* env vars owned by the module's `env.required` declaration, not platform-level switches.
2. **`ALL_MODULE_IDS` is the canonical roster.** TypeScript narrows `id`'s type to a union literal, so consumers like `useModuleEnabled("ship-loop")` get autocompletion and typo protection. The dynamic import itself is unchecked — the runtime guard (`mod?.default?.id !== id`) is what fails fast on a missing folder. Tier 2 swaps this list for a manifest read from `package.json` workspaces or a generated `plugins.config.ts`.

## 7. How existing host code changes

**`ui/src/components/layout/AppHeader.tsx`**

```diff
- {/* hand-rolled per-feature pills, ~50 lines each */}
+ {modules
+   .filter((m) => m.nav)
+   .sort((a, b) => a.nav!.order - b.nav!.order)
+   .map((m) => (
+     <NavPill key={m.id} module={m} />
+   ))}
```

The `NavPill` component is a thin wrapper that handles the `GuardedLink` / unsaved-changes story uniformly. Module-specific gating (the existing `useShipLoopFeature`, `canAccessDynamicAgents`, etc.) moves into each module's `serverEnabled()` + `userFlag.defaultValue` and is consumed via a single `useModuleEnabled(id)` hook.

**`ui/src/store/feature-flag-store.ts`**

The hand-maintained `FEATURE_FLAGS` array becomes generated from the registry:

```ts
export const FEATURE_FLAGS: FeatureFlag[] = [
  ...PLATFORM_FLAGS,                                     // memory, showThinking, etc.
  ...(await getEnabledModules())
    .filter((m) => m.userFlag)
    .map((m) => toFeatureFlag(m.userFlag!)),
];
```

(In practice the file becomes async-aware via a `useEnsureFlagsLoaded()` hook used by the settings panel; details in §10.)

**`ui/src/lib/config.ts`**

`getServerConfig()` and `getClientConfig()` keep their explicit allowlist for *platform-level* keys (`appName`, `caipeUrl`, `mongodbEnabled`, etc.) — because the platform itself owns those — but each module gets a `getModuleConfig(id)` that materializes its `env.required` + `env.optional` declaration into a typed object, with `env.serverOnly` filtering enforced for the client variant.

**`ui/env.example`**

A `scripts/sync-env-example.ts` walks the registry and emits a *generated* section of `env.example` between two markers. The platform-level section (`SSO_ENABLED`, `APP_NAME`, …) stays hand-written.

```text
# === Platform ===
APP_NAME=...

# === Modules (auto-generated from ui/src/modules/*/module.ts) ===
# DO NOT EDIT MANUALLY between BEGIN/END markers.
# >>> BEGIN-MODULES-ENV
MODULES_ENABLED=ship-loop,dynamic-agents

# Ship Loop (https://github.com/cnoe-io/ai-platform-engineering)
SHIP_LOOP_GITHUB_WEBHOOK_SECRET=  # required when MODULES_ENABLED includes ship-loop
SHIP_LOOP_ALLOW_NO_AUTH=false     # optional; default false
...
# <<< END-MODULES-ENV
```

The script is run by `npm run lint:env` in CI to fail the build if `env.example` drifts from the registry.

## 8. Pilot: migrating Ship Loop

Concretely, what happens to Ship Loop in PR-1 of this work:

1. New file `ui/src/modules/ship-loop/module.ts` — the manifest. ~120 lines, pure data.
2. `ui/src/components/agentic-sdlc/`, `ui/src/app/(app)/ship-loop/`, `ui/src/app/api/agentic-sdlc/`, `ui/src/lib/agentic-sdlc/`, `ui/src/types/agentic-sdlc.ts` — **unchanged.**
3. `ui/src/components/layout/AppHeader.tsx` — Ship Loop pill block deleted. Replaced by registry iteration (which initially still iterates only `ship-loop` until other modules migrate).
4. `ui/src/store/feature-flag-store.ts` — `shipLoop` and `shipLoopAssistant` entries deleted from the static array; they now come from the manifest.
5. `ui/src/lib/config.ts` — `shipLoopEnabled`, `shipLoopAssistantEnabled` removed from `Config`. Code that reads them migrates to `useModuleEnabled("ship-loop")` and `useModuleContribution("ship-loop", "assistant")`.
6. `ui/env.example` — Ship Loop block moves into the generated section.
7. The chat bubble (currently a separate WIP) is added as a `contributions.overlays` entry on the Ship Loop manifest in the *same* PR, because that's the cleanest demonstration of why the registry pays for itself: the bubble gets added with **zero edits to host files**.

Pilot success criterion: `git diff --stat` for the Ship Loop migration touches **only** the four host files plus the new module manifest, with net negative line count in the host files (we're removing more boilerplate than we're adding).

## 9. Migration path for the other systems

Done as separate PRs, in this order, each on its own branch / draft PR:

1. `ship-loop` (pilot — PR-1).
2. `dynamic-agents` (PR-2). Tricky parts: shares storage with `/chat`; deeply integrated with `useChatStore`. Will likely surface the first need for a host-SDK hook (`useChatStore.getState()` is fine for now; Tier 2 will formalize).
3. `skills` (PR-3). Largest surface; multiple sub-routes (gallery, editor, gateway, workspace, scan-history). Mostly mechanical.
4. `knowledge-bases` (PR-4). Has its own `KnowledgeSidebar` layout — manifest will need a `layout` contribution slot if we want the host to know about it. Punted for now: the sidebar stays where it is; the manifest only declares nav + flag.
5. `admin` (PR-5). Cross-cuts: admin sees data from every module. We use this as a forcing function to define a `/api/admin/modules` endpoint that lists registered modules and their healthchecks.
6. `insights` (PR-6). Already secondary nav; small migration.

Each PR is small, reversible, and ships behind a feature flag on the registry itself (`USE_MODULE_REGISTRY_FOR=ship-loop,dynamic-agents`) so we can roll back per-module if something goes wrong in production.

## 10. Open questions

These are explicit so we resolve them in review, not at code time.

1. **Async manifests vs sync.** The `getEnabledModules()` proposal is async (dynamic imports). `FEATURE_FLAGS` is currently a sync top-level export. Two reasonable resolutions:
   - **Option A (recommended):** The root server component (`ui/src/app/(app)/layout.tsx`) does `await getEnabledModules()`, extracts each module's `userFlag`, and serializes them into `window.__APP_MODULE_FLAGS__` via the same inline-script trick `getClientConfig()` already uses. The Zustand store reads `window.__APP_MODULE_FLAGS__` during `initialize()` and merges into its `FEATURE_FLAGS` array. Sync to client consumers, no Suspense, no waterfall.
   - **Option B:** Switch `FEATURE_FLAGS` to a hook (`useFeatureFlags()`) and accept the Suspense boundary.

   I lean toward A. It's invisible to consumers and matches the existing pattern for `__APP_CONFIG__`.

2. **Module → module communication.** Two modules may legitimately want to talk to each other (e.g. Ship Loop's assistant module asking Dynamic Agents for an agent definition). Tier 1 punts: modules import each other's exported types directly (`@/modules/dynamic-agents/contract`), no formal API. Tier 2 introduces a typed event bus or a host-SDK service registry. Flagging this so we don't accidentally invent something half-baked in Tier 1.

3. **Background workers in serverless deployments.** `contributions.workers` assumes long-running Node processes. Vercel-style deployments don't have those. We will need to document that workers are only honored when `process.env.RUNTIME === "node-server"` and provide an alternative path (cron-triggered route) for serverless. This is fine but worth being explicit.

4. **Versioning the manifest contract.** `apiVersion: "1.0"` is in the type. The host enforces it (registry refuses to load `apiVersion: "2.0"` modules until Tier 2). What we *don't* yet have is a deprecation policy for fields. I propose: any field can be soft-deprecated with a JSDoc `@deprecated` and a runtime warning; hard-removal requires an `apiVersion` major bump. Document in the host SDK README when Tier 2 lands.

5. **What about the Python side?** The Python `AgentRegistry` already does runtime composition by env. We should write a complementary spec next (or extend this one) that says explicitly: *“UI modules and Python agents are independent. A UI module may or may not require a specific Python agent; if it does, it declares it as `requiredAgents` in its manifest, and the host fails the healthcheck if any required agent is missing from the platform's A2A directory.”* That hook point is already on `AppModule.healthcheck()`. Flagging for follow-up.

## 11. Risks + tradeoffs

- **Indirection cost.** The `AppHeader` becomes data-driven instead of explicit JSX. Reading it requires understanding the registry — slightly higher cognitive cost for first-time readers. Mitigated by good `JSDoc` on the `AppModule` type and a one-page "how modules work" doc.
- **Lazy import + SSR interplay.** Next.js App Router with `await import()` on the server is fine, but client-side dynamic imports on a registered overlay must be wrapped in `next/dynamic` with `ssr: false` if they touch browser-only APIs. Easy to get wrong; the host helper (`<ModuleOverlays />`) absorbs this.
- **Generated env.example drift.** Solved by CI lint, but it's one more thing that can break a PR. Acceptable.
- **Per-module `serverEnabled()` hides intent.** A module can return `true` but be functionally broken (DB unreachable, etc.). We rely on `healthcheck()` to surface this — but only if operators check it. Risk is low; CAIPE already has health endpoints.
- **Tier 2 risk — host-SDK extraction.** When we eventually extract `@caipe/host-sdk`, we'll discover that "modules import `@/lib/mongodb` directly today" is fine but inconsistent. Manageable: extract the SDK alongside the first external module, audit imports then.

## 12. Success criteria

After Tier 1 lands:

- A new feature area can be added with: one new folder under `ui/src/modules/<id>/`, one new manifest file, one entry added to `ALL_MODULE_IDS`, and one line added to `MODULES_ENABLED` in the deployment env. **Zero edits** to `AppHeader.tsx`, `feature-flag-store.ts`, `config.ts`, or `env.example`.
- The Ship Loop chat bubble specifically is added as a `contributions.overlays` entry on the existing Ship Loop manifest. No new platform code.
- Disabled modules are not present in the client bundle (verifiable via `ANALYZE=true npm run build`).
- A host endpoint `/api/admin/modules` returns the full registry plus healthcheck results, so operators can audit what's installed.
- Tier 2 (npm-package extraction) becomes a *refactor* of one module into a workspace package — not a redesign of the integration model.

## 13. What this spec does NOT commit to

- A specific Tier 2 timeline. We earn it when a third party needs to ship a feature out-of-tree.
- A specific marketplace UX.
- Any change to the Python platform's `AgentRegistry`.
- Any change to existing feature behavior. The user-visible UI is unchanged after migration.

## 14. Next steps once approved

1. Open a draft PR with PR-1 (Ship Loop pilot migration) on a fresh branch.
2. Land PR-1, then resume Live GitHub Webhook wiring **as a feature inside the migrated Ship Loop module** — first proof point that the model holds up for non-trivial new work.
3. Implement the Ship Loop chat bubble as a `contributions.overlays` entry — second proof point.
4. Begin staggered migration PRs for the other systems, one at a time, no big bang.

---

*End of spec. Review notes / pushback / "no, do it differently" go below or in the PR thread when this lands.*
