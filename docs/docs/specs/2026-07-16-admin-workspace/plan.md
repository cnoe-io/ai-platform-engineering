# Admin workspace consolidation plan

**Branch:** `prebuild/feat/settings-center`

**Date:** 2026-07-16

**Status:** Implemented; awaiting local visual verification and final checks

**Related:** [Settings Center plan](../2026-07-16-settings-center/plan.md)

## Decision

Keep **Settings** and **Admin** as separate task contexts while sharing their
navigation language and visual system. Settings is a dialog; Admin remains a
routed workspace.

```text
Profile -> Settings dialog       Admin in primary navigation
        "configuration"          "the platform I operate"
                 \                 /
                  shared workspace UI
```

- Settings owns personal preferences plus the lightweight platform Defaults
  and Announcements controls visible only to admins.
- Admin owns resources, people, integrations, reports, health, access
  management, and governance policy.
- The former Admin **Settings** category becomes **Resources**.
- Admin keeps its own route, header, active top-navigation state, permission gates, and read-only simulation.
- The two experiences share navigation styling, responsive behavior, theme treatment, and accessibility primitives.
- A control has one canonical home. Do not render proxy cards or duplicate controls across both workspaces.

This combines the presentation without combining the mental models.

## Why this boundary

### 1. Scope is the strongest organizing principle

The highest-cost mistake is confusing a personal change with a platform-wide change. A scope boundary is easier to predict than asking users to distinguish between loosely defined terms such as "setting," "configuration," and "management."

| Context | User question | Examples |
|---|---|---|
| Settings | "How should CAIPE behave?" | Personal preferences, platform defaults, announcements |
| Admin | "What or whom am I managing?" | Users, resources, integrations, health, access, policy |

This also makes the existing Settings subtitle, **Manage your experience**, literally accurate.

### 2. Labels should follow the user's mental model

The current Admin **Settings** category contains agent configuration, Skill Hubs, service accounts, and credential administration. Those are platform resources, not personal preferences. Renaming the category avoids making users decide whether two identically named Settings areas mean the same thing.

This follows Nielsen Norman Group's [match with the real world and consistency principles](https://www.nngroup.com/articles/ten-usability-heuristics/): use familiar language and do not make different areas or actions appear equivalent when they are not.

### 3. Keep location visible instead of making users remember it

The Admin route should always expose four consistent context cues:

- **Admin** remains selected in the application header.
- The page header remains **Admin**.
- The active left-navigation category and destination remain visible.
- The URL names the current category and destination.

