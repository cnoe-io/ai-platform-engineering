import type {
ItemAgentRoute,
RouteEscalationConfig,
RouteSideConfig,
SlackRouteExecutionIdentity,
} from "../connector-admin-adapter";

export type ListenMode = "message" | "mention" | "all";
export const DEFAULT_OVERTHINK_SKIP_MARKERS = "DEFER, LOW_CONFIDENCE";

export interface RouteSideDraft {
  enabled: boolean;
  listen: ListenMode;
  allowList: string[];
  overthinkEnabled: boolean;
  overthinkSkipMarkers: string;
  overthinkFollowupPrompt: string;
}

export interface RouteEscalationDraft {
  victoropsEnabled: boolean;
  victoropsTeam: string;
  emojiEnabled: boolean;
  emojiName: string;
  users: string[];
  deleteAdmins: string[];
}

export interface RouteDraft {
  agentId: string;
  priority: number;
  usersEnabled: boolean;
  botsEnabled: boolean;
  users: RouteSideDraft;
  bots: RouteSideDraft;
  escalationEnabled: boolean;
  escalation: RouteEscalationDraft;
  /** Execution identity for this route. Defaults to obo_user when not set. */
  executionMode: "obo_user" | "service_account";
  /** SA sub — only relevant when executionMode === "service_account". */
  executionServiceAccountSub: string;
  /** Display name cache — only relevant when executionMode === "service_account". */
  executionServiceAccountName: string;
}

export function splitList(value: string): string[] {
  return Array.from(new Set(value.split(",").map((v) => v.trim()).filter(Boolean)));
}

export function joinList(value: string[] | undefined): string {
  return (value ?? []).join(", ");
}

export function emptySideDraft(listen: ListenMode = "mention"): RouteSideDraft {
  return {
    enabled: false,
    listen,
    allowList: [],
    overthinkEnabled: false,
    overthinkSkipMarkers: DEFAULT_OVERTHINK_SKIP_MARKERS,
    overthinkFollowupPrompt: "",
  };
}

export function emptyRouteDraft(): RouteDraft {
  return {
    agentId: "",
    priority: 100,
    usersEnabled: true,
    botsEnabled: false,
    users: { ...emptySideDraft("mention"), enabled: true },
    bots: emptySideDraft("message"),
    escalationEnabled: false,
    escalation: {
      victoropsEnabled: false,
      victoropsTeam: "",
      emojiEnabled: false,
      emojiName: "eyes",
      users: [],
      deleteAdmins: [],
    },
    executionMode: "obo_user",
    executionServiceAccountSub: "",
    executionServiceAccountName: "",
  };
}

function sideToDraft(
  side: RouteSideConfig | undefined,
  fallbackListen: ListenMode,
  listKey: "user_list" | "bot_list",
): RouteSideDraft {
  if (!side) return emptySideDraft(fallbackListen);
  return {
    enabled: side.enabled !== false,
    listen: side.listen ?? fallbackListen,
    allowList: side[listKey] ?? [],
    overthinkEnabled: Boolean(side.overthink?.enabled),
    overthinkSkipMarkers: joinList(side.overthink?.skip_markers) || DEFAULT_OVERTHINK_SKIP_MARKERS,
    overthinkFollowupPrompt: side.overthink?.followup_prompt ?? "",
  };
}

export function routeToDraft(route: ItemAgentRoute): RouteDraft {
  const esc = route.escalation;
  const eid = route.execution_identity;
  const executionMode = eid?.mode === "service_account" ? "service_account" : "obo_user";
  return {
    agentId: route.agent_id,
    priority: route.priority ?? 100,
    usersEnabled: route.users ? route.users.enabled !== false : true,
    botsEnabled: route.bots ? route.bots.enabled !== false : false,
    users: sideToDraft(route.users, "mention", "user_list"),
    bots: sideToDraft(route.bots, "message", "bot_list"),
    escalationEnabled: Boolean(
      esc && (esc.victorops?.enabled || esc.emoji?.enabled || (esc.users?.length ?? 0) > 0 || (esc.delete_admins?.length ?? 0) > 0),
    ),
    escalation: {
      victoropsEnabled: Boolean(esc?.victorops?.enabled),
      victoropsTeam: esc?.victorops?.team ?? "",
      emojiEnabled: Boolean(esc?.emoji?.enabled),
      emojiName: esc?.emoji?.name ?? "eyes",
      users: esc?.users ?? [],
      deleteAdmins: esc?.delete_admins ?? [],
    },
    executionMode,
    executionServiceAccountSub: eid?.service_account_sub ?? "",
    executionServiceAccountName: eid?.service_account_name ?? "",
  };
}

