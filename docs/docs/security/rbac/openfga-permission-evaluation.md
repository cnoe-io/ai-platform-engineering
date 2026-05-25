---
title: How OpenFGA Permission Evaluation Works
sidebar_label: OpenFGA Permission Evaluation
description: Where the OpenFGA permission union is evaluated, what gets stored versus computed, and a worked end-to-end example for the Create Agent → Tools Probe button.
---

# How OpenFGA Permission Evaluation Works

This page answers one specific question:

> Do we call OpenFGA to verify the union permissions, or is the union written to OpenFGA? Where does the validation happen?

**Short answer.** OpenFGA does the validation. Union and chained permissions are **never written** to storage — they live entirely inside the authorization model and are evaluated **at check time** on the OpenFGA server. The BFF only writes the base "atom" tuples; it never writes anything for `can_read`, `can_discover`, `can_use`, `can_invoke`, etc.

This page walks the exact code path with file/line citations and a concrete worked example for the Create Agent → Tools **Probe** button (`POST /api/mcp-servers/probe?id=argocd`).

---

## 1. What gets stored vs. what gets evaluated

OpenFGA stores three things, in this order of permanence:

| Layer | What it is | How it's set | What it does at check time |
| --- | --- | --- | --- |
| **Authorization model** | JSON schema with relations and rules. | Uploaded once per install via the `openfga` Helm chart init job. Versioned by OpenFGA model id. | Defines what each relation means. The evaluator walks this graph for every Check call. |
| **Base relation tuples** | Three-column rows: `(user, relation, object)`. | Written by BFF reconciliation paths (org seed, team-resource grants, Slack channel grants, etc.). | The leaves the evaluator reads to answer "yes/no". |
| **Computed relations (`can_*`)** | Rules defined inside the model (`computedUserset`, `union`, `intersection`, `exclusion`). | Never written. They exist only in the model. | Evaluated on demand by combining base tuples. |

The key distinction is in the model JSON itself. Inside the `mcp_server` type definition you'll see two kinds of relations:

```json
"reader":   { "this": {} },
"user":     { "this": {} },
"invoker":  { "this": {} },
"manager":  { "this": {} },
"owner":    { "this": {} },

"can_discover": { "computedUserset": { "relation": "can_read" } },
"can_read": {
  "union": {
    "child": [
      { "computedUserset": { "relation": "reader" } },
      { "computedUserset": { "relation": "can_use" } },
      { "computedUserset": { "relation": "can_manage" } },
      { "computedUserset": { "relation": "owner" } }
    ]
  }
}
```

The five relations with `"this": {}` are **base relations** — you write tuples for them, and those tuples live as rows in OpenFGA's datastore. The relations defined with `computedUserset` or `union` are **derived**; they have **no stored rows**. They are pure functions over the base relations and are evaluated server-side every time someone calls Check.

This is the full source-of-truth model used in CAIPE: `charts/ai-platform-engineering/charts/openfga/authorization-model.json`.

---

## 2. The BFF only writes atoms

The BFF never writes a `can_*` tuple. It writes only the leaves. Here is the seed path for a config-driven MCP server (e.g. `mcp_server:argocd` baked into `config.yaml`):

