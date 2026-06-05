# Phase 1 Data Model: Unified Shareable-Resource RBAC

Entities span three representations: the **OpenFGA authorization graph** (tuples
and types), the **persisted config** (Redis-backed Pydantic models; Mongo for
agents), and the **derived projection** that keeps them aligned. Config is the
source of truth; OpenFGA is the enforcement projection (see research Decision 3).

---

## 1. Canonical Shareable Resource (OpenFGA type template)

The reference shape every shareable type MUST conform to. `<extra_member>` and
`<extra_perms>` are per-type extension points; everything else is fixed.

```
type <resource>
  relations
    define creator: [user]                                  # audit-only — NOT in any can_*
    define owner: [user, service_account]
    define reader: [user, service_account, team#member, team#admin, external_group#member]
    # define <extra_member>: [...]                          # optional, e.g. ingestor / user
    define manager: [user, service_account, team#admin, organization#admin]
    define auditor: [user, service_account, team#admin]
    define can_discover: can_read
    define can_read: reader or can_manage or owner          # (+ extra-member terms as needed)
    define can_manage: manager or owner
    define can_delete: can_manage
    define can_audit: auditor or can_manage
```

**Invariants (enforced by the drift check, FR-007):**

- `creator` exists and is of type `[user]`.
- `creator` appears in **no** `can_*` expression.
- `can_manage` includes `manager` (team admins) and the org-admin bypass path.
- The authored `.fga` and the chart JSON forms are identical (FR-031).

### Per-type member/permission relations

| Type | Extra member relations | Notes |
|---|---|---|
| `agent` | `user`, `writer` | adds `user:*` global, `caller` edges to `tool` |
| `knowledge_base` | `ingestor` | `reader` also includes `slack_channel`, `webex_space` |
| `data_source` | `ingestor` | gains `parent_kb` inheritance (§3) |
| `mcp_tool` | `user`, `caller` | `caller` includes `agent`; `can_call` enforced at invoke |

---

## 2. `creator` relation (new)

| Aspect | Value |
|---|---|
| Relation name | `creator` |
| Allowed subject types | `[user]` |
| Referenced by permissions | **none** (audit-only) |
| Written when | resource creation (and backfilled for existing personal owners — see db-migration) |
| Mutated by | never (immutable across transfers and membership changes) |
| Tuple form | `user:<creator_sub> creator <resource>:<id>` |

**Relationship to `owner`**: disjoint roles. `creator` = provenance (no
authority). `owner` = functional personal/service-account ownership (in
`can_*`). For team-owned resources created after this feature, authority comes
from `team:<owner_slug>#admin manager`, not a personal `owner` tuple.

---

## 3. `data_source` → `knowledge_base` inheritance edge (new, A2)

| Aspect | Value |
|---|---|
| Relation name | `parent_kb` on `data_source` |
| Allowed subject types | `[knowledge_base]` |
| Tuple form | `data_source:<id> parent_kb knowledge_base:<id>` (here `<id>` is identical for both — the shared datasource id) |
| Written when | datasource creation (and backfilled for pre-existing datasources) |
| Permission effect | `can_read`, `can_ingest`, `can_manage` each gain `... or <perm> from parent_kb` |

Updated `data_source` permission expressions:

```
define parent_kb: [knowledge_base]
define can_read:   reader or can_manage or owner or can_read from parent_kb
define can_ingest: ingestor or can_manage or owner or can_ingest from parent_kb
define can_manage: manager or owner or can_manage from parent_kb
define can_delete: can_manage
define can_discover: can_read
define can_use: can_read
define can_write: can_ingest
define can_audit: auditor or can_manage
```

**Consequence**: team grants are written once on `knowledge_base:<id>`; the data
source inherits read/ingest/manage. The mirror that previously duplicated grants
onto `data_source` is retired (FR-020).

---

## 4. `OwnedResourceMixin` (persisted config fields)

A reusable field set attached to resource config models (Pydantic for RAG;
the equivalent fields already exist on the agent Mongo doc).