This applies [recognition rather than recall](https://www.nngroup.com/articles/recognition-and-recall/): users should be able to recognize where they are without remembering which horizontal tab led there.

### 4. Reveal depth only when it is relevant

Admin has many destinations. Showing all of them as peers would weaken scanning
and make the important choices compete with one another. Show all six stable
categories, then let the user disclose one category at a time without changing
pages. Route navigation automatically discloses the active category.

This applies [progressive disclosure](https://www.nngroup.com/articles/progressive-disclosure/): expose the important first-level choices and reveal specialized choices in context. It also supports the [aesthetic and minimalist heuristic](https://www.nngroup.com/articles/ten-usability-heuristics/), where irrelevant information should not compete with the current task.

### 5. Use navigation semantics, not application-menu semantics

The rail is page navigation, so implement it with semantic links and nested lists inside a named `nav`. Do not use ARIA `menu`/`menubar` roles. W3C notes that typical site navigation does not need the complex keyboard model those roles imply and recommends ordinary navigation/disclosure patterns instead: [WAI-ARIA disclosure navigation guidance](https://www.w3.org/WAI/ARIA/apg/patterns/disclosure/examples/disclosure-navigation/).

## Target information architecture

```text
Settings dialog
├── Personal
│   ├── Appearance
│   ├── Chat & agents
│   ├── Notifications
│   ├── Account & access
│   └── Developer
└── Platform settings            admin only
    ├── Defaults
    └── Announcements

Admin
├── Resources
│   ├── Agent configuration
│   ├── Skill Hubs
│   ├── Service Accounts
│   └── Credentials
├── Teams & Users
│   ├── Users
│   ├── Teams
│   └── Identity Sync
├── Integrations
│   ├── Slack
│   └── Webex
├── Insights
│   ├── Statistics
│   └── Feedback
├── Metrics & Health
│   ├── Metrics
│   ├── Health
│   └── Authorization Insights
└── Security & Policy
    ├── Policy                    label only
    │   ├── Access before sign-in
    │   └── AI Review
    ├── Authorization             label only
    │   ├── RBAC Audit
    │   ├── Access Explorer
    │   └── Self Check
    ├── Audit                     label only
    │   └── Chat Audit
    └── Identity & maintenance    label only
        ├── Keycloak
        └── Migrations
```

The third visual level is a non-interactive label, not another navigation decision. The actionable hierarchy remains category -> destination.

## Content ownership

| Current home | Target canonical home | Reason |
|---|---|---|
| Settings -> Chat & agents -> personal defaults | Settings -> Chat & agents | Affects only the signed-in user |
| Settings -> Notifications -> personal release-note preference | Settings -> Notifications | Affects only the signed-in user |
| Settings -> Account & access | Settings -> Account & access | Read-only identity and membership context for the signed-in user |
| Admin -> Platform -> Defaults | Settings -> Platform settings -> Defaults | A durable fallback preference, not resource administration |
| Admin -> Platform -> Announcements | Settings -> Platform settings -> Announcements | A durable platform preference |
| Settings -> Platform -> Access before sign-in | Admin -> Security & Policy -> Access before sign-in | Grants access before identity linkage; this is access policy |
| Settings -> Platform -> AI review | Admin -> Security & Policy -> AI Review | Defines a platform governance policy |
| Admin -> Settings -> Agents | Admin -> Resources -> Agent configuration | Platform resource/configuration task |
| Admin -> Settings -> Skills | Admin -> Resources -> Skill Hubs | Platform resource source, not a preference |
| Admin -> Settings -> Service Accounts | Admin -> Resources -> Service Accounts | Platform identity resource |
| Admin -> Settings -> Credentials | Admin -> Resources -> Credentials | Platform credential administration |
| Top-level Credentials workspace | No move | Personal connected apps and saved secrets remain a user workspace |

### Save behavior does not change with location

- Personal reversible preferences continue to auto-save.
- Platform announcements continue to auto-save with inline status.
- Platform default-agent changes keep their consequence confirmation.
- Access and AI Review retain explicit review/apply behavior for multi-field or consequential changes.
- Moving a control never changes its API contract or authorization check.

## Desktop layout

Use the same page-style workspace language as Settings, Credentials, and Knowledge Bases:

```text
+-----------------------------------------------------------------------+
| Admin header                         [View as] [Read-only/status]       |
+----------------------+------------------------------------------------+
| Resources            | Destination title + scope/status               |
|   Agent configuration| Destination content                            |
|   ...                |                                                |
| Teams & Users        |                                                |
| Integrations         |                                                |
| Insights             |                                                |
| Metrics & Health     |                                                |
| Security & Policy    |                                                |
+----------------------+------------------------------------------------+
```

- Use the wide, information-dense workspace width used by Credentials and Knowledge Bases (`max-w-[108rem]`).
- Keep a 256 px navigation rail and allow data-heavy Admin content to consume the remaining width.
- Keep category rows visible at all times.
- Render nested destinations for the disclosed category.
- Make each category row an accessible disclosure button with a chevron; it
  must not navigate to an arbitrary first destination.
- Automatically disclose the active category after route navigation.
- Keep the active category and active destination visually distinct using the shared system-gradient treatment.
- Remove the two current horizontal navigation rows.
- Keep a single page scroll container; sticky navigation must not create a competing scroll region.

### Header

- Icon: shield with a restrained hover animation.
- Title: **Admin**.
- Description: **Manage people, resources, operations, and policy.**
- Actions slot:
  - View as / Viewing as
  - Read-Only state
  - Crawl Console status, when applicable
- Do not repeat generic `ADMIN` badges inside every destination. The Admin context and permission-aware header already establish scope.
- Keep local warnings when an individual action is unusually consequential.

## Mobile and narrow layouts

- Replace the rail with one grouped native section picker.
- Use the six category labels as `optgroup` labels and include every authorized destination.
- Preserve the canonical destination route after selection, refresh, and browser navigation.
- Render View as / Read-Only actions below the header when they do not fit beside it.
- Do not introduce a separate mobile-only information architecture.

## Permission and simulation behavior

- Preserve `useAdminTabGates` as the source of destination visibility until a shared authorization contract replaces it.
- Hide a category when it has no authorized destinations.
- Choose the first authorized destination deterministically when a requested route becomes unavailable.
- Preserve the current full-admin and read-only experiences.
- Preserve View as across Admin navigation, including its query state.
- Never briefly render unauthorized links while gates are loading.
- If no destination is available, retain the existing explicit **No Admin access** state.
- During simulation, navigation remains usable while mutation controls remain disabled.

## Canonical routes

Use path segments for navigation state. Keep filters, pagination, date ranges, simulation, and panel-specific state in query parameters.

```text
/admin/platform/agents
/admin/platform/skill-hubs
/admin/platform/service-accounts
/admin/platform/credentials

/admin/people/users
/admin/people/teams
/admin/people/identity-sync

/admin/integrations/slack
/admin/integrations/webex

/admin/insights/statistics
/admin/insights/feedback

/admin/operations/metrics
/admin/operations/health
/admin/operations/authorization-insights

/admin/security/access-before-sign-in
/admin/security/ai-review
/admin/security/rbac-audit
/admin/security/access-explorer
/admin/security/self-check
/admin/security/chat-audit
/admin/security/keycloak
/admin/security/migrations
```

Visible labels can remain **Teams & Users** and **Metrics & Health** while route segments use concise domain names.

### Defaults and route removal

- Bare `/admin`:
  - Full admin -> `/admin/people/users` as the broadest administration task.
  - Read-only or gated user -> first authorized destination in registry order.
- Remove support for old `/admin?cat=<category>&tab=<tab>` navigation state.
- Do not add page routes for the Settings dialog.
- Do not show a "settings moved" placeholder page.

## Component architecture

### Shared workspace primitives

- Add a shared `WorkspaceShell` for page width, header, rail/picker, content column, and responsive breakpoints.
- Extend `WorkspaceHeader` with an actions slot instead of creating an Admin-only header.
- Extend the shared navigation model to support:
  - stable top-level categories;
  - one disclosed category's nested destinations;
  - optional non-interactive subgroup labels;
  - permission-disabled or hidden destinations;
  - grouped mobile options.
- Keep Settings, Credentials, and Knowledge Bases on their flat navigation model.
- Do not force data-heavy Admin content into Settings' narrow content width.

### Admin route registry

Create one typed registry containing:

- category id, label, icon, visible order, and default destination;
- destination id, path, label, icon, description, gate key, and subgroup;
- read-only/mutation requirements;
- content component key.

Use this registry for desktop navigation, the mobile picker, route parsing, gate filtering, and tests. Do not maintain separate lists for each surface.

### Break up the current page without a big-bang rewrite

The current `admin/page.tsx` is a large client component. Split it behind behavior-preserving boundaries:

```text
admin/
├── layout.tsx                  auth + Admin workspace frame
└── [[...path]]/page.tsx        canonical route resolution

components/admin/workspace/
├── admin-routes.ts
├── AdminWorkspace.tsx
├── AdminNavigation.tsx
└── AdminSectionContent.tsx
```

- First move the shell and route selection; keep existing data loaders intact.
- Then extract the remaining inline destinations by domain:
  - people;
  - insights;
  - platform resources;
  - operations;
  - security.
- Preserve active-destination lazy loading and visited-section caching.
- Keep dialogs at the nearest shared owner so route changes do not unintentionally destroy in-progress work.
- Relocate platform-wide panels from `components/settings` to neutral Admin domain modules; do not fork their implementations.

## Implementation phases

### 1. Navigation foundation

- Add the typed Admin route registry and route/gate helpers.
- Add nested-category support to shared workspace navigation.
- Add the `WorkspaceHeader` actions slot and shared `WorkspaceShell`.
- Unit-test route parsing, default selection, and gate filtering before changing visual navigation.

### 2. Admin shell migration

- Replace the Admin header and two horizontal tab rows with the shared page shell.
- Rename the current Admin **Settings** category to **Resources**.
- Keep existing destination content and data loading behavior.
- Preserve Admin's top-navigation active state.
- Pause for local visual review at desktop and mobile sizes.

### 3. Canonical routes

- Introduce path-based Admin routes.
- Remove category/tab query routing.
- Preserve filters, pagination, simulation, and OpenFGA subtab query state.
- Verify refresh, back/forward, and direct deep links.

### 4. Place platform-wide controls by task

- Move Defaults and Announcements into the admin-only Platform group in the
  Settings dialog.
- Move Access before sign-in and AI Review under Admin -> Security & Policy.
- Keep personal and Platform groups visually distinct inside Settings.
- Remove the old Settings and Admin page routes for these controls.
- Update entry points and docs to use only canonical Admin links.

### 5. Decompose Admin content

- Extract large inline destination bodies one domain at a time.
- Keep API calls, authorization behavior, dialog ownership, and save semantics unchanged.
- Delete the old Tabs wrapper only after every destination renders through the registry.

### 6. Verification and cleanup

- Update unit and Playwright coverage.
- Remove obsolete category/tab mapping code.
- Update the Settings Center plan and user/admin documentation to reflect the final ownership boundary.
- After local visual approval, run focused Jest, ESLint, TypeScript, and affected Playwright suites.
- Continue to omit `npm run build` per reviewer request.

## Playwright plan

### Update existing coverage

- `admin-settings-regression.spec.ts`
  - Rename the suite around the Admin workspace.
  - Replace **Settings / Agents** assertions with **Resources / Agent configuration**.
  - Assert canonical paths instead of category/tab query state.
- `settings-center.spec.ts`
  - Assert that Settings opens over and returns to its caller context.
  - Assert only admins see Defaults and Announcements.
- `rbac-admin-regression.spec.ts`
  - Preserve full-admin, read-only, and View as destination filtering.
- Service-account and credential Admin flows
  - Update navigation helpers to use `/admin/platform/...` paths.

### Add workspace behavior coverage

- Bare `/admin` resolves to the correct authorized canonical route.
- Admin remains active in the application header on every nested route.
- Disclosing a category does not navigate to an arbitrary first destination.
- Selecting a destination, refreshing, and using browser back/forward preserve context.
- The mobile grouped picker reaches every authorized destination.
- Categories with no authorized destinations are absent.
- View as persists across destination changes and never enables mutation controls.
- Read-only users retain the correct header state and content access.
- Removed Admin query links and page-based Settings routes are not supported.
- Keyboard users can tab through ordinary links; the current page exposes `aria-current="page"`.
- Navigation does not use `menu` or `menubar` roles.

### Preserve functional coverage

- Platform default confirmation and failure state.
- Announcement auto-save and retry.
- Access-before-sign-in management flow.
- AI Review explicit save flow.
- Teams, users, integrations, statistics, feedback, metrics, health, and security panels still render under their canonical routes.

## Non-goals

- Do not merge Admin into `/settings` or open Admin in a modal.
- Do not add an Admin dashboard merely to fill the bare route.
- Do not redesign Admin data tables, cards, filters, or backend APIs in the navigation change.
- Do not change RBAC/OpenFGA contracts.
- Do not auto-save consequential multi-field policy forms.
- Do not keep duplicate controls or compatibility redirects as a transition aid.
- Do not redesign Knowledge Bases or Credentials as part of this phase.

## Definition of done

- Settings contains personal preferences plus admin-only Defaults and Announcements.
- Admin contains resource, people, integration, operational, access, and policy workflows.
- Admin has no category named **Settings**.
- All six Admin categories are consistently available in one left navigation rail, subject to authorization.
- Category disclosure never causes an unwanted navigation, and route changes
  disclose the active category.
- Desktop and mobile use the same route registry and authorization decisions.
- The top navigation, page header, rail, destination heading, and URL agree about location.
- No control has two canonical homes.
- Existing read-only, View as, lazy-loading, filters, and save behavior remain intact.
- Old Admin query links and page-based Settings routes are removed.
- Updated unit and Playwright coverage passes after local visual approval.
