---
sidebar_position: 5
---

# Selection controls

Choose a control from the data contract. Screen location is not a reason to
create another picker.

## Decision table

| Data contract | Canonical control | Use it when |
|---|---|---|
| Small static enum or value set | `Select` | The list is short, already available, and search adds no value. It is native-backed for browser type-ahead, mobile pickers, forms, and keyboard behavior. |
| Searchable local entity | A thin adapter over `SearchablePicker` | Options have stable IDs and labels and can become difficult to scan. Feature screens consume adapters such as `AgentPicker` or `TeamPicker`. |
| Async or paginated entity | Domain loader + thin `SearchablePicker` adapter | The API owns search, pagination, deduplication, or authorization filtering. The adapter passes loading, error, empty, and load-more state to the base control. |
| Multi-select value set | `MultiSelect` | Values are plain strings and the parent owns the complete option list. |
| Multi-select team set | `TeamMultiPicker` | Team slugs are persisted and names are presentation data. |
| Permission or access subject | `AccessSubjectPicker` or `AccessSubjectMultiPicker` | User/team kinds, implicit access, remote user search, or per-kind limits affect selection. |
| Free text or a specialized command surface | A focused domain control | Users create values, invoke commands, browse a hierarchy, or need interaction that is not a list selection. Document why the shared contracts do not fit. |

Do not add feature flags to a shared picker for domain labels, endpoints,
permissions, or persistence shapes. Keep those concerns in the adapter.

## Shared contract

### Accessibility and focus

- Give every trigger an accessible name through a visible `<label>` or
  `ariaLabel`.
- Searchable single-select triggers expose `combobox`, `aria-expanded`,
  `aria-controls`, invalid, described-by, required, and disabled state.
- Opening a searchable picker focuses its search field.
- Arrow keys skip disabled options. `Home` and `End` move to the bounds.
  `Enter` selects. `Escape` closes and returns focus to the trigger.
- Options expose `listbox` / `option`, `aria-selected`, and disabled state.
- A required selection has no clear action. Optional controls use a real
  sibling button for clear actions; do not nest an interactive element in a
  trigger button.
- Multi-select options remain keyboard-reachable and expose
  `aria-multiselectable`.

### Data and asynchronous state

- The base control renders options; it does not fetch them.
- The domain loader owns authorization filters, server search, pagination,
  page deduplication, cancellation, and response validation.
- Preserve the current selection when another page loads or an entity is no
  longer returned. Adapters decide how a stale value is labeled.
- Use explicit loading, error, retry, empty, loading-more, and disabled states.
  An empty response is not an error.
- `onLoadMore` requests one page. The parent prevents concurrent requests and
  updates `hasMore` from the API response.

The Dynamic Agents loader in `ui/src/lib/dynamic-agent-list.ts` and
`AgentPicker` are the reference paginated adapter pattern. `TeamPicker` keeps
team slug, record-ID compatibility, and labels outside the generic base.

## Test contract

Shared interaction behavior belongs beside the shared component:

- `components/ui/__tests__/select.test.tsx` owns native select behavior.
- `components/ui/__tests__/searchable-picker.test.tsx` owns search, keyboard,
  focus, accessibility, status, and pagination affordances.
- `components/ui/popover.test.tsx` owns shared open/close, trigger, and portal
  mechanics.
- `components/ui/__tests__/team-picker.test.tsx` owns team identity mapping,
  multi-selection grouping, stale values, and domain limits.
- `e2e/rbac/selection-controls.spec.ts` owns browser-only dialog portal,
  focus, and scrolling integration.
- Domain-adapter tests cover only ID mapping, labels, stale values, and
  domain-specific limits.
- Feature unit and Playwright tests cover feature outcomes: the request sent,
  value persisted, authorization applied, or workflow completed.

Do not repeat shared search, arrow-key, focus, clear, option-rendering, or
page-loading assertions in every feature screen. Use a picker as part of a
feature test only when making the selection is required to reach the feature
outcome.

## Inventory

The `origin/main` snapshot at `6139fb6e4` contained 62 direct native-select
instances across 37 production files. This first bounded migration moves the
six repeated sharing and user-filter enums to `Select`, replaces the custom
provider listbox with a native-backed adapter, and consolidates the duplicated
single-entity behavior in `AgentPicker`, `TeamPicker`, and the Slack
service-account adapter. The bounded migration leaves 56 direct instances
across 35 production files for later contract-specific work.

### Direct native selects by contract