```ts
// ui/src/lib/rbac/openfga-owned-resources.ts
export function buildConfigDrivenMcpServerRelationshipTupleDiff(
  input: ConfigDrivenMcpServerRelationshipInput
): TeamResourceTupleDiff {
  // ...
  const object = `mcp_server:${input.serverId}`;
  return {
    writes: uniqueTuples([
      { user: `organization:${organizationId}#member`, relation: "reader",  object },
      { user: `organization:${organizationId}#member`, relation: "user",    object },
      { user: `organization:${organizationId}#member`, relation: "invoker", object },
      { user: `organization:${organizationId}#admin`,  relation: "manager", object },
    ]),
    deletes: [],
  };
}
```

And the team-share path for any MCP server an admin assigns to a team:

```ts
// ui/src/lib/rbac/openfga-owned-resources.ts
export function buildMcpServerRelationshipTupleDiff(
  input: McpServerRelationshipInput
): TeamResourceTupleDiff {
  const writes: OpenFgaTupleKey[] = [];
  const object = `mcp_server:${input.serverId}`;
  if (input.ownerSubject && isValidOpenFgaId(input.ownerSubject)) {
    writes.push({ user: `user:${input.ownerSubject}`, relation: "owner", object });
  }
  if (input.ownerTeamSlug && isValidOpenFgaId(input.ownerTeamSlug)) {
    writes.push(
      { user: `team:${input.ownerTeamSlug}#member`, relation: "user",    object },
      { user: `team:${input.ownerTeamSlug}#member`, relation: "invoker", object },
      { user: `team:${input.ownerTeamSlug}#admin`,  relation: "manager", object },
    );
  }
  return { writes: uniqueTuples(writes), deletes: [] };
}
```

Notice: every entry uses one of `reader`, `user`, `invoker`, `manager`, `owner`. **No `can_*` tuples are written, ever.** The same convention holds for every other resource type (`agent`, `knowledge_base`, `task`, `skill`, `llm_model`, `system_config`, `admin_surface`, `tool`).

---

## 3. Where the validation happens

The BFF translates a domain-level action into the corresponding computed relation and asks OpenFGA "yes or no". It does no union evaluation itself.

### Action → relation mapping

```ts
// ui/src/lib/rbac/resource-authz.ts
export function openFgaRelationForResourceAction(action: ResourcePermissionAction): string {
  switch (action) {
    case "list":
    case "discover":   return "can_discover";
    case "read":       return "can_read";
    case "read-metadata": return "can_read_metadata";
    case "use":        return "can_use";
    case "write":      return "can_write";
    case "admin":
    case "manage":     return "can_manage";
    case "share":      return "can_share";
    case "delete":     return "can_delete";
    case "ingest":     return "can_ingest";
    case "call":       return "can_call";
    case "invoke":     return "can_invoke";
    case "audit":      return "can_audit";
  }
}
```

### `requireResourcePermission` — the gate at every BFF route

```ts
// ui/src/lib/rbac/resource-authz.ts
export async function requireResourcePermission(
  session: ResourceAuthzSession,
  target: ResourcePermissionTarget,
  options: ResourcePermissionOptions = {}
): Promise<void> {
  const subject = subjectFromSession(session);
  if (!subject) {
    throw new ApiError(
      "A stable user subject is required for this resource authorization check.",
      401, "NO_SUBJECT", "session_expired", "sign_in"
    );
  }

  const tuple: OpenFgaTupleKey = {
    user: subject,
    relation: openFgaRelationForResourceAction(target.action),
    object: resourceObject(target.type, target.id),
  };
  const check = options.check ?? checkOpenFgaTuple;
  const result = await check(tuple);
  if (!result.allowed) {
    throw new ApiError(
      "You do not have permission to access this resource.",
      403, `${target.type}#${target.action}`, "pdp_denied", "contact_admin"
    );
  }
}
```

### `checkOpenFgaTuple` — the network call

```ts
// ui/src/lib/rbac/openfga.ts
async function tupleAllowed(baseUrl: string, storeId: string, tuple: OpenFgaTupleKey): Promise<boolean> {
  const response = await fetch(`${baseUrl}/stores/${storeId}/check`, {
    method: "POST",
    headers: openFgaHeaders(),
    body: JSON.stringify({ tuple_key: tuple }),
  });
  if (!response.ok) {
    throw new Error(`OpenFGA tuple check failed: ${response.status}`);
  }
  const body = (await response.json()) as { allowed?: boolean };
  return Boolean(body.allowed);
}
```

That HTTP POST to `/stores/<storeId>/check` is the moment validation crosses from the BFF (a thin client) to OpenFGA (the policy decision point). Everything after that boundary is OpenFGA's job.

---

## 4. Worked end-to-end example — the Probe button

Scenario: a user `bob` clicks the lightning-bolt **Probe** button next to `Argocd` on the Create Agent → Tools step. We trace exactly what happens and exactly where the union is evaluated.

### Step 1 — Tuples already in storage

These are the rows in OpenFGA's datastore (Postgres in the standard deployment) before Bob clicks anything:

```text
# Written by the seed migration for the config-driven Argo CD MCP server:
organization:caipe#member  reader   mcp_server:argocd
organization:caipe#member  user     mcp_server:argocd
organization:caipe#member  invoker  mcp_server:argocd
organization:caipe#admin   manager  mcp_server:argocd

