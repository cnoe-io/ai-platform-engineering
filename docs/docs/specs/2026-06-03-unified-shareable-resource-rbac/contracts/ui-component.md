# Contract: `<TeamOwnershipFields>` UI Component

React/TypeScript, in `ui/src/components/` (shared location, e.g.
`components/rbac/` or `components/ui/`). Extracted from the proven controls in
`DynamicAgentEditor`. Mountable in any resource editor (agent, datasource, MCP
tool).

## U1. Props

```ts
interface TeamOwnershipFieldsProps {
  // current values
  ownerTeamSlug: string;
  sharedTeamSlugs: string[];
  creatorSubject?: string | null;   // shown read-only for provenance

  // mode
  isEditing: boolean;               // disables owner picker (immutable) unless transfer
  allowTransfer?: boolean;          // shows a "Transfer ownership" affordance

  // data
  availableTeams: TeamPickerOption[];
  currentUserTeamSlugs: string[];   // to detect "not a member of destination"

  // callbacks
  onOwnerTeamChange: (slug: string) => void;
  onSharedTeamsChange: (slugs: string[]) => void;
  onTransfer?: (newOwnerSlug: string, confirmedNotMember: boolean) => void;

  disabled?: boolean;
}
```

## U2. Behavior

1. **Owner picker** (`TeamPicker`): enabled on create; **disabled on edit**
   unless `allowTransfer` and the user invokes the transfer affordance.
2. **Share multi-select** (`TeamMultiPicker`): always editable; the owner team is
   visually marked and not independently removable from sharing (it is implied).
3. **Effective-access preview**: renders the exact grants that will be written —
   owner team + each shared team, with the per-type relations — mirroring the
   agent editor's "on save, these grants will be written" callout. This is a
   transparency requirement, not decorative.
4. **Transfer confirmation**: when a transfer targets a team where
   `!currentUserTeamSlugs.includes(newOwnerSlug)`, the component MUST require an
   explicit confirmation ("You are not a member of this team. Transferring may
   remove your own access.") before calling `onTransfer(..., true)` (FR-015).
5. **Creator display**: `creator_subject`, when present, is shown read-only as
   provenance and is never editable.

## U3. Save semantics

The component is **controlled** and does not itself persist — the host editor
saves with an explicit button (consistent with the agent editor and the prior
button-save decision). No auto-save.

## U4. Reuse obligation

`DynamicAgentEditor`, the datasource editor (`IngestView` / `KbSharingPanel`),
and the MCP tool dialog (`ToolFormDialog` in `MCPToolsView`) all consume this
single component. `KbSharingPanel` already implements most of this UX; it is
refactored to render `<TeamOwnershipFields>` rather than duplicating it.
