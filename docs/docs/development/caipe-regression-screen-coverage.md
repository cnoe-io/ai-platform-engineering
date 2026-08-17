---
sidebar_position: 8
title: Screen and Negative-Test Coverage
description: Route inventory and positive, negative, authorization, error-state, accessibility, and browser coverage for the CAIPE Regression Suite.
---

# Screen and Negative-Test Coverage

This page inventories every Next.js page route and every major tabbed or catch-all surface. It is the human-owned checklist for positive and negative coverage. The automated `REL-03` gate compares this route table with `ui/src/app/**/page.tsx` and fails when a screen is added or removed without a documentation update.

This is an exhaustive inventory of reachable product screens and risk classes, not a claim that every input permutation is finite. A release report must distinguish automated, manually verified, failed, and blocked cases.

## Required personas

| Persona | Required use |
|---|---|
| Organization admin and fixture owner | Administrative success paths, resource creation, sharing, tuple inspection, cleanup |
| Shared-team non-admin | Team-positive access, private-negative access, non-admin management denial |
| Organization member outside the shared team | Team-negative and organization-positive access |
| Anonymous browser | Login redirects, callback validation, anonymous API denial |
| Scoped service account | Machine-to-machine allow/deny and caller-keyed tool authorization |

Do not substitute the shared-team non-admin for the outside-team persona: that would leave team isolation untested. Mark those cases `BLOCKED` until a distinct outside-team identity is available.

## Next.js route inventory

For every row, test direct navigation, top-level or contextual navigation where exposed, refresh, back/forward, loading, empty, error, and narrow-viewport states. Test both the visible UI and the backing APIs.

