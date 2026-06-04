# Quickstart: Adding Group-Based Access Control to a New Resource

This is the payoff of the shared module (User Story 1). Once it exists, giving a
**new** platform resource full group-based access control — owner team,
share-with-teams, revoke-on-unshare, effective-access preview, ownership
transfer, and enforcement — is four composition steps plus one model block. No
bespoke reconciler, route plumbing, or persistence logic.

## Worked example: a hypothetical `prompt_library` resource

### Step 1 — Add the model template block

In `deploy/openfga/model.fga` (and the chart JSON in lockstep), paste the
canonical shareable template and adjust the extension points:

```
type prompt_library
  relations
    define creator: [user]                         # audit-only
    define owner: [user, service_account]
    define reader: [user, service_account, team#member, team#admin, external_group#member]
    define manager: [user, service_account, team#admin, organization#admin]
    define auditor: [user, service_account, team#admin]
    define can_discover: can_read
    define can_read: reader or can_manage or owner
    define can_manage: manager or owner
    define can_delete: can_manage
    define can_audit: auditor or can_manage
```

The drift check (contract C5) verifies `creator` is present and unused in
`can_*`.

### Step 2 — Inherit the persistence mixin

```python
class PromptLibraryConfig(OwnedResourceMixin, BaseModel):
    library_id: str
    # ... domain fields ...
    # creator_subject / owner_subject / owner_team_slug / shared_with_teams
    # come from the mixin
```

### Step 3 — Mount the UI control bundle

```tsx
<TeamOwnershipFields
  ownerTeamSlug={ownerTeamSlug}
  sharedTeamSlugs={sharedTeamSlugs}
  creatorSubject={creatorSubject}
  isEditing={isEditing}
  allowTransfer
  availableTeams={availableTeams}
  currentUserTeamSlugs={currentUserTeamSlugs}
  onOwnerTeamChange={setOwnerTeamSlug}
  onSharedTeamsChange={setSharedTeamSlugs}
  onTransfer={handleTransfer}
/>
```

### Step 4 — Call the route helper on write

```ts
const { reconcile, ownerTeamSlug, sharedTeamSlugs } =
  await handleShareableResourceWrite({
    objectType: "prompt_library",
    objectId: id,
    session,
    requestedOwnerTeamSlug,
    requestedSharedTeamSlugs,
    loadPrevious: () => loadPromptLibraryOwnership(id),
    persist: (next) => persistPromptLibraryOwnership(id, next),
    allowOwnerTransfer: isTransferRequest,
  });
```

That is the whole integration. Enforcement (`can_read` / `can_manage` /
`can_call`) is then a standard `requireResourcePermission` check at the resource's
routes, exactly as for agents.

---

## Verifying the existing-resource migration (RAG)

1. Grant a team `read` on a knowledge base via the sharing UI.
2. As a member of that team, query the corresponding data source — it should
   return results (inheritance via `parent_kb`).
3. As a non-member, query it — denied.
4. Confirm no `team:<slug>#member reader data_source:<id>` tuple was written
   (inheritance only).

## Verifying MCP tool parity

1. Create a custom MCP tool with owner team A; share with team B.
2. As a member of A or B, invoke the tool → allowed.
3. As a non-member, invoke → denied at the BFF `can_call` gate.
4. Delete the tool → confirm no residual `mcp_tool:<id>` tuples.

## Verifying transfer + provenance

1. Create a resource as user U in team A (creator = U).
2. Transfer to team B as a team-A admin; confirm the not-a-member prompt if U is
   not in B.
3. Confirm team A loses management grants, team B gains them.
4. Confirm `user:U creator <type>:<id>` is still present (audit), and U has no
   management authority unless U is a team-B admin.

## Local development

With reconciliation disabled/bypassed (local dev), the config fields still
populate and the UI shows correct owner/shared state without OpenFGA. The
dev-auth gates remain production-safe (NODE_ENV + the three default-false flags).
