# Contract: FGA-Projected Team Shares Module

**Location (planned)**: `ui/src/lib/rbac/fga-projected-team-shares.ts`  
**Tests (planned)**: `ui/src/lib/rbac/__tests__/fga-projected-team-shares.test.ts`  
**Status**: Draft — spec only

## P1. Descriptor

```ts
export interface FgaProjectedResourceDescriptor {
  /** OpenFGA object type segment, e.g. `"skill"`, `"agent"`. */
  objectType: string;
  /**
   * Member relations written for shared teams via `buildTeamGrantTuples`
   * (passed to `reconcileShareableResource.memberRelations` or
   * `extraMemberRelations` + default reader set per type).
   */
  memberRelations: readonly string[];
  /**
   * Subset of relations used when *reading* team slugs from existing tuples.
   * Default: `memberRelations`. Use when the type writes multiple relations
   * but only one indicates "shared with team" for the editor list.
   */
  teamShareRelations?: readonly string[];
}
```

**Example descriptors**:

| Resource | `objectType` | `memberRelations` | `teamShareRelations` |
|----------|--------------|-------------------|----------------------|
| Agent skill | `skill` | `["user"]` | `["user"]` |
| Dynamic agent | `agent` | `["user"]` | `["user"]` |
| Knowledge base (if ever Model B) | `knowledge_base` | `["reader"]` (+ ingestor via extra) | `["reader"]` |

## P2. Read shared teams from FGA

```ts
export async function readSharedTeamSlugsFromOpenFga(
  descriptor: FgaProjectedResourceDescriptor,
  objectId: string,
): Promise<string[]>;
```

**Behavior**:

- If `!isOpenFgaReconciliationEnabled()` → `[]`.
- Paginate `readOpenFgaTuples({ tuple: { object: `${objectType}:${objectId}` } })`.
- Collect slugs via `extractTeamSlugsFromTuples`.
- Sort/dedupe stable for tests.

```ts
export function extractTeamSlugsFromTuples(
  descriptor: FgaProjectedResourceDescriptor,
  objectId: string,
  tuples: ReadonlyArray<OpenFgaTupleKey>,
): string[];
```

**Parsing rule**: `tuple.user` matches `^team:([^#]+)#member$`, `tuple.object === \`${objectType}:${objectId}\``, `tuple.relation` ∈ `teamShareRelations ?? memberRelations`.

## P3. Reconcile

```ts
export interface ReconcileProjectedTeamSharesInput {
  descriptor: FgaProjectedResourceDescriptor;
  objectId: string;
  ownerSubject?: string | null;
  ownerTeamSlug?: string | null;
  previousOwnerTeamSlug?: string | null;
  /** Team refs (slug or Mongo team id) before this write. */
  previousTeamRefs?: string[] | null;
  /** Team refs after this write. */
  nextTeamRefs?: string[] | null;
  /** Optional visibility-driven team + org-wide grants (skills). */
  visibility?: {
    next: "private" | "team" | "global";
    previous?: "private" | "team" | "global";
  };
}

export async function reconcileProjectedTeamShares(
  input: ReconcileProjectedTeamSharesInput,
): Promise<OpenFgaReconcileResult>;
```

**Behavior**:

1. Resolve `previousTeamRefs` / `nextTeamRefs` to slugs via `resolveTeamSlugs` (shared helper).
2. If `visibility` present:
   - `next !== "team"` → `nextTeamRefs` treated as `[]` for team shares.
   - `sharedWithOrg` / `previousSharedWithOrg` from `global` visibility (same as `reconcileSkillTeamShares` today).
3. Call `reconcileShareableResource({ objectType, objectId, creatorSubject: ownerSubject, ownerSubject, ownerTeamSlug, previousOwnerTeamSlug, nextSharedTeamSlugs, previousSharedTeamSlugs, memberRelations: descriptor.memberRelations, sharedWithOrg, previousSharedWithOrg })`.
4. Never persist to Mongo.

## P4. Mongo hygiene

```ts
export function stripProjectedFieldFromMongoDoc<
  T extends Record<string, unknown>,
  K extends keyof T,
>(doc: T, field: K): Omit<T, K>;

/** For updateOne: `{ $unset: { [field]: "" } }` */
export function mongoUnsetProjectedField(field: string): Record<string, "">;
```

Routes use strip on insert/replace payloads and combine `$unset` on every update that might have carried legacy data.

## P5. Hydrate API responses

```ts
export interface HydrateProjectedSharesOptions<T> {
  /** Field on doc that holds visibility enum, e.g. `"visibility"`. */
  visibilityField: keyof T;
  /** Value that means "load team slugs from FGA", e.g. `"team"`. */
  teamVisibilityValue: string;
  /** Response field name, default `shared_with_teams`. */
  projectedField?: keyof T;
}

export async function hydrateProjectedTeamShares<
  T extends { id: string } & Record<string, unknown>,
>(doc: T, descriptor: FgaProjectedResourceDescriptor, options: HydrateProjectedSharesOptions<T>): Promise<T>;

export async function hydrateProjectedTeamSharesList<T extends { id: string }>(
  docs: T[],
  descriptor: FgaProjectedResourceDescriptor,
  options: HydrateProjectedSharesOptions<T>,
): Promise<T[]>;
```

**Behavior**:

- If `doc[visibilityField] !== teamVisibilityValue` → set `projectedField` to `undefined` (do not leak stale FGA teams on private/global rows).
- Else → `projectedField = slugs from readSharedTeamSlugsFromOpenFga` or `undefined` if empty.

## P6. Skill facade (backward compatible)

`ui/src/lib/rbac/skill-team-grants.ts` keeps exports:

- `reconcileSkillTeamShares` → `reconcileProjectedTeamShares` with `SKILL_DESCRIPTOR` + visibility mapping.
- `readSkillSharedTeamSlugsFromOpenFga` → `readSharedTeamSlugsFromOpenFga(SKILL_DESCRIPTOR, id)`.
- `grantSkillsToTeams` — unchanged write-only bulk helper (may use `buildSkillTeamGrantTuples` or generic bulk write).

`ui/src/lib/agent-skill-visibility.ts`:

- `hydrateAgentSkillTeamShares*` → `hydrateProjectedTeamShares*` with skill options.

## P7. Route integration checklist

For each Model B resource route:

| Step | Action |
|------|--------|
| POST body | Accept `shared_with_teams` in JSON; do not insert into Mongo |
| PUT body | `previousTeamRefs = await readSharedTeamSlugsFromOpenFga(...)` when reconciling |
| PUT body | `nextTeamRefs` from body or visibility rules |
| updateOne | `$unset` legacy field |
| GET | `hydrateProjectedTeamShares` on single + list |
| DELETE | Existing delete-all-tuples helper for type (unchanged) |

## P8. Test matrix (PR 2)

| Test file | Purpose |
|-----------|---------|
| `fga-projected-team-shares.test.ts` | extract/read/reconcile/hydrate pure + mocked FGA |
| `skill-team-grants.test.ts` | facade still calls core with skill visibility |
| `route-rbac.test.ts` | PUT uses FGA previous, not Mongo |
| `agent-skill-visibility.test.ts` | Mongo insert lacks `shared_with_teams` |

## Anti-patterns

- Do **not** import this module from `shareable-resource.ts`.
- Do **not** use `loadPrevious()` from config for `previousSharedTeamSlugs` on Model B resources.
- Do **not** add `shared_with_teams` to Mongo schema migrations as required field.