| ID | Route or surface | Positive assertions | Negative and API-enforcement assertions |
|---|---|---|---|
| SCR-001 | `/` | Authenticated personas see the correct home cards, navigation, release identity, and enabled capabilities | Anonymous redirects to login; disabled capabilities are absent; no privileged metadata leaks |
| SCR-002 | `/admin` | Admin can open every permitted category/tab and read health/configuration state | Non-admin sees only explicitly read-only surfaces; direct privileged mutations return 403; unknown tabs fail closed |
| SCR-003 | `/agent-builder` | User can create, validate, run, cancel, and revisit an owned builder workflow | Invalid schema, unavailable agent/tool, foreign workflow ID, and unauthorized execution fail without partial persistence |
| SCR-004 | `/agent-builder/history` | User sees and reruns only authorized history entries | Another user's run and missing/stale workflow IDs are denied or not found without data leakage |
| SCR-005 | `/agentic-sdlc/[[...rest]]` | Legacy paths redirect permanently to the equivalent enabled app path with query state preserved | Disabled app returns not found; malformed rest paths cannot create an external redirect |
| SCR-006 | `/apps` | User sees enabled, authorized apps and can launch allowed entries | Disabled, uninstalled, or unauthorized apps are hidden and direct access is denied |
| SCR-007 | `/apps/agentic-sdlc` | Each enabled tab loads, deep-links, refreshes, and preserves filters | Disabled product, unauthorized repository data, malformed filters, and backend failures fail closed |
| SCR-008 | `/apps/agentic-sdlc/[owner]/[repo]` | Authorized onboarded repository shows summary, CI, deployments, snapshots, metrics, and links | Unonboarded, nonexistent, or unauthorized repositories return not found/denied without cross-repository data |
| SCR-009 | `/apps/agentic-sdlc/[owner]/[repo]/epics/[epicId]` | Authorized epic detail and artifacts load with correct repository context | Foreign, missing, malformed, or unauthorized epic IDs do not leak artifact or repository data |
| SCR-010 | `/apps/create` | Authorized user can validate and create an allowed app definition | Invalid manifest, duplicate ID, unsafe origin/URL, unsupported type, and unauthorized create return actionable errors |
| SCR-011 | `/apps/embed/[appId]` | Authorized app renders within its origin and navigation contract | Unknown, disabled, or unauthorized app and disallowed frame/origin requests fail closed |
| SCR-012 | `/chat` | User resumes the last authorized chat or creates a new chat with an allowed agent | No-agent, removed-agent, storage/API failure, and stale conversation cases recover without exposing another chat |
| SCR-013 | `/chat/[uuid]` | Owner and explicitly shared reader/writer can load the permitted chat capabilities | Outsider, revoked recipient, malformed UUID, and direct message/share mutation APIs are denied consistently |
| SCR-014 | `/credentials` | User creates and manages owned provider connections; admin sees permitted management views | Secret values never return after creation; foreign credential, forged provider, callback/CSRF, and non-admin management fail |
| SCR-015 | `/dynamic-agents` | Owner creates, validates, edits, shares, invokes, versions, and deletes an agent | Viewer cannot edit/delete/share; private agent is absent to non-owner; invalid MCP/credential/model references fail atomically |
| SCR-016 | `/insights` | User sees only authorized personal/organization aggregates with correct empty and date-range states | Another user's raw activity and privileged aggregates are absent; malformed ranges and failed queries do not leak data |
| SCR-017 | `/knowledge-bases` | Authorized request redirects to the first permitted knowledge surface | No-access and disabled-RAG cases fail closed without exposing gated navigation |
| SCR-018 | `/knowledge-bases/graph` | Authorized graph user can query, expand, reset, deep-link, and inspect allowed entities | Disabled GraphRAG, unauthorized entity, malformed key, and graph API denial are handled consistently |
| SCR-019 | `/knowledge-bases/ingest` | Ingest-authorized user creates, monitors, retries, and deletes a disposable source | Search-only user cannot ingest; invalid source/credential, duplicate, timeout, and foreign source operations are denied |
| SCR-020 | `/knowledge-bases/mcp-tools` | Authorized user creates and exercises a KB search tool with correct sharing grants | Unauthorized create/call/update/delete, revoked grant, invalid KB, and stale tool binding return denial |
| SCR-021 | `/knowledge-bases/search` | Authorized user searches only accessible KBs and opens allowed sources/entities | No-access, private KB, unsafe source link, empty query, timeout, and backend failure do not expose hidden results |
| SCR-022 | `/login` | Anonymous user starts SSO and a safe same-origin callback returns to the requested page | External/encoded callback, failed SSO, expired state, repeated callback, and authenticated revisit are handled safely |
| SCR-023 | `/logout` | Session is cleared and protected UI/API access is removed | Repeated logout, server failure, stale tabs, and back navigation cannot restore an authenticated session |
| SCR-024 | `/projects` | User sees allowed project hierarchy/catalog items and creates permitted disposable projects | Private/foreign project, invalid hierarchy, duplicate slug, and unauthorized create/admin actions fail closed |
| SCR-025 | `/projects/[slug]` | Authorized project resolves to its canonical TOME view | Unknown, archived, disabled, or unauthorized project is denied without project metadata leakage |
| SCR-026 | `/projects/[slug]/tome/[[...path]]` | Every TOME virtual surface below deep-links, refreshes, and enforces project role | Unknown shape falls back safely; foreign project/page/run/gist and direct mutation APIs are denied |
| SCR-027 | `/projects/admin` | TOME admin opens every permitted tab and runs read-only health checks | Non-admin direct navigation and every admin mutation API return 403; unknown tab fails closed |
| SCR-028 | `/projects/catalog` | Authorized user browses available templates/catalog entries and starts allowed onboarding | Hidden/private template, malformed query, disabled catalog, and unauthorized provisioning fail closed |
| SCR-029 | `/schedules` | Authorized user creates, validates, runs, disables, enables, and deletes a disposable schedule | Non-owner/non-admin, invalid cron/time zone/agent, overlapping action, and direct mutation APIs are denied |
| SCR-030 | `/skills` | User discovers, filters, previews, installs/clones, invokes, and uninstalls allowed skills by scope | Private/foreign skill, unauthorized scope, flagged package, invalid archive, and revoked skill fail closed |
| SCR-031 | `/skills/editor` | Legacy/editor deep link resolves to the intended authorized workspace | Missing/foreign ID and crafted query cannot open or mutate an unauthorized skill |
| SCR-032 | `/skills/gateway` | Authorized user browses configured sources and performs permitted install operations | Disallowed source/repository/scope, unsafe URL, and non-admin gateway changes are denied |
| SCR-033 | `/skills/scan-history` | User sees authorized scan history, status, findings, and report links | Another user's/private skill scan and forged result ID are denied; scanner outage is actionable |
| SCR-034 | `/skills/workspace/[id]` | Owner edits files/metadata/tools/versions, scans, previews, saves, and receives unsaved-change protection | Built-in read-only/foreign skill cannot be mutated; invalid file path/archive, stale version, and unsafe content fail |
| SCR-035 | `/unauthorized` | Denied user sees a stable explanation and safe support path | Page contains no privileged resource details; protected APIs remain 401/403 after navigation |
| SCR-036 | `/workflows` | Owner creates, validates, edits, runs, disables, shares, and deletes a disposable workflow | Viewer/outsider cannot mutate; invalid step/tool/agent/input and disabled feature fail without partial state |
| SCR-037 | `/workflows/run/[id]` | Authorized user runs with valid inputs and observes deterministic completion/history | Missing/foreign/disabled workflow, invalid inputs, cancellation race, and unauthorized execution are denied |

