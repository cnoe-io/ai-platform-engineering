# Feature Specification: Skills MCP Server (`/api/skills/mcp`)

**Feature Branch**: `100-skills-mcp-server`
**Created**: 2026-04-21
**Status**: Draft
**Input**: User description: "Expose the AI Platform Engineering skills catalog as a Model Context Protocol (MCP) server at `/api/skills/mcp`, so external MCP clients (Claude Desktop, Cursor, Continue, Cline, Codex, Gemini CLI) can connect with their existing catalog API key and consume the user's installed skills natively as MCP prompts. Provide UI affordances in `TrySkillsGateway.tsx` for minting a key and copying ready-to-paste client config."

> **Authoritative facts gathered before drafting (do not re-investigate during planning):**
>
> - The catalog API key store already exists at `ai_platform_engineering/skills_middleware/api_keys_store.py` (collection `catalog_api_keys`, peppered SHA-256 hash of secret, `key_id.secret` format, `owner_user_id` per key, `revoked_at` for revocation, optional `last_used_at` audit).
> - Catalog key validation is implemented **server-side in Python** via `verify_catalog_api_key()` and consumed by the FastAPI router at `ai_platform_engineering/skills_middleware/router.py` (`get_catalog_auth`).
> - The Next.js UI is a thin proxy: `ui/src/app/api/catalog-api-keys/route.ts` forwards mint/list/revoke calls to the Python backend at `NEXT_PUBLIC_A2A_BASE_URL`. There is no Mongo round-trip from Node for catalog keys today.
> - **Gap:** `getAuthFromBearerOrSession()` in `ui/src/lib/api-middleware.ts` lines 119–131 trusts any non-empty `X-Caipe-Catalog-Key` header without validating it and assigns a synthetic `catalog-key-user@local` identity. This is fine when the route only proxies to the Python backend (which re-validates), but is **not** safe for any Next.js handler that performs work locally without forwarding (such as the proposed MCP server).
> - The header name is configurable via `CAIPE_CATALOG_API_KEY_HEADER` (defaults to `X-Caipe-Catalog-Key`).
> - The MCP TypeScript SDK (`@modelcontextprotocol/sdk`) provides a `StreamableHTTPServerTransport` that adapts to a single HTTP route handling both `POST` (client→server JSON-RPC) and `GET` (server→client SSE).

## User Scenarios & Testing *(mandatory)*

### User Story 1 — Connect an external MCP client to the skills catalog (Priority: P1)

A platform engineer who already has a catalog API key (minted via the existing `/api/catalog-api-keys` flow) opens Claude Desktop / Cursor / Continue, pastes a small JSON snippet into the client's MCP config, restarts the client, and immediately sees their team's skills appear as MCP prompts/slash-commands in that client. Invoking one returns the rendered skill body so the host LLM can act on it.

**Why this priority**: This is the entire reason the feature exists. Without it, skills are only consumable through the bootstrap-skill workflow (manual file install per agent). MCP gives users one canonical, live-updating, authenticated channel that every modern agent supports.

**Independent Test**: Mint a catalog key, paste the generated config into Claude Desktop, restart, and verify (a) the server appears in Claude's MCP server list as connected, (b) `prompts/list` returns the same skills the user sees in the UI catalog, and (c) selecting a skill yields the rendered template text in the conversation.

**Acceptance Scenarios**:

1. **Given** a user with a valid, unrevoked catalog API key whose `owner_user_id` owns at least one skill, **When** an MCP client performs `initialize` then `prompts/list` against `/api/skills/mcp` with the key in the `X-Caipe-Catalog-Key` header, **Then** the response contains exactly the skills owned by (or shared with) `owner_user_id`, with `name = command_name`, `description` derived from the skill, and an `input` argument for free-form invocation arguments.
2. **Given** the same authenticated client, **When** it issues `prompts/get` for one of those names, **Then** the response is a single user-role message whose text is the fully-rendered skill body (placeholders substituted for the agent's argument-reference convention, same logic as `/api/skills/bootstrap`).
3. **Given** a client that presents no auth header at all, **When** it calls any MCP method against `/api/skills/mcp`, **Then** the server returns HTTP 401 before any JSON-RPC frame is processed.
4. **Given** a client that presents a syntactically valid but unknown or revoked key, **When** it calls any method, **Then** the server returns HTTP 401 with a generic error message (no enumeration of valid keys).

### User Story 2 — Discover and copy MCP client config from the UI (Priority: P1)

A user opens the existing **Try Skills Gateway** screen, switches to a new "Connect via MCP" section, picks their coding agent from the same dropdown used for the bootstrap skill, optionally mints a fresh API key inline, and is shown a ready-to-paste config snippet (and the matching install path) for that agent. Copying and pasting it into the agent's config file is the only manual step.

**Why this priority**: Without this, US1 is gated on the user knowing exactly which JSON shape each MCP client expects (Claude Desktop, Cursor, Continue, Cline all differ slightly). The bootstrap flow already proves users want a single screen that adapts per agent.

**Independent Test**: Open the UI, mint a key, switch through every agent in the dropdown, and verify each rendered snippet is syntactically valid JSON/TOML for that client's documented MCP config format.

**Acceptance Scenarios**:

1. **Given** the Try Skills Gateway page is open and the user has at least one active key, **When** they pick "Claude Desktop" from the agent dropdown, **Then** the page shows a JSON fragment for `claude_desktop_config.json` containing the public base URL, the configured catalog-key header name, and a placeholder `<paste your key>` (or the most recently minted key if the user explicitly chose to embed it).
2. **Given** the same screen, **When** the user clicks "Mint new key", **Then** a key is created via the existing `/api/catalog-api-keys` POST flow, the full key is shown exactly once with a copy button, and the surrounding snippet updates in place to reference it.
3. **Given** any selected agent, **When** the rendered snippet contains the key, **Then** a "Copy" button copies the snippet to the clipboard and a "Test with MCP Inspector" affordance shows the equivalent `npx @modelcontextprotocol/inspector …` one-liner.

### User Story 3 — Per-key scoped skill visibility (Priority: P1)

When an MCP client connects with a catalog key whose `owner_user_id` is `alice@example.com`, the server only exposes skills that Alice would see in the UI catalog (her personal skills, the team skills shared with her, and any global skills). Bob's keys never see Alice's private skills, and vice versa.

**Why this priority**: This is a data-isolation requirement. Without it, a leaked or misissued key exposes the entire catalog. It also matches user mental model: "my MCP server shows my skills."

**Independent Test**: Create two users with disjoint personal skill sets, mint a key for each, and verify each MCP client sees only its owner's catalog. Add a team skill to a team that includes only Alice; verify it appears for Alice's key and not for Bob's.

**Acceptance Scenarios**:

1. **Given** two users Alice and Bob with disjoint personal skills `A1` and `B1` respectively, **When** an MCP client authenticated with Alice's key calls `prompts/list`, **Then** the response contains `A1` and not `B1`.
2. **Given** a global skill `G1` visible to all users, **When** either Alice's or Bob's MCP client calls `prompts/list`, **Then** both responses contain `G1`.

### User Story 4 — Live updates when skills change (Priority: P3)

If a user adds, edits, or removes a skill in the UI while an MCP client is connected, the client receives a `notifications/prompts/list_changed` event without needing to reconnect.

**Why this priority**: Nice-to-have. Most clients refresh on focus or reconnect anyway. Implementing this requires opting into stateful MCP sessions (`Mcp-Session-Id`) and wiring a Mongo change stream or pub/sub fan-out, which is meaningfully more work than the rest of the feature combined.

**Independent Test**: Connect Inspector with a stateful session, edit a skill in the UI, observe the `prompts/list_changed` notification arrive on the SSE stream within 5 seconds.

**Acceptance Scenarios**:

1. **Given** an MCP client with an active stateful session, **When** the user adds a new skill in the UI, **Then** the client receives a `notifications/prompts/list_changed` event and a subsequent `prompts/list` call reflects the new skill.

### Edge Cases

- **Key in URL instead of header**: Some MCP clients (notably older Cursor versions) only allow URL-based config. The server MUST also accept the key as a query parameter `?catalog_key=…` as a documented fallback, but the UI's recommended snippet MUST always prefer the header form.
- **Header name override**: If the deployment overrides `CAIPE_CATALOG_API_KEY_HEADER`, both the MCP server's auth check and the UI's generated snippets MUST use the deployment-configured name, not the literal `X-Caipe-Catalog-Key`.
- **No skills owned**: A valid key whose owner has zero accessible skills MUST receive a successful `prompts/list` response with an empty `prompts` array — never a 4xx.
- **MongoDB unavailable**: If the catalog-key store is unreachable, the server MUST return HTTP 503 with a generic error and log a warning; it MUST NOT fall back to "trust the header" behavior.
- **Streaming interruption / proxy buffering**: Cluster ingress (nginx/Envoy) often buffers SSE by default. The server's `GET` handler MUST set `Cache-Control: no-cache, no-transform`, `X-Accel-Buffering: no`, and emit a comment-line keep-alive (`: ping\n\n`) every 25 seconds so that idle proxies do not close the stream.
- **Large skill bodies**: Skill Markdown bodies may legitimately be tens of KB. `prompts/get` MUST stream the response (chunked or single SSE frame) and reject bodies above a documented hard ceiling (e.g. 256 KB) with a generic "skill too large for MCP transport" error rather than crashing the transport.
- **Concurrent invocations on a stateless connection**: A single client may issue several `prompts/get` calls in parallel. The handler MUST be safe for concurrent invocation against a shared catalog cache.
- **Catalog-key path collides with key-management path**: The Python router already forbids using a catalog key to manage keys (it returns 403 if `X-Caipe-Catalog-Key` is present on key-management endpoints). The new MCP route MUST follow the same convention if any subset of MCP methods would let a holder mint or revoke other keys (none are planned, but worth a guard in code review).

## Requirements *(mandatory)*

### Functional Requirements

#### Authentication & authorization

- **FR-001**: The MCP server at `/api/skills/mcp` MUST accept exactly the same catalog API key format produced by `create_catalog_api_key` (`{key_id}.{secret}`).
- **FR-002**: Validation MUST go through the existing `verify_catalog_api_key` logic — either by calling the Python supervisor over HTTP using the same proxy pattern as `/api/catalog-api-keys/route.ts`, or by porting the validation to a TypeScript helper that reads the `catalog_api_keys` collection directly using the same hashing rules. Choice between these two approaches is a planning-phase decision but the security guarantee MUST be identical: only keys where `revoked_at IS NULL` and `key_hash = sha256(pepper:secret)` succeed.
- **FR-003**: Successful authentication MUST attach the resolved `owner_user_id` to the request context for downstream filtering.
- **FR-004**: A request without a recognized credential (catalog key header, or alternatively a valid Bearer JWT or NextAuth session for in-UI testing) MUST be rejected with HTTP 401 before any MCP framing is processed; the body MUST be a generic JSON error so failures match the existing skills routes' shape.
- **FR-005**: The current trust-the-header behavior in `getAuthFromBearerOrSession()` MUST NOT be reused by this route. Either (a) the route bypasses that helper and uses a hardened catalog-key validator, or (b) the helper itself is hardened as a prerequisite. Either way the chosen path MUST be enforced at runtime, not merely documented.
- **FR-006**: Successful authentication MUST update `last_used_at` on the key (best-effort; failure to write MUST NOT fail the request).

#### MCP protocol surface

- **FR-007**: The server MUST implement the streamable-HTTP transport defined by the MCP 2025-03-26 spec (or the latest stable spec version pinned at planning time): `POST` for client→server JSON-RPC, `GET` upgraded to SSE for server→client streaming.
- **FR-008**: The server MUST advertise `serverInfo.name = "ai-platform-engineering-skills"` and `serverInfo.version` from the UI package.json.
- **FR-009**: The server MUST advertise the `prompts` capability and respond correctly to `initialize`, `prompts/list`, and `prompts/get`. It MAY also advertise `tools` exposing the same skills as no-op tools whose execution returns the rendered template text, for clients that only support tools (decision deferred to planning).
- **FR-010**: The server MUST advertise `prompts.listChanged = true` only if US4 is implemented in the same release; otherwise it MUST omit that flag to avoid lying to clients.
- **FR-011**: For each skill exposed, `prompts/list` MUST return `name` (the skill's `command_name`), `description` (the skill description trimmed to the MCP-recommended length), and an `arguments` array describing the placeholders the skill accepts. At minimum a single `input` argument MUST be present so any client can pass free-form arguments.
- **FR-012**: `prompts/get` MUST resolve the requested skill using the same catalog-resolution path as `/api/skills/bootstrap` so the rendered output matches what users see in the UI's bootstrap preview, including placeholder substitution rules.

#### Catalog scoping

- **FR-013**: `prompts/list` MUST return only skills that the owning user (`owner_user_id` from the key) is entitled to see, using the existing entitlement helper at `ai_platform_engineering/skills_middleware/entitlement.py` (`filter_skills_by_entitlement`). The route MUST NOT implement a parallel filter.
- **FR-014**: A `prompts/get` call for a skill the owner cannot see MUST return the same JSON-RPC error code as a non-existent skill ("prompt not found") to avoid revealing the existence of skills outside the owner's scope.

#### UI

- **FR-015**: `TrySkillsGateway.tsx` MUST gain a "Connect via MCP" section/tab that reuses the existing agent dropdown (the same `AGENTS` registry from `bootstrap/agents.ts`) so the agent options are kept in sync between the bootstrap and MCP flows.
- **FR-016**: The UI MUST render an agent-appropriate config snippet for each supported agent (initial set: Claude Desktop, Cursor, Continue, Cline; Codex/Gemini optional based on whether they support MCP HTTP servers in the targeted release). Snippets MUST include the public base URL, the configured catalog-key header name (read from server config, never hard-coded), and either a `<paste your key>` placeholder or the most recently minted full key if the user explicitly chose "embed key".
- **FR-017**: The UI MUST surface the existing key mint/list/revoke flows from `/api/catalog-api-keys` inline so users do not have to navigate elsewhere.
- **FR-018**: The UI MUST show a copy-friendly `npx @modelcontextprotocol/inspector` one-liner for the selected agent's transport (HTTP) for self-service verification.

#### Documentation & operability

- **FR-019**: A new doc page at `docs/docs/ui/skills-mcp.md` MUST mirror the structure of the existing bootstrap doc and include: overview, supported agents, key management workflow, troubleshooting (including ingress SSE buffering), and a cURL/Inspector smoke test.
- **FR-020**: The Helm chart MUST expose configuration for the public base URL the UI advertises in MCP snippets (since pods don't know their externally-reachable URL). A new value such as `ui.publicBaseUrl` is acceptable, or reuse of an existing one if present (planning will confirm).
- **FR-021**: Cluster ingress documentation MUST call out the SSE-buffering caveat (FR-022 below) and provide a verified annotation set for the cluster's standard ingress controller.
- **FR-022**: The MCP route MUST set response headers appropriate for SSE on the `GET` branch (`Content-Type: text/event-stream`, `Cache-Control: no-cache, no-transform`, `Connection: keep-alive`, `X-Accel-Buffering: no`) and emit a periodic comment-line keep-alive frame on idle.

### Key Entities

- **Catalog API key** (existing, MongoDB collection `catalog_api_keys`): `key_id`, `key_hash` (SHA-256 of `pepper:secret`), `owner_user_id`, `scopes`, `created_at`, `revoked_at`, `last_used_at`. Owned by exactly one user. Format `{key_id}.{secret}` for client transmission.
- **MCP session** (new, optional, in-memory): `session_id`, `owner_user_id`, `created_at`, `last_active_at`, optional list of subscribed-to events. Only required if US4 is in scope.
- **Catalog skill** (existing, sourced from `agent_skills`, hubs, filesystem default): `id`, `command_name`, `description`, `body` (Markdown), `metadata`, `visibility`. The MCP server projects each entitled skill into an MCP prompt.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: An off-the-shelf MCP client (validated against at least Claude Desktop, Cursor, and the official `@modelcontextprotocol/inspector`) can complete `initialize → prompts/list → prompts/get` against a deployed `/api/skills/mcp` instance using only a valid catalog key, with no per-client patches.
- **SC-002**: For a user with N entitled skills, `prompts/list` returns exactly those N skills (zero false positives, zero omissions) for at least three test fixtures spanning personal-only, team-shared, and global-with-personal mixes.
- **SC-003**: A request with no auth, an unknown key, or a revoked key receives HTTP 401 in under 250 ms (excluding cold-start) and never reaches the MCP framing layer; this is verified by an automated test.
- **SC-004**: The UI's "Connect via MCP" section reduces "time from screen-open to working MCP-connected client" to under 2 minutes for a user who already holds a key, measured via the same usability rubric used for the bootstrap flow.
- **SC-005**: SSE keep-alive prevents disconnects through the cluster's standard ingress for an idle session lasting at least 10 minutes, verified in a staging environment.
- **SC-006**: The new route adds no detectable regression to existing `/api/skills/*` latency p95, and `prompts/list` p95 is within 1.5× the existing `/api/skills` p95 against the same catalog size.
- **SC-007**: 100% of new auth-path branches (valid key / unknown key / revoked key / missing header / Mongo down) are covered by automated tests, and the existing trust-the-header gap in `getAuthFromBearerOrSession` is either closed or formally fenced off from this route by code (not just convention).

## Out of Scope

- **Tool-style invocation that actually executes the skill** (i.e., the MCP server running the skill's instructions itself rather than returning the template). Skills are intended to be executed by the connecting agent's LLM, not by the server. If a future feature wants server-side execution it warrants its own spec.
- **Mutating MCP methods.** No `prompts/create`, no skill editing via MCP. The skills catalog is managed through the existing UI/API; MCP is read-only.
- **OAuth 2.1 dynamic client registration.** Catalog keys are sufficient for the target audience (engineers connecting their own desktop agents). DCR/PKCE may be considered in a later spec if needed for non-engineer audiences.
- **Per-MCP-call rate limiting beyond what already exists** at the gateway. Catalog keys are already rate-limitable upstream; revisit if abuse is observed.
- **A separate MCP server for each agent (ArgoCD, GitHub, etc.).** Those exist already as standalone Python MCP servers. This spec is strictly about exposing the *skills catalog* — the user-authored prompt library — over MCP.

## Dependencies & Risks

- **Dep-1**: MCP TypeScript SDK (`@modelcontextprotocol/sdk`) availability in the UI's npm registry mirror. Risk: low; package is on npmjs.com under MIT.
- **Dep-2**: Existing catalog-key store and `verify_catalog_api_key` semantics MUST remain stable through implementation. If the Python team plans schema changes (e.g. adding team scoping), align before starting Phase 0.
- **Risk-1**: SSE behind cluster ingress is the most common failure mode for MCP HTTP servers in production. Mitigation: validate ingress annotations in staging before declaring SC-005 met; document the required annotations in `FR-021`.
- **Risk-2**: Reusing the trust-the-header path would silently weaken the security boundary on a route that performs local work (unlike the existing proxy routes that re-validate downstream). FR-005 makes this an explicit, code-enforced requirement to prevent accidental reuse.
- **Risk-3**: If validation is implemented in TypeScript by reading Mongo directly, the pepper (`CAIPE_CATALOG_API_KEY_PEPPER`) MUST be available to the Next.js process. Operationally simpler to keep validation in Python and have Node call out to a small `/internal/verify-catalog-key` supervisor endpoint; this trade-off is a planning-phase decision.

## Open Questions *(to be resolved in `/speckit.clarify`)*

- **Q1**: Validate locally in Node vs delegate to Python supervisor? (Affects Phase 0 scope, pepper distribution, and unit-test surface.)
- **Q2**: Expose skills as MCP `tools` in addition to `prompts`, or prompts only for v1? (Some clients still under-support prompts.)
- **Q3**: Stateless transport (no `Mcp-Session-Id`) for v1 — confirmed acceptable, with US4 deferred to a later release?
- **Q4**: Should `/api/skills/mcp` accept a Bearer JWT from the in-UI "test this server" affordance, or is the catalog key the only accepted credential? (The Python router accepts both; Node should match.)
- **Q5**: Which agents make the v1 UI matrix? Claude Desktop + Cursor + Continue is the safest minimum; Cline/Codex/Gemini depend on whether their current releases speak streamable-HTTP MCP.
