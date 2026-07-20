# Settings Center implementation plan

**Branch:** `prebuild/feat/settings-center`

**Base target:** `prebuild/feat/per-surface-default-agents` (rebased before push)

**Date:** 2026-07-16

> **Final IA revision:** Settings is an in-context dialog. It owns personal
> preferences plus the lightweight Defaults and Announcements controls shown
> only to admins. Operational administration remains in the routed
> [Admin workspace](../2026-07-16-admin-workspace/plan.md).

## Goal

Replace the overlapping profile modal, appearance drawer, and mixed admin
settings cards with one Settings dialog that preserves the page underneath.

```text
Avatar menu ──────────┐
Appearance shortcut ─┴──> Settings dialog -> selected section
```

- Give every setting one canonical home.
- Keep personal and platform scope visibly separate.
- Keep sections keyboard accessible and responsive without changing page context.
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
    └── Announcements
```

### Personal

| Section | Content | Save behavior |
|---|---|---|
| Appearance | Theme, gradient, font family, font size, preview | Auto-save |
| Chat & agents | Web, Slack, and Webex default agents; memory; activity details; auto-scroll; timestamps | Auto-save per setting |
| Notifications | Release-note notification preference and preview | Auto-save |
| Account & access | Platform role, realm roles, teams | Read-only |
| Developer | Debug mode, OIDC/session information, diagnostics | Auto-save reversible preferences; sensitive values remain concealed by default |

### Platform

| Section | Content | Save behavior |
|---|---|---|
| Defaults | Platform default agent | Select, confirm consequence, persist |
| Announcements | Platform release-note switch | Auto-save |

Access before sign-in and AI Review remain in Admin → Security & Policy.

## Desktop and mobile layout

- Use a large modal dialog so closing Settings restores the caller's context.
- Desktop: 256 px left navigation and a focused content column inside a
  responsive dialog capped at 1,152 px.
- Keep one dialog-content scroll container and a fixed dialog header.
- Show Personal and Platform as separate navigation groups.
- Hide Platform navigation for users without platform-admin access.
- Mobile: compact section picker above the content.
- Profile Settings opens at Chat & agents; the header shortcut opens directly
  at Appearance.
- Unauthorized platform selections fall back to Chat & agents.

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

### 1. Shared settings workspace

- Add a typed section registry and in-context dialog host.
- Add responsive navigation, dialog header, scope labels, empty/loading/error states.
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

- Preserve confirmation when changing the platform default agent.
- Keep Defaults and Announcements in the admin-only Platform settings group.
- Keep access-before-sign-in and AI Review in Admin → Security & Policy.

### 5. Entry points and route cleanup

- Open avatar Settings at Chat & agents without changing the current URL.
- Open the header appearance shortcut at Appearance in the same dialog.
- Preserve the active primary navigation item beneath the dialog.
- Remove duplicate Admin General and AI Review proxy tabs.
- Retire the old profile settings dialog and appearance drawer after parity is covered.
- Remove legacy Admin query routes and credentials hash navigation instead of preserving compatibility redirects.

### 6. Verification and docs

- Unit-test route selection, admin visibility, keyed write ordering, coalescing, retry, rollback, and unmount safety.
- Test personal default agents independently for Web, Slack, and Webex.
- Test caller-context preservation, keyboard navigation, mobile layout, and admin-only sections.
- Update user customization, admin settings, and RBAC usage documentation.
- Run the Jest suite, `npm run lint`, TypeScript, and the affected Playwright specs.
- Omit `npm run build` for this review cycle at the reviewer's request.

## Non-goals

- Do not redesign authentication or RBAC contracts.
- Do not move Agents, Skills, Credentials, or Service Accounts in this change; only remove settings duplication. Resource-navigation cleanup is follow-up work.
- Do not auto-save multi-field governance/access forms that need review as a unit.
- Do not add a new UI framework or persistence dependency.

## Definition of done

- One canonical Settings dialog exists.
- Personal and platform settings never share the same card.
- Personal single-setting controls have no Save buttons.
- Every auto-save exposes saving, saved, and actionable error states.
- Rapid interaction cannot lose or reorder writes.
- Consequential platform changes remain confirmed.
- Profile and appearance entry points open the correct section.
- Caller context, mobile layout, and keyboard use work.
- Per-surface default-agent behavior remains intact.

## Verification status

- Jest: 531 suites, 6,530 tests passed.
- ESLint: passed.
- TypeScript (`tsc --noEmit --incremental false`): passed.
- Affected Playwright coverage was updated and audited for retired routes and
  implementation-detail assertions. Browser execution is deferred to the joint
  local review pass.
- `npm run build` was intentionally omitted at the request of the reviewer.