## Virtual and tabbed surfaces

### Admin

Exercise all tab deep links for the admin and verify every backing mutation with the non-admin. Tabs are: General, Navigation, Agents, MCP, Skills, Service Accounts, AI Review, Credentials, Users, Teams, Identity Sync, Slack, Webex, Statistics, Feedback, Metrics, Health, RBAC Audit, Access Explorer, Self Check, Chat Audit, Keycloak, and Migrations.

Access Explorer also covers Builder, Explorer, Graph, Tuples, Access, Baseline, and Diagnostics. Positive checks must agree across tuple reads, contextual authorization decisions, UI state, and the protected API. Negative checks include malformed object/user/relation values, unsupported relation, cross-organization lookup, wildcard leakage, stale tuples, and non-admin mutation.

### TOME

| Surface | Positive assertions | Negative assertions |
|---|---|---|
| Agent | Authorized question streams a grounded response with citations/tool lineage | Viewer without required tool/KB access receives a safe denial or actionable error |
| Standup | Authorized project activity produces the correct bounded summary | Empty range, inaccessible source, and failed synthesis do not leak other projects |
| Issues | Authorized critical items load, filter, and deep-link to source pages | Foreign issue/project links and unauthorized status changes are denied |
| Activity | Authorized feed paginates and opens allowed objects | Private object payloads, bad cursors, and failed fetches do not leak content |
| Gists and gist detail | Create, view, edit-toggle, preview, save, cancel, share, and render supported embeds | Viewer cannot edit; unsafe HTML/script/URL is blocked; revoked share immediately denies API access |
| Settings | Each settings tab loads and valid changes persist with unsaved-change protection | Viewer cannot mutate; invalid hierarchy/source/model/schedule settings fail atomically |
| Insights | Authorized analytics match project data and date filters | Viewer cannot access privileged aggregates; empty/error states remain safe |
| Ingest | Start a disposable ingest/synthesis run and observe status | Missing credential/source, duplicate run, timeout, and unauthorized start are rejected |
| Ingest run | Status, logs, output, retry, and deep link remain stable across refresh | Foreign/missing run and malformed ID reveal no data |
| Draft review | Accept/reject permitted draft changes and preserve provenance | Viewer, stale revision, and cross-project draft operations are denied |
| Wiki page | View, edit-toggle, preview, save, cancel, rename/import, links, and embeds work | Viewer mutation, path traversal, conflict, unsafe content, and unsupported import fail safely |
| Page history | Authorized revisions, diff, and restore work | Viewer restore, foreign path/revision, and stale restore are denied |

TOME Settings tabs are General, Organization, Projects, Sources, Models, Auto-ingest, SLT, and Feed. TOME Admin tabs are Page Templates, Models, Model Evaluations, Analytics, RBAC Health, and Admins.

### Other tabbed surfaces