function sideDraftToConfig(draft: RouteSideDraft, enabled: boolean, listKey: "user_list" | "bot_list"): RouteSideConfig {
  const list = draft.allowList;
  const overthink = draft.overthinkEnabled || draft.overthinkSkipMarkers || draft.overthinkFollowupPrompt
    ? {
        enabled: draft.overthinkEnabled,
        ...(splitList(draft.overthinkSkipMarkers).length > 0 ? { skip_markers: splitList(draft.overthinkSkipMarkers) } : {}),
        ...(draft.overthinkFollowupPrompt.trim() ? { followup_prompt: draft.overthinkFollowupPrompt.trim() } : {}),
      }
    : undefined;
  return {
    enabled,
    listen: draft.listen,
    ...(list.length > 0 ? { [listKey]: list } : {}),
    ...(overthink ? { overthink } : {}),
  };
}

/** Route shape sent to the BFF — extends ItemAgentRoute with the execution_identity field. */
export type DraftRoutePayload = ItemAgentRoute & { execution_identity?: SlackRouteExecutionIdentity };

export function draftToRoute(draft: RouteDraft): DraftRoutePayload {
  const esc = draft.escalation;
  const escalationUsers = esc.users;
  const deleteAdmins = esc.deleteAdmins;
  const escalation: RouteEscalationConfig | undefined = draft.escalationEnabled
    ? {
        ...(esc.victoropsEnabled || esc.victoropsTeam
          ? { victorops: { enabled: esc.victoropsEnabled, ...(esc.victoropsTeam.trim() ? { team: esc.victoropsTeam.trim() } : {}) } }
          : {}),
        ...(esc.emojiEnabled ? { emoji: { enabled: true, ...(esc.emojiName.trim() ? { name: esc.emojiName.trim() } : {}) } } : {}),
        ...(escalationUsers.length > 0 ? { users: escalationUsers } : {}),
        ...(deleteAdmins.length > 0 ? { delete_admins: deleteAdmins } : {}),
      }
    : undefined;

  // Build execution_identity — always include it so BFF stores the explicit choice.
  const execution_identity: SlackRouteExecutionIdentity =
    draft.executionMode === "service_account" && draft.executionServiceAccountSub.trim()
      ? {
          mode: "service_account",
          service_account_sub: draft.executionServiceAccountSub.trim(),
          ...(draft.executionServiceAccountName.trim()
            ? { service_account_name: draft.executionServiceAccountName.trim() }
            : {}),
        }
      : { mode: "obo_user" };

  return {
    agent_id: draft.agentId.trim(),
    enabled: true,
    priority: draft.priority,
    users: sideDraftToConfig(draft.users, draft.usersEnabled, "user_list"),
    ...(draft.botsEnabled ? { bots: sideDraftToConfig(draft.bots, true, "bot_list") } : {}),
    ...(escalation && Object.keys(escalation).length > 0 ? { escalation } : {}),
    execution_identity,
  };
}

export function routeDraftErrorMap(draft: RouteDraft): Record<string, string> {
  const errors: Record<string, string> = {};
  if (!draft.agentId.trim()) errors.agentId = "Choose a Dynamic Agent.";
  if (!Number.isFinite(draft.priority)) errors.priority = "Priority must be a valid number.";
  if (draft.executionMode === "service_account" && !draft.executionServiceAccountSub.trim()) {
    errors.executionServiceAccountSub = "Choose a service account.";
  }
  if (!draft.usersEnabled && !draft.botsEnabled) errors.responding = "Enable users, bots, or both.";
  if (draft.usersEnabled && draft.users.overthinkEnabled && splitList(draft.users.overthinkSkipMarkers).length === 0) {
    errors.usersSkipMarkers = "Skip markers cannot be empty.";
  }
  if (draft.botsEnabled && draft.bots.overthinkEnabled && splitList(draft.bots.overthinkSkipMarkers).length === 0) {
    errors.botsSkipMarkers = "Skip markers cannot be empty.";
  }
  if (draft.escalationEnabled) {
    const esc = draft.escalation;
    const hasVictorops = esc.victoropsEnabled || esc.victoropsTeam.trim();
    const hasEmoji = esc.emojiEnabled || esc.emojiName.trim();
    const hasUsers = esc.users.length > 0;
    const hasDeleteAdmins = esc.deleteAdmins.length > 0;
    if (!hasVictorops && !hasEmoji && !hasUsers && !hasDeleteAdmins) errors.escalation = "Configure at least one escalation action, or turn Escalation off.";
    if (esc.victoropsEnabled && !esc.victoropsTeam.trim()) errors.victoropsTeam = "VictorOps team is required.";
    if (esc.emojiEnabled && !esc.emojiName.trim()) errors.emojiName = "Emoji name is required.";
  }
  return errors;
}
