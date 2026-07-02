# Contract: Shared Reconciler + Route Orchestration

TypeScript, in `ui/src/lib/rbac/`. Generalizes the proven agent reconciler.

## R1. `reconcileShareableResource` core

```ts
interface ShareableResourceInput {
  objectType: "agent" | "knowledge_base" | "data_source" | "mcp_tool" | string;
  objectId: string;
  creatorSubject?: string | null;       // writes user:<sub> creator <type>:<id>
  ownerSubject?: string | null;         // optional personal owner
  ownerTeamSlug?: string | null;
  previousOwnerTeamSlug?: string | null;// transfer: revokes old owner-team grants
  nextSharedTeamSlugs?: readonly string[] | null;
  previousSharedTeamSlugs?: readonly string[] | null;
  extraMemberRelations?: readonly string[]; // e.g. ["ingestor"] or ["user"]
  parentKnowledgeBaseId?: string | null;    // data_source only → parent_kb edge
}

function buildShareableResourceTupleDiff(
  input: ShareableResourceInput
): TeamResourceTupleDiff;

async function reconcileShareableResource(
  input: ShareableResourceInput
): Promise<OpenFgaReconcileResult>;
```

**Behavioral contract** (matches data-model §6):

- Writes `user:<creatorSubject> creator <type>:<id>` exactly once when
  `creatorSubject` is set. **Never** emits a delete for a `creator` tuple.
- For each effective team (`{ownerTeamSlug} ∪ nextSharedTeamSlugs`, deduped):
  writes `team:<t>#member <r>` for each `r` in `["reader", ...extraMemberRelations]`
  (or the type's configured member set) and `team:<t>#admin manager`.
- For each team in `previousEffective \ nextEffective`: emits matching deletes.
- When `parentKnowledgeBaseId` is set, writes
  `data_source:<id> parent_kb knowledge_base:<parentKnowledgeBaseId>` once.
- Idempotent: same input → same diff; duplicate tuples deduped.
- Invalid ids/slugs are validated/dropped exactly as the current builders do.

**Refactor obligation (FR-003)**: `buildKnowledgeBaseRelationshipTupleDiff` and
`buildAgentRelationshipTupleDiff` are reimplemented as thin adapters over the
core. Agent-specific `globalUserAccess` (`user:*`) and tool-`caller` edges remain
in the agent module, layered on top of the core diff. **Acceptance**: existing
agent + KB reconciler/route test suites pass unchanged.

## R2. Route-orchestration helper

```ts
interface ShareableWriteContext {
  objectType: string;
  objectId: string;
  session: Session;                  // for creatorSubject + membership checks
  requestedOwnerTeamSlug?: string | null;
  requestedSharedTeamSlugs?: string[] | null;
  loadPrevious: () => Promise<{ ownerTeamSlug: string | null; sharedTeamSlugs: string[]; creatorSubject: string | null }>;
  persist: (next: { ownerTeamSlug: string | null; sharedTeamSlugs: string[]; creatorSubject: string | null }) => Promise<void>;
  allowOwnerTransfer?: boolean;      // default false; true only on the transfer path
  extraMemberRelations?: readonly string[];
  parentKnowledgeBaseId?: string | null;
}

async function handleShareableResourceWrite(
  ctx: ShareableWriteContext
): Promise<{ reconcile: OpenFgaReconcileResult; ownerTeamSlug: string | null; sharedTeamSlugs: string[] }>;
```

**Behavioral contract**:

1. Resolve `creatorSubject` from the config's previous value, or from
   `session.sub` on first create (set-once).
2. Validate the caller may use `requestedOwnerTeamSlug` (membership), reusing the
   existing resource-authz checks.
3. If `requestedOwnerTeamSlug` differs from the previous owner and
   `allowOwnerTransfer` is false → reject (owner is immutable outside transfer,
   FR-025/FR-001).
4. Compute previous set via `loadPrevious()` (config = source of truth).
5. Call `reconcileShareableResource` with previous + next + (on transfer)
   `previousOwnerTeamSlug`.
6. `persist()` the next owner/shared/creator to the config.

## R3. Transfer authorization

The transfer route MUST require the caller satisfy `can_manage` on the resource
(current owner-team admin) **or** pass the org-admin bypass
(`bypassForOrgAdmin: true` via `isOrgAdmin`). It sets `allowOwnerTransfer: true`
and passes the previous owner team so the reconciler revokes it (FR-014, FR-016).
The `creator` tuple is not touched (FR-011).
