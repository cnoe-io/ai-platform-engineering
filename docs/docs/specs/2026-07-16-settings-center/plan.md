# Settings Center implementation plan

**Branch:** `prebuild/feat/settings-center`

**Base target:** `prebuild/feat/per-surface-default-agents` (rebased before push)

**Date:** 2026-07-16

## Goal

Replace the overlapping profile modal, appearance drawer, and mixed admin settings cards with one routed Settings Center.

```text
Avatar menu ───────────────┐
Appearance shortcut ──────┼──> /settings/<section>
Admin platform settings ──┘
```

- Give every setting one canonical home.
- Keep personal and platform scope visibly separate.
- Make sections linkable, refresh-safe, keyboard accessible, and responsive.
- Auto-save reversible, single-setting changes without losing or reordering writes.
- Keep explicit confirmation for consequential platform changes.

## Information architecture

```text
Settings
├── Personal
│   ├── Appearance
│   ├── Chat & agents
│   ├── Notifications
│   ├── Account & access
│   └── Developer
└── Platform                       admin only
    ├── Defaults
    ├── Access before sign-in
    ├── Announcements
    └── AI review
```

### Personal

| Route | Content | Save behavior |
|---|---|---|
| `/settings/appearance` | Theme, gradient, font family, font size, preview | Auto-save |
| `/settings/chat` | Web, Slack, and Webex default agents; memory; activity details; auto-scroll; timestamps | Auto-save per setting |
| `/settings/notifications` | Release-note notification preference and preview | Auto-save |
| `/settings/access` | Platform role, realm roles, teams | Read-only |
| `/settings/developer` | Debug mode, OIDC/session information, diagnostics | Auto-save reversible preferences; sensitive values remain concealed by default |

### Platform

| Route | Content | Save behavior |
|---|---|---|
| `/settings/platform/defaults` | Platform default agent | Select, confirm consequence, persist |
| `/settings/platform/access` | Access granted before a user signs in | Review/apply in existing management flow |
| `/settings/platform/announcements` | Platform release-note switch | Auto-save |
| `/settings/platform/ai-review` | AI review configuration | Explicit save for multi-field edits |

## Desktop and mobile layout

- Use a real page under the application header, not a conventional modal.
- Desktop: 220–240 px left navigation; focused 720–800 px content column.
- Keep one page scroll container.
- Show Personal and Platform as separate navigation groups.
- Hide Platform navigation for users without platform-admin access.
- Mobile: compact section picker above the content; preserve the current route.
- Redirect `/settings` to `/settings/chat`.
- Unknown or unauthorized routes fall back to the nearest valid personal section.

## Auto-save contract

```text
idle -> saving -> saved
          └────> error -> retry
```

- A control reflects the desired value immediately.
- Serialize writes per preference key.
- Coalesce rapid changes to the latest pending value.
- Ignore stale responses and avoid state updates after unmount.
- Roll back server-authoritative settings when persistence fails.
- Keep locally effective appearance changes applied and label sync failures clearly.
- Announce status through `aria-live="polite"`.
- Show quiet inline status; do not toast every successful toggle.
- Never silently swallow a failed sync.

## Implementation phases

### 1. Routed workspace

- Add the catch-all settings route and route registry.
- Add responsive navigation, page header, scope labels, empty/loading/error states.
- Add shared setting row, switch, and auto-save status primitives.

### 2. Safe persistence

- Add a reusable keyed auto-save controller.
- Migrate appearance persistence and fix the current debounce patch-loss race.
- Migrate each personal default-agent picker to an independent write/status.
- Add retry and stale-response coverage.

### 3. Personal sections

- Extract appearance controls from the header drawer.
- Move per-surface default agents and chat preferences into Chat & agents.
- Split personal release-note controls into Notifications.
- Move RBAC identity details into Account & access.
- Move debug/session/token details into Developer.

### 4. Platform sections

- Remove personal content from the current admin platform-default card.
- Preserve confirmation when changing the platform default agent.
- Move unlinked access, platform announcements, and AI review to scoped routes.
- Preserve read-only admin simulation behavior.

### 5. Entry points and compatibility

- Route avatar Settings to `/settings/chat`.
- Route the header appearance shortcut to `/settings/appearance`.
- Deep-link Admin settings entries into `/settings/platform/*`.
- Retire the profile settings dialog and appearance drawer after parity is covered.
- Redirect legacy admin settings URLs where practical.

### 6. Verification and docs

- Unit-test route selection, admin visibility, keyed write ordering, coalescing, retry, rollback, and unmount safety.
- Test personal default agents independently for Web, Slack, and Webex.
- Test direct URLs, refresh, keyboard navigation, mobile layout, and admin-only routes.
- Update user customization, admin settings, and RBAC usage documentation.
- Run `nvm use`, targeted Jest tests, `npm run lint`, and `npm run build`.

## Non-goals

- Do not redesign authentication or RBAC contracts.
- Do not move Agents, Skills, Credentials, or Service Accounts in this change; only remove settings duplication. Resource-navigation cleanup is follow-up work.
- Do not auto-save multi-field governance/access forms that need review as a unit.
- Do not add a new UI framework or persistence dependency.

## Definition of done

- One canonical routed settings workspace exists.
- Personal and platform settings never share the same card.
- Personal single-setting controls have no Save buttons.
- Every auto-save exposes saving, saved, and actionable error states.
- Rapid interaction cannot lose or reorder writes.
- Consequential platform changes remain confirmed.
- Old settings modal/drawer entry points route to the correct section.
- Deep links, browser navigation, mobile layout, and keyboard use work.
- Per-surface default-agent behavior remains intact.

## Verification status

- Focused Jest: 11 suites, 114 tests passed.
- ESLint: passed.
- TypeScript (`tsc --noEmit --incremental false`): passed.
- Playwright: 17 affected tests discovered across the Settings Center, admin
  settings regression, and service-account flows.
- Browser execution is deferred to the local review pass.
- `npm run build` was intentionally omitted at the request of the reviewer.