| Field | Type | Required | Meaning |
|---|---|---|---|
| `creator_subject` | `str \| None` | set at create | Keycloak `sub` of the creator; immutable; provenance only |
| `owner_subject` | `str \| None` | optional | personal/service-account owner subject, if any |
| `owner_team_slug` | `str \| None` | set at create for team-owned | the single owner team; **source of truth**; changeable only via transfer |
| `shared_with_teams` | `list[str]` | default `[]` | additional team slugs granted access |

**Validation rules**:

- `owner_team_slug`, if present, must be a valid team slug (OpenFGA id pattern).
- `shared_with_teams` entries are normalized (trimmed, deduped, invalid dropped),
  consistent with existing reconciler normalization.
- The owner slug is deduped out of `shared_with_teams` (union semantics).
- On edit, `owner_team_slug` MUST NOT change except through the transfer path
  (FR-013..FR-017); the route helper enforces this.

---

## 5. Concrete config model changes

### `DataSourceInfo` (Redis; `models/rag.py`) — adds the mixin

| New field | Type | Default |
|---|---|---|
| `creator_subject` | `Optional[str]` | `None` |
| `owner_subject` | `Optional[str]` | `None` |
| `owner_team_slug` | `Optional[str]` | `None` |
| `shared_with_teams` | `List[str]` | `[]` |

Existing fields unchanged. Additive and backward-compatible: documents persisted
before this change deserialize with the defaults.

### `MCPToolConfig` (Redis; `models/rag.py`) — adds the mixin

Same four fields, same types/defaults as above. Existing fields (`tool_id`,
`description`, `parallel_searches`, `allow_runtime_filters`, `enabled`,
`created_at`, `updated_at`) unchanged.

---

## 6. Derived OpenFGA tuple sets (what the reconciler writes)

For a shareable resource `<type>:<id>` with creator `C`, owner team `O`, shared
teams `S = {s1, s2, …}`, and member-relation set `M` (`reader` plus any extras):

**Writes (create / update):**

```
user:<C> creator <type>:<id>                         # provenance (once)
for each team t in ({O} ∪ S):
  for each relation r in M:
    team:<t>#member r <type>:<id>
  team:<t>#admin manager <type>:<id>
```

For `data_source`, additionally:

```
data_source:<id> parent_kb knowledge_base:<id>       # inheritance edge (once)
```

**Deletes (computed from previous vs. next):**

```
for each team t in (previousEffective \ nextEffective):
  for each relation r in M:    delete team:<t>#member r <type>:<id>
  delete team:<t>#admin manager <type>:<id>
```

Where `previousEffective = {previousOwnerTeamSlug} ∪ previousSharedTeamSlugs`
and `nextEffective = {ownerTeamSlug} ∪ nextSharedTeamSlugs`. A transfer is the
case where `previousOwnerTeamSlug ≠ ownerTeamSlug`, producing deletes for the
old owner team and writes for the new one. The `creator` tuple is never in a
delete set.

**Per-type member-relation set `M`:**

| Type | `M` |
|---|---|
| `agent` | `user` (+ `user:*` when global) |
| `knowledge_base` | `reader`, `ingestor` |
| `data_source` | grants live on the KB; the data_source gets only the `parent_kb` edge |
| `mcp_tool` | `reader`, `user` |

---

## 7. State transitions

**Resource lifecycle (ownership):**

```
(none) --create--> Team-Owned(O, creator=C, shared=∅)
Team-Owned(O) --share(+s)--> Team-Owned(O, shared ∪ {s})
Team-Owned(O) --unshare(-s)--> Team-Owned(O, shared \ {s})    [revokes s grants]
Team-Owned(O) --transfer(O→O')--> Team-Owned(O', creator=C unchanged)
                                   [revokes O grants, writes O' grants]
Team-Owned --delete--> (none)      [removes ALL grants incl. parent_kb; creator tuple removed with the object]
```

**Invariants across transitions:**

- `creator` is set exactly once and never changes until the object is deleted.
- Exactly one `owner_team_slug` at all times for a team-owned resource.
- Every unshare/transfer produces matching deletes (no dangling grants) — the
  defect this feature fixes.
- Delete removes every grant for the object, including the `parent_kb` edge and
  (for MCP tools) closing the orphan-tuple gap (FR-028).