- Knowledge Bases: Search, Data Sources, Graph, MCP Tools; disabled tabs must match `/api/rbac/kb-tab-gates` and direct API behavior.
- Agentic SDLC: Ship Loop, Repositories, Metrics, Settings; preserve the selected tab and filters across deep link, refresh, and back/forward.
- Skill Workspace: Overview, Files, Tools, Versions, Scan; verify read-only built-ins, owned edits, unsaved changes, security findings, and version conflicts.

## Sharing and OpenFGA lifecycle

Apply the following lifecycle to MCP servers, agents, credentials, KBs, KB tools, projects/TOME, skills, workflows, apps, and chats wherever that resource supports the scope.

| Scope or transition | Positive assertions | Negative assertions |
|---|---|---|
| Create Private | Owner list/detail/manage/use decisions allow; exact owner/private-marker tuples exist | Shared-team member, outside-team member, and anonymous UI/API access deny; no team/org tuple exists |
| Private → Team | Selected team receives only documented read/use/call permissions; owner retains management | Other team and outside-team personas deny; no organization wildcard; no unintended writer/manager permission |
| Team → Global | Organization member receives only documented global capability | Anonymous and cross-organization subjects deny; non-admin cannot manage; stale team grant is absent when contract requires replacement |
| Global → Private | Owner retains access and all team/global grants disappear immediately | Prior team/org readers and callers deny in list, detail, mutation, and invoke APIs; cached UI cannot act |
| Revoke/Delete | UI disappears, detail reads fail, effective decisions deny, audit record exists | Object-scoped tuples, caller grants, dependent bindings, and run-prefixed residue are zero |

For every transition, capture the persisted resource, exact OpenFGA tuples, stale-tuple query, admin/shared-member/outside-team CAS decisions, UI result, API result, audit event, and screenshot.

## Cross-cutting positive and negative dimensions

Apply these dimensions to every applicable screen rather than testing only the happy-path control.

| Dimension | Positive coverage | Negative coverage |
|---|---|---|
| Authentication | Valid session, renewal, logout, safe callback | Anonymous, expired/revoked session, forged subject/header, unsafe callback, cross-origin request |
| Authorization | Owner/admin/team/org grants match UI and API | Hidden-control bypass, direct URL/API, ID substitution, cross-team/org, revoked/cache-stale access |
| Inputs | Minimum/maximum valid values, Unicode, multiline, supported files/URLs | Empty required, oversized, duplicate, malformed Unicode, HTML/script, path traversal, SSRF URL, unsupported file |
| Concurrency | Single mutation, refresh after save, idempotent retry | Double-submit, stale revision, update/delete race, share/revoke race, duplicate callback |
| Async states | Loading, progress, completion, pagination, retry | Timeout, partial response, cancellation, 409, 422, 429, 500, dependency unavailable |
| Navigation | Menu, deep link, refresh, back/forward, preserved filters | Unknown route/tab/ID, stale bookmark, disabled feature, unsaved-change escape |
| Data handling | Correct redaction, scoped lists, stable empty state | Secret/token/raw prompt leakage, private metadata in payload, unsafe external link/download |
| Accessibility | Keyboard-only, visible focus, labels, announcements, reduced motion | Focus loss/trap, unlabeled control, invalid ARIA state, inaccessible disabled/error state |
| Responsive UX | Desktop, narrow viewport, overflow menu, scroll retention | Clipped actions, unreachable dialog controls, horizontal overflow, hidden validation |
| Observability | Correlated request/run ID, attributable audit event, actionable error | Sensitive log content, missing actor/object, success audit on failed mutation, unbounded telemetry payload |

## Browser acceptance

- Safari admin and Chrome non-admin are separate required passes; Playwright WebKit/Chromium do not replace them.
- Verify the displayed identity before recording evidence.
- Capture every screen and tab at desktop width, plus navigation/dialog-heavy screens at a narrow viewport.
- Record `PASS`, `FAIL`, `BLOCKED`, or `NOT APPLICABLE`; never convert an unavailable persona, feature, or dependency into a pass.
