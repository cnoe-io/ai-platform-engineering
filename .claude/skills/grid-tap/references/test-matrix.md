# GRID TAP test matrix

Every row produces a screenshot. Every create, share, revoke, or visibility change also produces exact OpenFGA tuple evidence, stale-tuple assertions, and admin/member CAS decisions.

## Release-history gate

Run `scripts/run-grid-tap.sh matrix` before touching the target. `REL-01` analyzes the full reachable commit graph from `GRID_TAP_RELEASE_BASE_REF` through `GRID_TAP_RELEASE_HEAD_REF`, attaches a commit-level JSON ledger, and fails when any commit has no mapped test domain. Do not reduce this to first-parent or non-merge history.

For the 0.5 release line, use:

```bash
GRID_TAP_RELEASE_BASE_REF=0.5.0 GRID_TAP_RELEASE_HEAD_REF=HEAD \
  .claude/skills/grid-tap/scripts/run-grid-tap.sh matrix
```

The base commit is excluded and all descendants reachable from the head are included. Change the refs for each later major-release candidate.

## Core production matrix

| ID | Capability | Required assertions |
|---|---|---|
| REL-01 | Release commit coverage | Base is an ancestor of head; every reachable commit has a domain and one or more matrix rows; full ledger attached |
| PRE-01 | Identity, deployment, and health | Correct admin/member subjects; expected release; healthy readiness; canonical shared-team membership tuples; compatible OpenFGA relations |
| DEP-01 | Upgrade and runtime contract | UI/API version agree with candidate; critical routes and services respond; startup/readiness behavior is healthy; no stale asset or schema mismatch |
| SEC-01 | Authentication and security | Login/session renewal/logout; protected APIs reject anonymous or forged subjects; secrets/tokens are redacted; security headers and redirect boundaries hold |
| FGA-01 | Authorization model integrity | Deployed model accepts required resource relations; owner/team/org inheritance works; stale tuples and unintended wildcard grants are absent |
| MCP-01 | Private MCP | Owner performs a real harmless tool call; member is denied by the invocation API; no team/org grants |
| MCP-02 | Team MCP | Shared-team member performs a real harmless tool call; team admin manages; outsider denied; no organization grant |
| MCP-03 | Global MCP | Owner performs a real harmless tool call; organization member can read/use but direct invocation remains denied; exact global tuple contract; non-admin cannot manage |
| MCP-04 | MCP visibility transitions | Private → Team → Global → Private writes exact tuples and revokes every stale tuple |
| CRED-01 | Private credential | Owner relations exist; marker value is never returned after creation; member denied |
| CRED-02 | Team credential | Team member metadata-reader/user decisions; outsider denied; revoke removes both relations |
| CRED-03 | Organization credential | Organization member metadata-reader/user decisions; non-admin cannot manage; revoke removes global access |
| KB-01 | Knowledge base and source | Tiny unique marker ingests; owner/shared team can search; outsider denied; source status and deletion complete |
| KB-02 | Custom MCP tool | Owner/team/global `can_call` decisions match configuration; tool is callable only where granted; revoke is immediate |
| AGT-01 | Private agent | Owner runs the agent and observes MCP `tool_start`/`tool_end`/`done`; member stream start is denied; no team/global grant |
| AGT-02 | Team agent | Shared-team member runs the agent and observes MCP `tool_start`/`tool_end`/`done`; cannot write; owner/team-admin manages; outsider denied |
| AGT-03 | Global agent | Exact global-use tuple exists; non-admin runs the agent and observes MCP `tool_start`/`tool_end`/`done`; non-admin cannot manage |
| AGT-04 | MCP access from agent | Agent-to-tool caller tuple exists; selected MCP and credential binding persist; the configured harmless tool actually executes; direct and agent authorization boundaries differ as designed |
| CHAT-01 | New chat | Selected fixture agent persists; marker response, tool lineage, history, refresh, and deep link work |
| CHAT-02 | Direct chat share | Recipient reader/writer decision matches view/edit permission; API enforcement and revoke verified |
| CHAT-03 | Team chat share | Team member reader/writer decision matches permission; non-member denied; revoke verified |
| CHAT-04 | Streaming and interaction | SSE ordering/completion, stop/retry, attachments, timeline, feedback, and error recovery remain usable |
| TOME-01 | Project/wiki/gist editing and authorization | Create an isolated project and immutable document object; verify exact team-reader and steward-writer tuples plus effective read/write enforcement through the BFF and TOME MCP; exercise UI edit/cancel/preview/save/reload/fullscreen; prove UI and TOME MCP edits converge; reader UI and direct API/MCP mutation are denied |
| TOME-02 | TOME ingestion and retrieval | Credential preflight rejects an inaccessible source with an actionable credentials link; source-free seeded ingest reaches `succeeded`; generated pages, MCP ingest log, and TOME agent retrieval preserve the unique marker |
| TOME-03 | External content embeds | Vidcast, YouTube, and arXiv render in gist and non-gist wiki pages; indented continuation fields survive; unsafe markup is rejected before persistence; remove controls are edit-only and removal persists after save |
| TOME-04 | AI presentation generation and export | A tiny run-prefixed wiki page drives the deployed TOME agent generation stream; completion returns a source-grounded deck; HTML and PPTX exports have safe download headers, preserve the marker, and PPTX has a valid ZIP signature; export dialog renders |
| WF-01 | Workflows and schedules | Create/edit/run/disable/delete; inputs and agent binding persist; owner/team/global authorization enforced when sharing is supported |
| SKL-01 | Skills | Catalog discovery, install/update, agent attachment, invocation, and permission boundary work without exposing deployment credentials |
| INT-01 | External integrations | Enabled release-critical integration paths pass with disposable fixtures; disabled or unapproved providers are marked `BLOCKED`, never silently skipped |
| OBS-01 | Admin, audit, and operations | Health/audit/metrics/navigation load; mutations emit attributable audit records; non-admin surfaces remain read-only and mutation APIs return 403 |
| RBAC-01 | Admin boundary | Non-admin Admin surfaces remain read-only; direct mutation APIs return 403; privileged data is not leaked in payloads |
| UX-01 | Cross-cutting UX | Validation, async options, cancel, refresh, pagination, narrow viewport, keyboard/focus, error/empty/loading states, and deep links |
| QUAL-01 | Release governance | User-facing docs/config claims match deployed behavior; dependency and migration changes have a mapped smoke assertion; no unreviewed commit class |
| CLEAN-01 | Cleanup | Manifest resources deleted in reverse dependency order; reads fail; object tuples and run-prefixed residue are zero |