# Optionally, written when an admin shares Argo CD with team `platform`:
team:platform#member       user     mcp_server:argocd
team:platform#member       invoker  mcp_server:argocd
team:platform#admin        manager  mcp_server:argocd

# Written when Bob joined the organization / team:
user:bob-sub               member   organization:caipe
user:bob-sub               member   team:platform
```

There are zero `can_*` tuples anywhere. Just atoms.

### Step 2 — BFF receives the Probe request

`POST /api/mcp-servers/probe?id=argocd` hits this route:

```ts
// ui/src/app/api/mcp-servers/probe/route.ts
await requireResourcePermission(session, {
  type: "mcp_server",
  id: "argocd",
  action: "discover",
});
```

`requireResourcePermission` maps `(type: "mcp_server", id: "argocd", action: "discover")` to the OpenFGA tuple key:

```json
{
  "user":     "user:bob-sub",
  "relation": "can_discover",
  "object":   "mcp_server:argocd"
}
```

and POSTs it to `/stores/<id>/check`.

### Step 3 — OpenFGA server-side evaluation (the union)

Here is where the union actually happens. OpenFGA loads its authorization model and walks the rules for `mcp_server#can_discover`:

```text
can_discover(bob, mcp_server:argocd)
  = can_read(bob, mcp_server:argocd)                       # computedUserset → can_read
  = reader(bob,  mcp_server:argocd)                        # union child 1
    ∪ can_use(bob,    mcp_server:argocd)                   # union child 2
    ∪ can_manage(bob, mcp_server:argocd)                   # union child 3
    ∪ owner(bob,      mcp_server:argocd)                   # union child 4
```

For each child, OpenFGA asks "is there a stored tuple that makes this true?":

1. **`reader(bob, mcp_server:argocd)`**
   - Direct lookup: is `(user:bob-sub, reader, mcp_server:argocd)` stored? No.
   - Userset traversal: is there any stored `(<userset>, reader, mcp_server:argocd)` whose userset contains Bob?
     - `(organization:caipe#member, reader, mcp_server:argocd)` is stored.
     - Is Bob in `organization:caipe#member`? Yes (via `(user:bob-sub, member, organization:caipe)`).
   - **→ allowed.** Short-circuit on first `true` in a union.

OpenFGA returns:

```json
{ "allowed": true }
```

The other union children (`can_use`, `can_manage`, `owner`) are never evaluated because the union already returned `true`.

### Step 4 — BFF gets the boolean

`tupleAllowed()` returns `true`, `requireResourcePermission` doesn't throw, and the BFF proceeds to call `dynamic-agents` to actually probe the server.

If Bob were not in `organization:caipe` and the server were not shared with any team he belongs to, every child of the union would have evaluated to `false`, OpenFGA would have returned `{"allowed": false}`, and the BFF would have responded with `403 mcp_server#discover` (with the `pdp_denied` reason code).

---

## 5. Why this matters operationally

A few consequences of evaluating unions at check time instead of materializing them:

1. **You change policy by editing the model, not by rewriting tuples.** When the Probe button gate was downgraded from `can_invoke` to `can_discover`, no migrations or tuple rewrites were needed — every user who already had any of `reader` / `user` / `invoker` / `manager` / `owner` (or any usersetted variant) instantly got access. That is only possible because the union is computed, not stored.

2. **Storage stays bounded.** Without computed unions you would need `O(atoms × derived relations)` rows. With computed unions you store only the atoms, so adding a new derived relation like `can_audit` or `can_share` is free in storage cost.

3. **Debugging requires both layers.**
   - To see what `can_<X>` is *defined as*, read the model: `fga model get` (or look at `charts/ai-platform-engineering/charts/openfga/authorization-model.json`).
   - To see what atoms exist, read tuples: `fga tuple read --user user:bob-sub` or `fga tuple read --object mcp_server:argocd`.
   - To see *which* userset path OpenFGA actually followed for a decision, use `fga query check --explain` or the Admin → Security & Policy → OpenFGA graph in the CAIPE UI.