| Contract | Current sites |
|---|---|
| Small static enum/value | Sharing permission; audit status, range, and outcome; role/relation; source, visibility, schedule, severity, page-size, webhook, crawl, and error-handling controls. |
| Entity or resource | Bot, workflow, repository, identity provider, model, secret, provider connection, collection, agent tool/namespace, and Access Explorer resource controls. These require a bounded migration if the list can grow. |
| Schema-driven value | Chat metadata, skill inputs, middleware parameters, and RAG filter keys. Keep native-backed behavior when the schema guarantees a small set; use a domain adapter when it does not. |

Current direct-native files:

<details>
<summary>Show the inventory</summary>

- `ui/src/app/(app)/admin/page.tsx`
- `ui/src/app/(app)/skills/scan-history/page.tsx`
- `ui/src/components/admin/UnlinkedServiceAccountModal.tsx`
- `ui/src/components/admin/rebac/ConnectorAdminPanel.tsx`
- `ui/src/components/admin/rebac/ConnectorOnboardingWizard.tsx`
- `ui/src/components/admin/rebac/WebexBotMigrationPanel.tsx`
- `ui/src/components/admin/rebac/WebexDirectUsersPanel.tsx`
- `ui/src/components/admin/rebac/slack/SlackConfiguredChannelDetail.tsx`
- `ui/src/components/admin/security/AccessExplorerTab.tsx`
- `ui/src/components/admin/security/AuditLogsTab.tsx`
- `ui/src/components/admin/security/UnifiedAuditTab.tsx`
- `ui/src/components/admin/settings/ImportRagSourcesFromConfigCard.tsx`
- `ui/src/components/admin/settings/ReviewConfigEditor.tsx`
- `ui/src/components/admin/teams/GroupRoleMappingDialog.tsx`
- `ui/src/components/admin/teams/IdentitySyncPanel.tsx`
- `ui/src/components/admin/teams/TeamDetailsDialog.tsx`
- `ui/src/components/autonomous/TaskFormDialog.tsx`
- `ui/src/components/chat/MetadataInputForm.tsx`
- `ui/src/components/credentials/OAuthConnectorAdminPanel.tsx`
- `ui/src/components/dynamic-agents/ConversationsTab.tsx`
- `ui/src/components/dynamic-agents/DynamicAgentEditor.tsx`
- `ui/src/components/dynamic-agents/DynamicAgentsTab.tsx`
- `ui/src/components/dynamic-agents/InterruptConfigPicker.tsx`
- `ui/src/components/dynamic-agents/MCPServerEditor.tsx`
- `ui/src/components/dynamic-agents/MiddlewarePicker.tsx`
- `ui/src/components/dynamic-agents/SkillsSelector.tsx`
- `ui/src/components/layout/WorkspaceNavigation.tsx`
- `ui/src/components/rag/IngestView.tsx`
- `ui/src/components/rag/IngestionSourceForm.tsx`
- `ui/src/components/rag/MCPToolsView.tsx`
- `ui/src/components/rag/SearchView.tsx`
- `ui/src/components/skills/SkillsRunner.tsx`
- `ui/src/components/skills/TrySkillsGateway.tsx`
- `ui/src/components/workflows/WorkflowSidebar.tsx`
- `ui/src/components/workflows/WorkflowStepSidebar.tsx`

</details>

### Searchable and custom controls

| Group | Inventory |
|---|---|
| Shared bases | `Select`, `SearchablePicker`, `MultiSelect`, and `Popover`. |
| Thin entity adapters | `AgentPicker`, `TeamPicker`, `ProviderSelect`, and the Slack `ServiceAccountSelect`. |
| Domain multi-select | `TeamMultiPicker` preserves team slugs, stale subjects, compact chips, and per-screen selection limits. |
| Permission adapter | `AccessSubjectPicker` and `AccessSubjectMultiPicker`. |
| Specialized async controls | ReBAC principal search, application navigation search, Slack emoji search, and chat share-subject search. Keep their domain loading behavior local; reuse the base interaction where their contract permits. |
| Structured multi-pickers | Dynamic-agent tools, skills, middleware, data sources, subagents, and workflow tools. These select structured configuration rather than one entity value and remain domain components. |

The targeted team and agent migrations already present on `main` remain the
pattern:

- Agent catalogs use the paginated loader and `AgentPicker`.
- Datasource ownership and search access use `TeamPicker` /
  `TeamMultiPicker`; short permission enums stay native-backed.
- ReBAC principal search remains specialized because it combines multiple
  subject kinds and accepts canonical subject references.

## Review checklist

- Identify the data contract in the decision table.
- Reuse an existing adapter before importing a base control.
- Keep API, authorization, pagination, and labels outside the base.
- Cover shared interaction once in `components/ui/__tests__`.
- Test only the consuming feature outcome outside the shared suite.
- Explain any new custom selection surface in the pull request.
