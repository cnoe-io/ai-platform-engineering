# Migration Plan: Unified Shareable-Resource RBAC

**Storage touched**: Redis (RAG `DataSourceInfo`, `MCPToolConfig` configs) and
the OpenFGA tuple store (authorization graph). No SQL/Mongo schema migration for
this feature (agents already persist owner/shared in Mongo; no agent doc change).

## Summary: required vs. no-op

| Store | Change | Required at deploy? |
|---|---|---|
| Redis config (RAG) | Additive fields on `DataSourceInfo`, `MCPToolConfig` | **No-op** — additive, backward-compatible defaults |
| OpenFGA model | New `creator` relation, `data_source.parent_kb` + inheriting perms, `user:*` reader | **Required** — model write before app rollout |
| OpenFGA tuples | Backfill `parent_kb` edges; backfill `creator` from personal `owner` | **Required backfill** (idempotent, post-model) |
| MongoDB `mcp_servers` | Backfill `credential_sources` on built-in MCP servers (e.g. `knowledge-base`) | **Automatic** — runs on UI startup; zero operator action |

## 1. Redis config schema (no migration needed)

The four `OwnedResourceMixin` fields (`creator_subject`, `owner_subject`,
`owner_team_slug`, `shared_with_teams`) are added to `DataSourceInfo` and
`MCPToolConfig` with defaults (`None` / `[]`). Pydantic deserializes
pre-existing JSON blobs in Redis with these defaults, so **no rewrite of stored
configs is required**. New writes include the fields.

- No index changes (Redis key access is by `tool_id` / `datasource_id` prefix;
  unchanged).
- Forward-compatible: an older server reading a newer blob ignores unknown
  fields; a newer server reading an older blob fills defaults.

## 2. OpenFGA model write (required, ordered first)

Apply the updated authorization model (contract C1–C3) before rolling out app
code that writes the new tuples. Standard model-push:

- Authored `model.fga` → compiled → written to the OpenFGA store; the chart JSON
  is updated in lockstep (parity test guards this).
- Adding relations and tuple-to-userset permissions is **backward-compatible**
  for existing tuples: no existing tuple becomes invalid, and existing `can_*`
  results are unchanged except where new inheritance now grants additional access
  (intended).

**Rollback**: re-push the prior model version. Because the new relations are
additive, reverting the model simply stops resolving inheritance/creator; it does
not orphan existing owner/shared tuples.

## 3. Tuple backfill — `parent_kb` edges (required)

For every existing datasource, write the inheritance edge so pre-existing KB
grants take effect on the data source (FR-022).

- **Source of truth for the pair**: the datasource id IS the KB id (1:1), so the
  edge is `data_source:<id> parent_kb knowledge_base:<id>` for each known
  datasource id.
- **Enumeration**: list datasource ids from the RAG metadata store (Redis) — the
  authoritative datasource registry — not from OpenFGA.
- **Idempotent**: writing an existing tuple is a no-op; safe to re-run.
- **Batch**: chunk writes (consistent with existing reconcile batch sizes);
  log counts.

## 4. Tuple backfill — `creator` from personal `owner` (required, per FR-012 = option b)

For every existing `user:<sub> owner <type>:<id>` tuple on a shareable type,
write `user:<sub> creator <type>:<id>`. **Retain** the existing `owner` tuple
(non-breaking; see research FR-012 decision).

- **Idempotent**: re-running writes no duplicates.
- **No deletes** in this migration — authority is not removed for any existing
  resource. Tightening (dropping stale personal `owner` after verifying team
  grants) is a deliberate later cleanup, not part of this migration.
- **Scope**: applies to whichever types carry `creator` (those whose creation
  paths are updated — at minimum `agent`, `knowledge_base`, `data_source`,
  `mcp_tool`).

## 5. Mirror retirement (PR #1703 interaction)

If the #1703 mirror has already written duplicate `data_source` team tuples,
they are **harmless** under `parent_kb` (the data source would be readable both
directly and via inheritance). They may be left in place or cleaned up:

- **Leave**: zero risk; the inheritance path makes them redundant, not wrong.
- **Clean (optional)**: delete `team:<t>#member reader data_source:<id>` /
  `team:<t>#admin manager data_source:<id>` tuples that have a corresponding KB
  grant. Only do this after the `parent_kb` backfill (§3) confirms inheritance is
  in place, so access is never momentarily lost.

Recommendation: **leave them** for the initial release; schedule cleanup as a
follow-up once inheritance is verified in production.

## 5b. MongoDB `mcp_servers.credential_sources` backfill (automatic, zero-touch)