4. **Performance.** Every gate at the BFF is one HTTP round-trip to OpenFGA. OpenFGA's evaluator is fast (it caches model resolution and uses efficient userset expansion), but it is a real network call. That is why list-style routes in the BFF call `filterResourcesByPermission` (in `ui/src/lib/rbac/resource-authz.ts`) and batch the per-row checks with `Promise.all` rather than running them sequentially.

5. **Audit trails describe leaves, not unions.** When you read OpenFGA via the Admin UI you will only ever see the atoms. If a user complains "why can I see this server?" the answer is always traceable to a *stored* tuple — most often a team membership, organization role, or channel grant — never to a `can_*` row.

---

## 6. Compact request flow diagram

```text
Browser
  │
  │  POST /api/mcp-servers/probe?id=argocd
  ▼
Next.js BFF — ui/src/app/api/mcp-servers/probe/route.ts
  │
  │  requireResourcePermission(session, {
  │    type:   "mcp_server",
  │    id:     "argocd",
  │    action: "discover"
  │  })
  │
  │  ────────────────────────────────────────────────────────────────────
  │  This step is just a translator. No policy logic runs in the BFF:
  │    action "discover"   →  relation "can_discover"
  │    {type, id}          →  object   "mcp_server:argocd"
  │    session.sub         →  user     "user:bob-sub"
  │  ────────────────────────────────────────────────────────────────────
  │
  │  POST http://openfga:8080/stores/<id>/check
  │    { "tuple_key": { "user", "relation": "can_discover", "object" } }
  ▼
OpenFGA server
  │
  │  Loads the authorization model (defines can_discover = can_read = union(...))
  │  Walks the rule tree; consults only the stored atom tuples
  │  Short-circuits on the first true child of any union
  │  Returns { "allowed": true } or { "allowed": false }
  │
  ▼
BFF receives boolean → proceeds (200) or denies (403 mcp_server#discover)
```

---

## 7. Quick reference for the rest of the model

The same pattern applies to every resource type in CAIPE. The atoms you write are always one of these direct relations (the names vary slightly per type):

| Resource type | Atom relations the BFF writes | Computed relations OpenFGA evaluates |
| --- | --- | --- |
| `agent` | `owner`, `user`, `manager` | `can_discover`, `can_read`, `can_use`, `can_manage`, `can_delete` |
| `mcp_server` | `owner`, `reader`, `user`, `invoker`, `manager`, `auditor` | `can_discover`, `can_read`, `can_use`, `can_invoke`, `can_manage`, `can_audit`, `can_delete` |
| `tool` | `reader`, `user`, `caller`, `manager`, `auditor` | `can_discover`, `can_read`, `can_use`, `can_call`, `can_manage`, `can_audit` |
| `knowledge_base` | `owner`, `reader`, `ingestor`, `manager` | `can_discover`, `can_read`, `can_ingest`, `can_manage` |
| `skill` | `owner`, `reader`, `user`, `manager` | `can_discover`, `can_read`, `can_use`, `can_manage` |
| `llm_model` | `owner`, `reader`, `manager` | `can_discover`, `can_read`, `can_write`, `can_manage`, `can_delete` |
| `admin_surface` | (direct user/team grants only) | `can_read`, `can_manage` |
| `system_config` | `manager` | `can_manage` |

For the full picture, see [`architecture.md`](./architecture.md) and the resource catalog in `ui/src/lib/rbac/resource-catalog.ts`.

---

## 8. Source-of-truth pointers

- Authorization model: `charts/ai-platform-engineering/charts/openfga/authorization-model.json`
- BFF gate helper: `ui/src/lib/rbac/resource-authz.ts`
- OpenFGA HTTP client: `ui/src/lib/rbac/openfga.ts`
- Atom-tuple builders for owned resources: `ui/src/lib/rbac/openfga-owned-resources.ts`
- Resource-action mapping: `ui/src/lib/rbac/resource-model.ts`
- The example route in this doc: `ui/src/app/api/mcp-servers/probe/route.ts`

For the higher-level CAIPE-wide RBAC story, start at [`index.md`](./index.md) and the [architecture](./architecture.md), [workflows](./workflows.md), and [file map](./file-map.md) docs.