## Commit-domain routing

`scripts/release-commit-matrix.mjs` assigns every commit to one or more domains using its subject and changed paths. Domains intentionally overlap because cross-cutting commits need multiple regression assertions.

| Domain | Matrix rows |
|---|---|
| Deployment/runtime | PRE-01, DEP-01, OBS-01 |
| Security/authentication | PRE-01, SEC-01, RBAC-01 |
| OpenFGA/RBAC/identity | PRE-01, FGA-01, RBAC-01, MCP-04, AGT-01, CRED-02, CHAT-03 |
| MCP/gateway | MCP-01 through MCP-04, AGT-04 |
| Credentials | CRED-01 through CRED-03, AGT-04 |
| Knowledge/RAG | KB-01, KB-02, TOME-02 |
| Agents/models | AGT-01 through AGT-04, CHAT-01 |
| Chat/streaming | CHAT-01 through CHAT-04 |
| Projects/TOME | TOME-01 through TOME-04 |
| Workflows/skills | WF-01, SKL-01 |
| Integrations/bots | INT-01 |
| Admin/observability | OBS-01, RBAC-01 |
| General UI | UX-01, RBAC-01 |
| Tests/docs/dependencies/release | REL-01, QUAL-01 |

For the real-browser acceptance pass, use actual Safari for the admin and the operator-specified Chrome profile for the non-admin. Verify the displayed identity before acting and capture the entire application viewport after each row.