**Problem.** AgentGateway MCP discovery (the UI's MCP-server provisioning path)
historically wrote `mcp_servers` documents **without** a `credential_sources`
field. Transform-based gateway routes build the upstream auth header as
`"Bearer " + default(x-caipe-provider-token, "")`; with no credential source the
Dynamic Agents runtime never sets `X-CAIPE-Provider-Token`, so the gateway emits
an **empty Bearer** and the upstream returns **401**. The most visible victim is
`knowledge-base` (RAG), whose `/mcp` enforces its own Keycloak/OIDC auth — it
shows up as a red **"Connection Error"** in the UI even though the server is
healthy.

**Fix is two-sided:**

1. **Fresh installs / new discoveries** — `toAgentGatewayMcpServerDocument`
   (`ui/src/lib/rbac/agentgateway-mcp-discovery.ts`) now attaches the built-in
   `credential_sources` (from `BUILTIN_MCP_CREDENTIAL_SOURCES`) when it inserts a
   discovered document.
2. **Existing deployments** — `applySeedConfig()` runs
   `backfillBuiltinMcpCredentialSources()` on **every UI startup** (via the
   Next.js `instrumentation.ts register()` hook). It `updateOne`s each built-in
   id whose `credential_sources` is **absent or an empty array**.
3. **Read-time self-heal (defense-in-depth)** — the Dynamic Agents runtime
   (`services/mongo.py` `get_server` / `get_servers_by_ids`) injects the
   built-in `credential_sources` for known servers when the stored value is
   absent/empty, reading them from the packaged `services/config.yaml` (the
   authoritative declaration). This means a DA pod resolves credentials
   correctly **even before** the UI backfill has run — the system cannot regress
   to empty-Bearer 401 even if a stale doc slips through. Operator-customized
   lists are never overwritten.

### How does an operator "run" this migration?

**They don't.** It is **zero-touch** — rolling out the new UI image is the entire
migration:

```
helm upgrade ...        # or: docker compose up -d caipe-ui-prod
```

On the next UI startup the backfill executes automatically. It is:

- **Idempotent / non-destructive** — the `{$exists:false} OR {$size:0}` guard
  means re-runs are no-ops and an admin's customized `credential_sources` is
  **never** overwritten.
- **Single source of truth** — backfill and fresh-insert read the same
  `BUILTIN_MCP_CREDENTIAL_SOURCES` map (TS) which is kept in sync with
  `dynamic_agents/.../services/config.yaml` (the authoritative runtime
  declaration) and the gateway route transforms in `deploy/agentgateway/`.

### Verification

```js
// mongosh — should show the array after the UI has restarted
db.mcp_servers.find({ _id: "knowledge-base" }, { credential_sources: 1 })
```

UI logs print `"[seed-config] Backfilled credential_sources for MCP server: <id>"`
for each doc it fixed, and the run summary appends
`", N MCP credential_sources backfilled"`. In the UI, the affected MCP server's
probe should turn green (no more empty-Bearer 401 from `rag-server`).

### Break-glass (urgent, before the image ships)

Patch the affected doc(s) directly; the startup backfill will treat it as a
no-op afterward:

```js
db.mcp_servers.updateOne(
  { _id: "knowledge-base" },
  { $set: {
      credential_sources: [{
        kind: "caller_token",
        name: "X-CAIPE-Provider-Token",
        target: "header",
        fallback_client_credentials: true,
      }],
      updated_at: new Date().toISOString(),
  } },
);
```

### Rollback

Delete the backfilled field (`$unset: { credential_sources: "" }`) to return to
the prior behavior. Not recommended — it re-introduces the empty-Bearer 401.

## 6. Environment differences

- **dev/local**: reconciliation may be disabled or bypassed; the config fields
  still populate, so UI/state is correct without OpenFGA. Backfills are no-ops
  when the store is empty.
- **staging/prod**: run model push (§2) → app rollout → backfills (§3, §4) in
  that order. Backfills are safe to run repeatedly; run them after the model is
  live so the new relations exist.

## 7. Rollback summary

| Step | Rollback |
|---|---|
| Redis fields | None needed (additive; ignore on downgrade) |
| Model push | Re-push prior model version |
| `parent_kb` backfill | Delete the `parent_kb` tuples (access falls back to direct data_source grants / mirror if still present) |
| `creator` backfill | Delete `creator` tuples (no authority was attached, so no access change) |
| `credential_sources` backfill | `$unset` the field (re-introduces empty-Bearer 401; not recommended) |

All backfills are idempotent and reversible; none remove existing access, so the
migration is low-risk and re-runnable.
