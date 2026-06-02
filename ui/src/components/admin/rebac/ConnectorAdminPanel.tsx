"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { ChevronRight, FileUp, HelpCircle, RefreshCw, RotateCw, Settings2 } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useToast } from "@/components/ui/toast";
import { AgentPicker, type AgentPickerOption } from "@/components/ui/agent-picker";
import { TeamPicker, type TeamPickerOption } from "@/components/ui/team-picker";
import { PromptEditorWorkbench, type PromptSuggestRequest } from "@/components/prompt/PromptEditorWorkbench";
import { cn } from "@/lib/utils";
import { ConnectorOnboardingWizard } from "./ConnectorOnboardingWizard";
import type {
  ConnectorAdminAdapter,
  DiagnosticRoute,
  DiscoveredItem,
  ItemAgentRoute,
  ItemDiagnostics,
  ItemSummary,
  RouteEscalationConfig,
  RouteSideConfig,
  RuntimeStatus,
  RuntimeSyncSummary,
  SyncPreviewAgent,
  SyncPreviewChannel,
} from "./connector-admin-adapter";

interface DynamicAgentOption { _id: string; name: string; model?: { id?: string; provider?: string } }
interface TeamOption { _id?: string; id?: string; slug: string; name: string }

type PanelView = "channels" | "onboard" | "advanced";
type SyncModalMode = "preview" | "apply";
type SyncModalStatus = "idle" | "loading" | "success" | "error";
type ListenMode = "message" | "mention" | "all";
const DEFAULT_OVERTHINK_SKIP_MARKERS = "DEFER, LOW_CONFIDENCE";

// Full editable draft of an agent route. Carries every YAML/DB field so the
// editor is a complete round-trip: editing a route imported from YAML no
// longer silently drops its bots/overthink/escalation config.
interface RouteSideDraft {
  enabled: boolean;
  listen: ListenMode;
  allowList: string; // comma/space/newline-separated user_list or bot_list
  overthinkEnabled: boolean;
  overthinkSkipMarkers: string; // comma-separated
  overthinkFollowupPrompt: string;
}
interface RouteEscalationDraft {
  victoropsEnabled: boolean;
  victoropsTeam: string;
  emojiEnabled: boolean;
  emojiName: string;
  users: string; // comma/space/newline-separated
  deleteAdmins: string;
}
interface RouteDraft {
  agentId: string;
  priority: number;
  usersEnabled: boolean;
  botsEnabled: boolean;
  users: RouteSideDraft;
  bots: RouteSideDraft;
  escalationEnabled: boolean;
  escalation: RouteEscalationDraft;
}

interface SlackUserSuggestion {
  id: string;
  label: string;
  name?: string;
  display_name?: string;
  real_name?: string;
  avatar?: string;
  is_bot?: boolean;
}
interface SlackEmojiSuggestion {
  name: string;
  url?: string;
  alias_for?: string;
}

function HelpTooltip({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          aria-label={`Help: ${label}`}
          className="inline-flex h-4 w-4 items-center justify-center rounded-full text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <HelpCircle className="h-3.5 w-3.5" aria-hidden="true" />
        </button>
      </TooltipTrigger>
      <TooltipContent side="top" className="max-w-xs whitespace-normal break-words text-xs">
        {children}
      </TooltipContent>
    </Tooltip>
  );
}

function RuntimeTile({
  label,
  description,
  children,
}: {
  label: string;
  description: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-md border bg-background/60 p-3">
      <div className="flex items-center gap-1 text-xs text-muted-foreground">
        <span>{label}</span>
        <HelpTooltip label={label}>{description}</HelpTooltip>
      </div>
      {children}
    </div>
  );
}

function AdvancedActionButton({
  label,
  description,
  icon,
  onClick,
  disabled,
  variant = "outline",
}: {
  label: string;
  description: React.ReactNode;
  icon: React.ReactNode;
  onClick: () => void;
  disabled?: boolean;
  variant?: React.ComponentProps<typeof Button>["variant"];
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button type="button" variant={variant} onClick={onClick} disabled={disabled}>
          {icon}
          {label}
          <HelpCircle className="h-3.5 w-3.5 text-muted-foreground" aria-hidden="true" />
        </Button>
      </TooltipTrigger>
      <TooltipContent side="top" className="max-w-xs whitespace-normal break-words text-xs">
        {description}
      </TooltipContent>
    </Tooltip>
  );
}

function RouteEditorSection({
  title,
  description,
  enabled,
  onToggle,
  disabled,
  children,
}: {
  title: string;
  description?: React.ReactNode;
  enabled?: boolean;
  onToggle?: (value: boolean) => void;
  disabled?: boolean;
  children: React.ReactNode;
}) {
  const hasToggle = typeof enabled === "boolean" && onToggle;
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-1.5 text-sm font-medium">
          <span>{title}</span>
          {description && <HelpTooltip label={title}>{description}</HelpTooltip>}
        </div>
        {hasToggle && (
          <label className="flex items-center gap-2 text-xs text-muted-foreground">
            <input
              type="checkbox"
              checked={enabled}
              disabled={disabled}
              onChange={(event) => onToggle(event.target.checked)}
            />
            Enabled
          </label>
        )}
      </div>
      {(!hasToggle || enabled) && <div className="space-y-3">{children}</div>}
    </div>
  );
}

function FollowupPromptEditor({
  value,
  onChange,
  disabled,
  channelName,
  agentId,
  model,
}: {
  value: string;
  onChange: (value: string) => void;
  disabled: boolean;
  channelName?: string;
  agentId?: string;
  model?: { id?: string; provider?: string };
}) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(value);

  const suggest = async ({ instruction, enhanceExisting, style }: PromptSuggestRequest) => {
    if (!model?.id || !model.provider) return;
    const res = await fetch("/api/dynamic-agents/assistant/suggest", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        field: "slack_followup_prompt",
        context: {
          name: agentId ? `Slack route for ${agentId}` : "Slack route",
          slack_channel_name: channelName,
          slack_agent_id: agentId,
          ...(enhanceExisting && draft.trim() ? { followup_prompt: draft } : {}),
        },
        model: { id: model.id, provider: model.provider },
        ...(instruction ? { instruction } : {}),
        prompt_style: style,
      }),
    });
    const payload = await res.json();
    if (!res.ok || !payload.success) {
      throw new Error(payload?.error || "Failed to generate follow-up prompt");
    }
    return payload.data?.content ?? payload.content;
  };

  return (
    <div className="space-y-1.5">
      <div className="flex items-center gap-1.5">
        <Label>Follow-up prompt</Label>
        <HelpTooltip label="Follow-up prompt">
          Used after overthink skips a Slack reply. If a user later explicitly follows up in that thread, this text is prepended to the agent context so it can answer with the earlier skipped reasoning in mind.
        </HelpTooltip>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border bg-background px-3 py-2">
        <div className="min-w-0 text-sm">
          {value.trim() ? (
            <span className="line-clamp-1 text-muted-foreground">{value.trim()}</span>
          ) : (
            <span className="text-muted-foreground">No follow-up prompt configured</span>
          )}
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => {
            setDraft(value);
            setOpen(true);
          }}
          disabled={disabled}
        >
          {value.trim() ? "Edit prompt" : "Write prompt"}
        </Button>
      </div>
      <p className="text-xs text-muted-foreground">
        Optional prompt prepended on humble follow-ups.
      </p>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[90vh] max-w-5xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Edit follow-up prompt</DialogTitle>
            <DialogDescription>
              Write the prompt in a larger editor. AI Suggest will tailor the text for this Slack route.
            </DialogDescription>
          </DialogHeader>
          <PromptEditorWorkbench
            id="slack-followup-prompt"
            label="Follow-up prompt"
            value={draft}
            onChange={setDraft}
            placeholder="When confidence is low, briefly explain uncertainty and ask one clarifying question before proceeding..."
            height={420}
            onSuggest={suggest}
            suggestDisabled={!model?.id || !model.provider}
            suggestTitle={!model?.id || !model.provider ? "Select an agent with model metadata before using AI Suggest" : "Generate follow-up prompt with AI"}
            suggestInstructionLabel="What should this Slack follow-up prompt cover?"
            suggestInstructionPlaceholder="e.g., Ask one clarifying question before escalating..."
          />
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
            <Button
              type="button"
              onClick={() => {
                onChange(draft);
                setOpen(false);
              }}
            >
              Apply prompt
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function SlackUserMultiSelect({
  label,
  value,
  onChange,
  disabled,
  placeholder,
  kind = "all",
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  disabled: boolean;
  placeholder: string;
  kind?: "all" | "bots";
}) {
  const selectedIds = useMemo(() => splitList(value), [value]);
  const [query, setQuery] = useState("");
  const [suggestions, setSuggestions] = useState<SlackUserSuggestion[]>([]);
  const [lookupStatus, setLookupStatus] = useState<"idle" | "searching" | "ready" | "empty" | "error">("idle");
  const [lookupMessage, setLookupMessage] = useState("");
  const [knownUsers, setKnownUsers] = useState<Record<string, SlackUserSuggestion>>({});
  const userLookupEnabled = !disabled && query.trim().length >= 2;

  useEffect(() => {
    const trimmed = query.trim();
    if (!userLookupEnabled) return;
    let cancelled = false;
    const timer = window.setTimeout(() => {
      fetch(`/api/admin/slack/users/lookup?q=${encodeURIComponent(trimmed)}&limit=50${kind === "bots" ? "&kind=bots" : ""}`)
        .then((res) => (res.ok ? res.json() : Promise.reject(new Error("Slack user lookup failed"))))
        .then((payload) => {
          if (cancelled) return;
          const users = (payload?.data?.users ?? payload?.users ?? []) as SlackUserSuggestion[];
          const warming = Boolean(payload?.data?.warming ?? payload?.warming);
          const next = users.filter((user) => !selectedIds.includes(user.id));
          setSuggestions(next);
          setLookupStatus(next.length > 0 ? "ready" : "empty");
          setLookupMessage(warming
            ? "Slack user directory is loading in the background. Try again in a moment."
            : "No Slack users found. Press Enter to add the typed ID manually.");
        })
        .catch(() => {
          if (!cancelled) {
            setSuggestions([]);
            setLookupStatus("error");
            setLookupMessage("Slack user lookup failed. Press Enter to add the typed ID manually.");
          }
        });
    }, 250);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [kind, query, selectedIds, userLookupEnabled]);

  const addUser = (user: SlackUserSuggestion) => {
    setKnownUsers((prev) => ({ ...prev, [user.id]: user }));
    onChange(joinList([...selectedIds, user.id]));
    setQuery("");
    setSuggestions([]);
    setLookupStatus("idle");
    setLookupMessage("");
  };
  const addRawId = (id: string) => {
    onChange(joinList([...selectedIds, id]));
    setQuery("");
    setSuggestions([]);
    setLookupStatus("idle");
    setLookupMessage("");
  };
  const closeLookup = () => {
    setSuggestions([]);
    setLookupStatus("idle");
    setLookupMessage("");
  };
  const removeId = (id: string) => {
    onChange(joinList(selectedIds.filter((candidate) => candidate !== id)));
  };

  return (
    <div className="space-y-1.5">
      <Label>{label}</Label>
      <div className="relative">
        <div
          className={cn(
            "flex min-h-10 w-full flex-wrap items-center gap-1.5 rounded-md border border-input bg-background px-2 py-1.5 text-sm ring-offset-background focus-within:ring-2 focus-within:ring-ring focus-within:ring-offset-2",
            disabled && "cursor-not-allowed opacity-50"
          )}
          onBlur={(event) => {
            if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
              closeLookup();
            }
          }}
        >
          {selectedIds.map((id) => {
            const user = knownUsers[id];
            const display = user ? `${user.label} (${id})` : id;
            return (
              <span
                key={id}
                className="inline-flex items-center gap-1 rounded-full border bg-muted/40 px-2 py-0.5 text-xs"
              >
                {display}
              <button
                type="button"
                className="text-muted-foreground hover:text-foreground"
                onClick={() => removeId(id)}
                disabled={disabled}
                aria-label={`Remove ${id}`}
              >
                ×
              </button>
              </span>
            );
          })}
          <input
            value={query}
            disabled={disabled}
            placeholder={selectedIds.length > 0 ? "Search or paste ID" : placeholder}
            className="min-w-[160px] flex-1 appearance-none border-0 bg-transparent px-1 py-0.5 outline-none ring-0 placeholder:text-muted-foreground focus:outline-none focus:ring-0 focus-visible:outline-none focus-visible:ring-0 disabled:cursor-not-allowed"
            onChange={(event) => {
              const next = event.target.value;
              setQuery(next);
              setSuggestions([]);
              setLookupMessage("");
              setLookupStatus(!disabled && next.trim().length >= 2 ? "searching" : "idle");
            }}
            onKeyDown={(event) => {
              if (event.key === "Enter" && query.trim()) {
                event.preventDefault();
                addRawId(query.trim());
              }
              if (event.key === "Backspace" && !query && selectedIds.length > 0) {
                removeId(selectedIds[selectedIds.length - 1]);
              }
            }}
          />
        </div>
        {userLookupEnabled && lookupStatus !== "idle" && (
          <div
            className="absolute left-0 right-0 top-full z-50 mt-1 max-h-48 overflow-auto rounded-md border bg-popover p-1 text-popover-foreground shadow-lg"
            onMouseDown={(event) => event.preventDefault()}
          >
            {lookupStatus === "searching" && (
              <div className="px-2 py-1.5 text-xs text-muted-foreground">Searching Slack users…</div>
            )}
            {lookupStatus === "empty" && (
              <div className="px-2 py-1.5 text-xs text-muted-foreground">{lookupMessage || "No Slack users found. Press Enter to add the typed ID manually."}</div>
            )}
            {lookupStatus === "error" && (
              <div className="px-2 py-1.5 text-xs text-destructive">{lookupMessage || "Slack user lookup failed. Press Enter to add the typed ID manually."}</div>
            )}
            {lookupStatus === "ready" && suggestions.map((user) => (
              <button
                key={user.id}
                type="button"
                className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-sm hover:bg-muted"
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => addUser(user)}
              >
                {user.avatar && <img src={user.avatar} alt="" className="h-5 w-5 rounded" />}
                <span className="font-medium">{user.label}</span>
                <span className="text-xs text-muted-foreground">({user.id})</span>
              </button>
            ))}
          </div>
        )}
      </div>
      <p className="text-xs text-muted-foreground">Press Enter to add a raw Slack ID if lookup is unavailable.</p>
    </div>
  );
}

function SlackEmojiCombobox({
  value,
  onChange,
  disabled,
  error,
}: {
  value: string;
  onChange: (value: string) => void;
  disabled: boolean;
  error?: string;
}) {
  const [query, setQuery] = useState(value);
  const [suggestions, setSuggestions] = useState<SlackEmojiSuggestion[]>([]);
  const [lookupStatus, setLookupStatus] = useState<"idle" | "searching" | "ready" | "empty" | "error">("idle");
  const [lookupMessage, setLookupMessage] = useState("");

  useEffect(() => {
    setQuery(value);
  }, [value]);

  useEffect(() => {
    const trimmed = query.trim().replace(/^:|:$/g, "");
    if (disabled || trimmed.length < 1) {
      setSuggestions([]);
      return;
    }
    let cancelled = false;
    const timer = window.setTimeout(() => {
      fetch(`/api/admin/slack/emoji?q=${encodeURIComponent(trimmed)}&limit=25`)
        .then((res) => (res.ok ? res.json() : Promise.reject(new Error("Slack emoji lookup failed"))))
        .then((payload) => {
          if (cancelled) return;
          const emoji = (payload?.data?.emoji ?? payload?.emoji ?? []) as SlackEmojiSuggestion[];
          const warming = Boolean(payload?.data?.warming ?? payload?.warming);
          setSuggestions(emoji);
          setLookupStatus(emoji.length > 0 ? "ready" : "empty");
          setLookupMessage(warming
            ? "Slack emoji directory is loading in the background. Try again in a moment."
            : "No Slack emoji found. You can still type a standard reaction name.");
        })
        .catch(() => {
          if (!cancelled) {
            setSuggestions([]);
            setLookupStatus("error");
            setLookupMessage("Slack emoji lookup failed. You can still type a reaction name.");
          }
        });
    }, 200);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [disabled, query]);

  const commit = (next: string) => {
    const normalized = next.trim().replace(/^:|:$/g, "");
    onChange(normalized);
    setQuery(normalized);
    setSuggestions([]);
    setLookupStatus("idle");
    setLookupMessage("");
  };
  const closeLookup = () => {
    setSuggestions([]);
    setLookupStatus("idle");
    setLookupMessage("");
  };

  return (
    <div className="space-y-1.5">
      <Label htmlFor="route-esc-emoji">Emoji name</Label>
      <div className="relative">
        <Input
          id="route-esc-emoji"
          value={query}
          disabled={disabled}
          className={cn(error && "border-destructive focus-visible:ring-destructive")}
          placeholder="eyes"
          onChange={(event) => {
            const next = event.target.value;
            setQuery(next);
            setSuggestions([]);
            setLookupMessage("");
            setLookupStatus(!disabled && next.trim().replace(/^:|:$/g, "").length >= 1 ? "searching" : "idle");
            onChange(next.trim().replace(/^:|:$/g, ""));
          }}
          onBlur={() => {
            commit(query);
            closeLookup();
          }}
        />
        {lookupStatus !== "idle" && (
          <div
            className="absolute left-0 right-0 top-full z-50 mt-1 max-h-48 overflow-auto rounded-md border bg-popover p-1 text-popover-foreground shadow-lg"
            onMouseDown={(event) => event.preventDefault()}
          >
            {lookupStatus === "searching" && (
              <div className="px-2 py-1.5 text-xs text-muted-foreground">Searching Slack emoji…</div>
            )}
            {lookupStatus === "empty" && (
              <div className="px-2 py-1.5 text-xs text-muted-foreground">{lookupMessage || "No Slack emoji found. You can still type a standard reaction name."}</div>
            )}
            {lookupStatus === "error" && (
              <div className="px-2 py-1.5 text-xs text-destructive">{lookupMessage || "Slack emoji lookup failed. You can still type a reaction name."}</div>
            )}
            {lookupStatus === "ready" && suggestions.map((emoji) => (
              <button
                key={emoji.name}
                type="button"
                className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-sm hover:bg-muted"
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => commit(emoji.name)}
              >
                {emoji.url && !emoji.alias_for && <img src={emoji.url} alt="" className="h-5 w-5" />}
                <span className="font-medium">:{emoji.name}:</span>
                {emoji.alias_for && <span className="text-xs text-muted-foreground">alias of :{emoji.alias_for}:</span>}
              </button>
            ))}
          </div>
        )}
      </div>
      {error && <p className="text-xs text-destructive">{error}</p>}
      <p className="text-xs text-muted-foreground">Custom Slack emoji are suggested when available; standard reaction names still work.</p>
    </div>
  );
}

function emptySideDraft(listen: ListenMode = "mention"): RouteSideDraft {
  return { enabled: false, listen, allowList: "", overthinkEnabled: false, overthinkSkipMarkers: DEFAULT_OVERTHINK_SKIP_MARKERS, overthinkFollowupPrompt: "" };
}
function emptyRouteDraft(): RouteDraft {
  return {
    agentId: "", priority: 100,
    usersEnabled: true, botsEnabled: false,
    users: { ...emptySideDraft("mention"), enabled: true },
    bots: emptySideDraft("message"),
    escalationEnabled: false,
    escalation: { victoropsEnabled: false, victoropsTeam: "", emojiEnabled: false, emojiName: "eyes", users: "", deleteAdmins: "" },
  };
}

function splitList(value: string): string[] {
  return Array.from(new Set(value.split(/[\s,]+/).map((v) => v.trim()).filter(Boolean)));
}
function joinList(value: string[] | undefined): string {
  return (value ?? []).join(", ");
}

function sideToDraft(side: RouteSideConfig | undefined, fallbackListen: ListenMode, listKey: "user_list" | "bot_list"): RouteSideDraft {
  if (!side) return emptySideDraft(fallbackListen);
  return {
    enabled: side.enabled !== false,
    listen: side.listen ?? fallbackListen,
    allowList: joinList(side[listKey]),
    overthinkEnabled: Boolean(side.overthink?.enabled),
    overthinkSkipMarkers: joinList(side.overthink?.skip_markers) || DEFAULT_OVERTHINK_SKIP_MARKERS,
    overthinkFollowupPrompt: side.overthink?.followup_prompt ?? "",
  };
}

function routeToDraft(route: ItemAgentRoute): RouteDraft {
  const esc = route.escalation;
  return {
    agentId: route.agent_id,
    priority: route.priority ?? 100,
    usersEnabled: route.users ? route.users.enabled !== false : true,
    botsEnabled: route.bots ? route.bots.enabled !== false : false,
    users: sideToDraft(route.users, "mention", "user_list"),
    bots: sideToDraft(route.bots, "message", "bot_list"),
    escalationEnabled: Boolean(esc && (esc.victorops?.enabled || esc.emoji?.enabled || (esc.users?.length ?? 0) > 0 || (esc.delete_admins?.length ?? 0) > 0)),
    escalation: {
      victoropsEnabled: Boolean(esc?.victorops?.enabled),
      victoropsTeam: esc?.victorops?.team ?? "",
      emojiEnabled: Boolean(esc?.emoji?.enabled),
      emojiName: esc?.emoji?.name ?? "eyes",
      users: joinList(esc?.users),
      deleteAdmins: joinList(esc?.delete_admins),
    },
  };
}

function sideDraftToConfig(draft: RouteSideDraft, enabled: boolean, listKey: "user_list" | "bot_list"): RouteSideConfig {
  const list = splitList(draft.allowList);
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

function draftToRoute(draft: RouteDraft): ItemAgentRoute {
  const esc = draft.escalation;
  const escalationUsers = splitList(esc.users);
  const deleteAdmins = splitList(esc.deleteAdmins);
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
  return {
    agent_id: draft.agentId.trim(),
    enabled: true,
    priority: draft.priority,
    users: sideDraftToConfig(draft.users, draft.usersEnabled, "user_list"),
    ...(draft.botsEnabled ? { bots: sideDraftToConfig(draft.bots, true, "bot_list") } : {}),
    ...(escalation && Object.keys(escalation).length > 0 ? { escalation } : {}),
  };
}

function validateRouteDraft(draft: RouteDraft): string[] {
  const errors: string[] = [];
  if (!draft.agentId.trim()) {
    errors.push("Choose a Dynamic Agent.");
  }
  if (!Number.isFinite(draft.priority)) {
    errors.push("Priority must be a valid number.");
  }
  if (!draft.usersEnabled && !draft.botsEnabled) {
    errors.push("Enable Respond to Users, Respond to Bots, or both.");
  }
  if (draft.usersEnabled && draft.users.overthinkEnabled && splitList(draft.users.overthinkSkipMarkers).length === 0) {
    errors.push("User overthink skip markers cannot be empty.");
  }
  if (draft.botsEnabled && draft.bots.overthinkEnabled && splitList(draft.bots.overthinkSkipMarkers).length === 0) {
    errors.push("Bot overthink skip markers cannot be empty.");
  }
  if (draft.escalationEnabled) {
    const esc = draft.escalation;
    const hasVictorops = esc.victoropsEnabled || esc.victoropsTeam.trim();
    const hasEmoji = esc.emojiEnabled || esc.emojiName.trim();
    const hasUsers = splitList(esc.users).length > 0;
    const hasDeleteAdmins = splitList(esc.deleteAdmins).length > 0;
    if (!hasVictorops && !hasEmoji && !hasUsers && !hasDeleteAdmins) {
      errors.push("Configure at least one escalation action, or turn Escalation off.");
    }
    if (esc.victoropsEnabled && !esc.victoropsTeam.trim()) {
      errors.push("VictorOps on-call paging requires a VictorOps team.");
    }
    if (esc.emojiEnabled && !esc.emojiName.trim()) {
      errors.push("Emoji reaction requires an emoji name.");
    }
  }
  return errors;
}

function routeDraftErrorMap(draft: RouteDraft): Record<string, string> {
  const errors: Record<string, string> = {};
  if (!draft.agentId.trim()) errors.agentId = "Choose a Dynamic Agent.";
  if (!Number.isFinite(draft.priority)) errors.priority = "Priority must be a valid number.";
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
    const hasUsers = splitList(esc.users).length > 0;
    const hasDeleteAdmins = splitList(esc.deleteAdmins).length > 0;
    if (!hasVictorops && !hasEmoji && !hasUsers && !hasDeleteAdmins) errors.escalation = "Configure at least one escalation action, or turn Escalation off.";
    if (esc.victoropsEnabled && !esc.victoropsTeam.trim()) errors.victoropsTeam = "VictorOps team is required.";
    if (esc.emojiEnabled && !esc.emojiName.trim()) errors.emojiName = "Emoji name is required.";
  }
  return errors;
}

function apiData<T>(payload: { data?: T } & T): T {
  return (payload.data ?? payload) as T;
}
function agentLabel(agent: DynamicAgentOption): string {
  return `${agent.name || agent._id} (${agent._id})`;
}
function pluralize(count: number, singular: string, plural = `${singular}s`): string {
  return `${count} ${count === 1 ? singular : plural}`;
}

// ── Sync preview breakdown ────────────────────────────────────────────────────
// Renders the full per-channel/agent detail returned by the import preview so
// admins can see every option (teams, listen modes, allow lists, overthink,
// escalation) before writing anything.

function summarizeEscalation(esc: SyncPreviewAgent["escalation"]): string[] {
  if (!esc) return [];
  const parts: string[] = [];
  if (esc.victorops?.enabled) parts.push(`VictorOps${esc.victorops.team ? ` (${esc.victorops.team})` : ""}`);
  if (esc.emoji?.enabled) parts.push(`emoji :${esc.emoji.name || "eyes"}:`);
  if (esc.users && esc.users.length > 0) parts.push(`ping ${pluralize(esc.users.length, "user")}`);
  if (esc.delete_admins && esc.delete_admins.length > 0) parts.push(`${pluralize(esc.delete_admins.length, "delete admin")}`);
  return parts;
}

function SyncPreviewSide({ label, side }: {
  label: string;
  side: SyncPreviewAgent["users"] | SyncPreviewAgent["bots"];
}) {
  if (!side) return null;
  const listLabel = label === "Users" ? "user_list" : "bot_list";
  const list = label === "Users"
    ? (side as SyncPreviewAgent["users"])?.user_list
    : (side as SyncPreviewAgent["bots"])?.bot_list;
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <span className="text-xs font-medium text-muted-foreground">{label}</span>
      <Badge variant={side.enabled === false ? "outline" : "secondary"}>
        {side.enabled === false ? "disabled" : `listen: ${side.listen ?? "—"}`}
      </Badge>
      {side.overthink?.enabled && <Badge variant="outline">overthink</Badge>}
      {Array.isArray(list) && list.length > 0 && (
        <span className="text-xs text-muted-foreground">{listLabel}: {list.length}</span>
      )}
    </div>
  );
}

function SyncPreviewBreakdown({ channels }: { channels: SyncPreviewChannel[] }) {
  if (channels.length === 0) return null;
  const noTeamCount = channels.filter((c) => c.has_team === false).length;
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          What will be imported
        </div>
        {noTeamCount > 0 && (
          <span className="text-[11px] text-amber-700 dark:text-amber-400">
            {pluralize(noTeamCount, "channel")} without a team
          </span>
        )}
      </div>
      {noTeamCount > 0 && (
        <div className="rounded-md border border-amber-300/60 bg-amber-50 p-2 text-xs text-amber-950 dark:bg-amber-950/30 dark:text-amber-200">
          Channels marked <span className="font-medium">no team</span> import their agent routes, but the
          agent won&apos;t be invokable until the channel is assigned a team on the Onboard tab — Slack
          requires both a channel grant and a team grant.
        </div>
      )}
      <div className="max-h-72 space-y-2 overflow-auto rounded-md border bg-background/40 p-2">
        {channels.map((channel) => (
          <div key={`${channel.workspace_id ?? ""}/${channel.channel_id}`} className="rounded-md border bg-background/60 p-2.5 text-sm">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-medium">{channel.channel_name || channel.channel_id}</span>
              <span className="text-xs text-muted-foreground">{channel.channel_id}</span>
              {channel.has_team ? (
                <Badge variant="secondary">team:{channel.team_slug}</Badge>
              ) : (
                <Badge variant="outline" className="border-amber-300 bg-amber-50 text-amber-800">no team</Badge>
              )}
              <span className="ml-auto text-xs text-muted-foreground">{pluralize(channel.agents.length, "agent")}</span>
            </div>
            {channel.agents.length > 0 && (
              <div className="mt-2 space-y-2">
                {channel.agents.map((agent) => {
                  const escalation = summarizeEscalation(agent.escalation);
                  return (
                    <div key={agent.agent_id} className="rounded border bg-muted/20 p-2">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-medium">agent:{agent.agent_id}</span>
                        {typeof agent.priority === "number" && (
                          <span className="text-xs text-muted-foreground">priority {agent.priority}</span>
                        )}
                      </div>
                      <div className="mt-1.5 flex flex-col gap-1.5">
                        <SyncPreviewSide label="Users" side={agent.users} />
                        <SyncPreviewSide label="Bots" side={agent.bots} />
                        {escalation.length > 0 && (
                          <div className="flex flex-wrap items-center gap-1.5">
                            <span className="text-xs font-medium text-muted-foreground">Escalation</span>
                            {escalation.map((part) => <Badge key={part} variant="outline">{part}</Badge>)}
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Route editor subcomponents ────────────────────────────────────────────────

function RouteSideEditor({
  title, side, enabled, onToggleEnabled, onChange, listLabel, listPlaceholder, disabled, channelName, agentId, model, error, lookupKind = "all",
}: {
  title: string;
  side: RouteSideDraft;
  enabled: boolean;
  onToggleEnabled: (v: boolean) => void;
  onChange: (next: RouteSideDraft) => void;
  listLabel: string;
  listPlaceholder: string;
  disabled: boolean;
  channelName?: string;
  agentId?: string;
  model?: { id?: string; provider?: string };
  error?: string;
  lookupKind?: "all" | "bots";
}) {
  const idBase = `route-side-${title.toLowerCase()}`;
  return (
    <RouteEditorSection
      title={`Respond to ${title}`}
      description={title === "Users"
        ? "Controls how this agent handles Slack messages from people."
        : "Controls how this agent handles messages posted by Slack apps or bots."}
      enabled={enabled}
      onToggle={onToggleEnabled}
      disabled={disabled}
    >
      <div className="space-y-3">
        <div className="space-y-1.5">
          <Label htmlFor={`${idBase}-listen`}>Listen</Label>
          <select id={`${idBase}-listen`}
            className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
            value={side.listen} disabled={disabled}
            onChange={(e) => onChange({ ...side, listen: e.target.value as ListenMode })}>
            <option value="mention">mention</option>
            <option value="message">message</option>
            <option value="all">all</option>
          </select>
        </div>
        <SlackUserMultiSelect
          label={listLabel}
          value={side.allowList}
          disabled={disabled}
          placeholder={listPlaceholder}
          kind={lookupKind}
          onChange={(next) => onChange({ ...side, allowList: next })}
        />
      </div>
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" checked={side.overthinkEnabled} disabled={disabled}
          onChange={(e) => onChange({ ...side, overthinkEnabled: e.target.checked })} />
        Overthink (re-evaluate before replying)
      </label>
      {side.overthinkEnabled && (
        <div className="space-y-3">
          <div className="space-y-1.5">
            <div className="flex items-center gap-1.5">
              <Label htmlFor={`${idBase}-skip`}>Skip markers</Label>
              <HelpTooltip label={`${title} skip markers`}>
                If the agent&apos;s final response contains one of these bracketed markers, for example <code>[DEFER]</code> or <code>[LOW_CONFIDENCE]</code>, the Slack bot does not post the response. You likely do not need to change these defaults.
              </HelpTooltip>
            </div>
            <Input id={`${idBase}-skip`} value={side.overthinkSkipMarkers} disabled={disabled}
              className={cn(error && "border-destructive focus-visible:ring-destructive")}
              placeholder={DEFAULT_OVERTHINK_SKIP_MARKERS}
              onChange={(e) => onChange({ ...side, overthinkSkipMarkers: e.target.value })} />
            {error && <p className="text-xs text-destructive">{error}</p>}
            <p className="text-xs text-muted-foreground">
              Default: {DEFAULT_OVERTHINK_SKIP_MARKERS}. You likely do not need to change this.
            </p>
          </div>
          <FollowupPromptEditor
            value={side.overthinkFollowupPrompt}
            disabled={disabled}
            channelName={channelName}
            agentId={agentId}
            model={model}
            onChange={(next) => onChange({ ...side, overthinkFollowupPrompt: next })}
          />
        </div>
      )}
    </RouteEditorSection>
  );
}

function EscalationEditor({
  enabled, onToggleEnabled, escalation, onChange, disabled, errors = {},
}: {
  enabled: boolean;
  onToggleEnabled: (v: boolean) => void;
  escalation: RouteEscalationDraft;
  onChange: (next: RouteEscalationDraft) => void;
  disabled: boolean;
  errors?: Record<string, string | undefined>;
}) {
  return (
    <RouteEditorSection
      title="Escalation (“Get help” button)"
      description="Get Help is a button that appears after a user gives the Forge response a thumbs down."
      enabled={enabled}
      onToggle={onToggleEnabled}
      disabled={disabled}
    >
      <div className="space-y-4">
        <div className="space-y-2">
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={escalation.victoropsEnabled} disabled={disabled}
              onChange={(e) => onChange({ ...escalation, victoropsEnabled: e.target.checked })} />
            VictorOps on-call paging
          </label>
          {escalation.victoropsEnabled && (
            <div className="space-y-1.5">
              <Label htmlFor="route-esc-vo-team">VictorOps team</Label>
              <Input id="route-esc-vo-team" value={escalation.victoropsTeam} disabled={disabled}
                  className={cn(errors.victoropsTeam && "border-destructive focus-visible:ring-destructive")}
                placeholder="e.g. dao"
                onChange={(e) => onChange({ ...escalation, victoropsTeam: e.target.value })} />
                {errors.victoropsTeam && <p className="text-xs text-destructive">{errors.victoropsTeam}</p>}
            </div>
          )}
        </div>
        <div className="space-y-2">
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={escalation.emojiEnabled} disabled={disabled}
              onChange={(e) => onChange({ ...escalation, emojiEnabled: e.target.checked })} />
            Emoji reaction
          </label>
          {escalation.emojiEnabled && (
            <SlackEmojiCombobox
              value={escalation.emojiName}
              disabled={disabled}
              error={errors.emojiName}
              onChange={(next) => onChange({ ...escalation, emojiName: next })}
            />
          )}
        </div>
        <SlackUserMultiSelect
          label="Ping users"
          value={escalation.users}
          disabled={disabled}
          placeholder="Search Slack users or paste U012ABC"
          onChange={(next) => onChange({ ...escalation, users: next })}
        />
        <SlackUserMultiSelect
          label="Delete admins"
          value={escalation.deleteAdmins}
          disabled={disabled}
          placeholder="Search Slack users or paste U012ABC"
          onChange={(next) => onChange({ ...escalation, deleteAdmins: next })}
        />
      </div>
      {errors.escalation && <p className="text-xs text-destructive">{errors.escalation}</p>}
    </RouteEditorSection>
  );
}

function RouteAssociationEditor({
  selected,
  dynamicAgents,
  routeDraft,
  setRouteDraft,
  editingRouteAgentId,
  saveRoute,
  onCancel,
  disabled,
  loading,
  selectedCanManage,
}: {
  selected: ItemSummary | undefined;
  dynamicAgents: DynamicAgentOption[];
  routeDraft: RouteDraft;
  setRouteDraft: (updater: (prev: RouteDraft) => RouteDraft) => void;
  editingRouteAgentId: string | null;
  saveRoute: () => Promise<void> | void;
  onCancel: () => void;
  disabled: boolean;
  loading: boolean;
  selectedCanManage: boolean;
}) {
  const formDisabled = disabled || !selectedCanManage;
  const selectedAgent = dynamicAgents.find((agent) => agent._id === routeDraft.agentId);
  const [submitAttempted, setSubmitAttempted] = useState(false);
  const validationErrors = routeDraftErrorMap(routeDraft);
  const visibleErrors = submitAttempted ? validationErrors : {};
  const hasErrors = Object.keys(validationErrors).length > 0;
  return (
    <div className="space-y-5">
      <section className="space-y-3">
        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="connector-route-agent-id" className="block">Dynamic Agent</Label>
            <AgentPicker
              id="connector-route-agent-id"
              ariaLabel="Dynamic Agent"
              value={routeDraft.agentId}
              onChange={(value) => setRouteDraft((prev) => ({ ...prev, agentId: value }))}
              disabled={formDisabled || dynamicAgents.length === 0 || Boolean(editingRouteAgentId)}
              placeholder={dynamicAgents.length === 0 ? "No enabled Dynamic Agents found" : "Select Dynamic Agent"}
              options={dynamicAgents.map<AgentPickerOption>((agent) => ({ value: agent._id, label: agent.name || agent._id }))}
              triggerClassName={cn("h-10", visibleErrors.agentId && "border-destructive focus:ring-destructive")}
            />
            {visibleErrors.agentId && <p className="text-xs text-destructive">{visibleErrors.agentId}</p>}
          </div>
          <div className="max-w-48 space-y-2">
            <Label htmlFor="connector-route-priority" className="block">Priority</Label>
            <Input
              id="connector-route-priority"
              type="number"
              value={routeDraft.priority}
              className={cn(visibleErrors.priority && "border-destructive focus-visible:ring-destructive")}
              onChange={(event) => setRouteDraft((prev) => ({ ...prev, priority: Number(event.target.value) }))}
              disabled={formDisabled}
            />
            {visibleErrors.priority && <p className="text-xs text-destructive">{visibleErrors.priority}</p>}
          </div>
        </div>
      </section>

      <div className="border-t" />

      <section className="space-y-3">
        <div className="flex items-center gap-1.5">
          <h4 className="text-sm font-semibold">Responding</h4>
          <HelpTooltip label="Responding">Configure whether this agent handles user messages, bot messages, or both.</HelpTooltip>
        </div>
        <div className="space-y-5">
          {visibleErrors.responding && <p className="text-xs text-destructive">{visibleErrors.responding}</p>}
          <RouteSideEditor
            title="Users"
            side={routeDraft.users}
            enabled={routeDraft.usersEnabled}
            onToggleEnabled={(value) => setRouteDraft((prev) => ({ ...prev, usersEnabled: value }))}
            onChange={(next) => setRouteDraft((prev) => ({ ...prev, users: next }))}
            listLabel="Only these Slack users"
            listPlaceholder="Search Slack users or paste U012ABC"
            disabled={formDisabled}
            channelName={selected?.item_name || selected?.item_id}
            agentId={routeDraft.agentId}
            model={selectedAgent?.model}
            error={visibleErrors.usersSkipMarkers}
          />
          <RouteSideEditor
            title="Bots"
            side={routeDraft.bots}
            enabled={routeDraft.botsEnabled}
            onToggleEnabled={(value) => setRouteDraft((prev) => ({ ...prev, botsEnabled: value }))}
            onChange={(next) => setRouteDraft((prev) => ({ ...prev, bots: next }))}
            listLabel="Only these Slack bots"
            listPlaceholder="Search Slack bot users or paste an ID"
            disabled={formDisabled}
            lookupKind="bots"
            channelName={selected?.item_name || selected?.item_id}
            agentId={routeDraft.agentId}
            model={selectedAgent?.model}
            error={visibleErrors.botsSkipMarkers}
          />
        </div>
      </section>

      <div className="border-t" />

      <section className="space-y-3">
        <h4 className="text-sm font-semibold">Escalation</h4>
        <EscalationEditor
          enabled={routeDraft.escalationEnabled}
          onToggleEnabled={(value) => setRouteDraft((prev) => ({ ...prev, escalationEnabled: value }))}
          escalation={routeDraft.escalation}
          onChange={(next) => setRouteDraft((prev) => ({ ...prev, escalation: next }))}
          disabled={formDisabled}
          errors={visibleErrors}
        />
      </section>

      <DialogFooter className="border-t pt-4">
        <Button type="button" variant="outline" onClick={onCancel} disabled={loading}>Cancel</Button>
        <Button
          type="button"
          onClick={() => {
            setSubmitAttempted(true);
            if (!hasErrors) void saveRoute();
          }}
          disabled={formDisabled || loading}
        >
          {loading ? "Saving..." : editingRouteAgentId ? "Update Agent" : "Add Agent"}
        </Button>
      </DialogFooter>
    </div>
  );
}

function routeSummaryBadges(route: ItemAgentRoute): string[] {
  const badges: string[] = [];
  if (route.users && route.users.enabled !== false) badges.push(`users:${route.users.listen ?? "mention"}`);
  if (route.bots && route.bots.enabled !== false) badges.push(`bots:${route.bots.listen ?? "message"}`);
  if (route.users?.overthink?.enabled || route.bots?.overthink?.enabled) badges.push("overthink");
  const esc = route.escalation;
  if (esc && (esc.victorops?.enabled || esc.emoji?.enabled || (esc.users?.length ?? 0) > 0 || (esc.delete_admins?.length ?? 0) > 0)) {
    badges.push("escalation");
  }
  return badges;
}

function diagnosticsHasIssues(diagnostics: ItemDiagnostics | null): boolean {
  if (!diagnostics) return false;
  return (
    diagnostics.warnings.length > 0 ||
    diagnostics.openfga.reachable === false ||
    Boolean(diagnostics.last_runtime_error?.message) ||
    diagnostics.routes.length === 0 ||
    diagnostics.routes.some((route) => route.warnings.length > 0 || !route.openfga_tuple)
  );
}

function DiagnosticsPanel({
  adapter,
  selected,
  diagnostics,
  missingRouteableAgent,
  autoFixAgentId,
  fixDiagnosticRoute,
  fixMissingRouteableAgent,
  disabled,
  loading,
  selectedCanManage,
}: {
  adapter: ConnectorAdminAdapter;
  selected: ItemSummary;
  diagnostics: ItemDiagnostics | null;
  missingRouteableAgent: boolean;
  autoFixAgentId: string;
  fixDiagnosticRoute: (route: DiagnosticRoute) => Promise<void> | void;
  fixMissingRouteableAgent: () => Promise<void> | void;
  disabled: boolean;
  loading: boolean;
  selectedCanManage: boolean;
}) {
  const hasIssues = diagnosticsHasIssues(diagnostics);
  const diagnosticsKey = `${selected.workspace_id}/${selected.item_id}/${diagnostics ? "loaded" : "loading"}/${hasIssues ? "issues" : "ok"}`;
  const [openState, setOpenState] = useState({ key: diagnosticsKey, open: hasIssues });
  const open = openState.key === diagnosticsKey ? openState.open : hasIssues;

  const summary = !diagnostics
    ? "Loading diagnostics..."
    : hasIssues
      ? `${diagnostics.warnings.length || diagnostics.routes.filter((route) => route.warnings.length > 0 || !route.openfga_tuple).length || 1} issue${diagnostics.warnings.length === 1 ? "" : "s"}`
      : `${diagnostics.openfga.tuple_count} tuple${diagnostics.openfga.tuple_count === 1 ? "" : "s"} · ${diagnostics.routes.length} route${diagnostics.routes.length === 1 ? "" : "s"} · healthy`;

  return (
    <div className="rounded-md border bg-background/60">
      <button
        type="button"
        className="flex w-full items-center justify-between gap-3 px-3 py-2 text-left"
        onClick={() => setOpenState({ key: diagnosticsKey, open: !open })}
        aria-expanded={open}
      >
        <div>
          <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Diagnostics</div>
          <div className="text-sm text-muted-foreground">{summary}</div>
        </div>
        <Badge variant={hasIssues ? "outline" : "secondary"} className={hasIssues ? "border-amber-300 bg-amber-50 text-amber-800" : ""}>
          {hasIssues ? "review" : "healthy"}
        </Badge>
      </button>
      {open && (
        <div className="space-y-3 border-t p-3">
          {!diagnostics ? (
            <p className="text-sm text-muted-foreground">Loading diagnostics...</p>
          ) : (
            <>
              <div className="grid gap-2 text-sm md:grid-cols-3">
                <div className="rounded-md border bg-background/60 p-3">
                  <div className="text-xs text-muted-foreground">OpenFGA</div>
                  <div className="font-medium">{diagnostics.openfga.reachable ? "reachable" : "unreachable"}</div>
                  <div className="text-xs text-muted-foreground">{diagnostics.openfga.tuple_count} {adapter.itemSingular}-agent tuples</div>
                </div>
                <div className="rounded-md border bg-background/60 p-3">
                  <div className="text-xs text-muted-foreground">Runtime routes</div>
                  <div className="font-medium">{diagnostics.routes.length}</div>
                  <div className="text-xs text-muted-foreground">OpenFGA-backed candidates</div>
                </div>
                <div className="rounded-md border bg-background/60 p-3">
                  <div className="text-xs text-muted-foreground">Last error</div>
                  <div className="font-medium">{diagnostics.last_runtime_error?.reason_code ?? "none"}</div>
                  <div className="text-xs text-muted-foreground">{diagnostics.last_runtime_error?.ts ?? "No recent runtime error"}</div>
                </div>
              </div>
              {diagnostics.warnings.length > 0 && (
                <div className="space-y-1 rounded-md border border-amber-300/60 bg-amber-50 p-3 text-sm text-amber-950 dark:bg-amber-950/30 dark:text-amber-200">
                  <div className="text-xs font-medium uppercase tracking-wide">Issues found</div>
                  {diagnostics.warnings.map((warning) => <div key={warning}>{warning}</div>)}
                </div>
              )}
              {missingRouteableAgent && adapter.missingRouteableAgentAutoFix && (
                <div className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-cyan-500/40 bg-cyan-50 p-3 text-sm text-cyan-950 dark:bg-cyan-950/30 dark:text-cyan-100">
                  <div>
                    <div className="font-medium">{adapter.missingRouteableAgentAutoFix.title}</div>
                    <div className="text-xs">{adapter.missingRouteableAgentAutoFix.description}</div>
                  </div>
                  <Button
                    type="button" variant="outline" size="sm"
                    onClick={() => void fixMissingRouteableAgent()}
                    disabled={disabled || !selectedCanManage || loading || !autoFixAgentId}
                  >
                    {adapter.missingRouteableAgentAutoFix.buttonLabel(autoFixAgentId)}
                  </Button>
                  {!autoFixAgentId && (
                    <div className="basis-full text-xs">{adapter.missingRouteableAgentAutoFix.noAgentHelpText}</div>
                  )}
                </div>
              )}
              {diagnostics.last_runtime_error?.message && (
                <div className="rounded-md border border-destructive/40 p-3 text-sm text-destructive">
                  {diagnostics.last_runtime_error.message}
                </div>
              )}
              {diagnostics.routes.length > 0 && (
                <div className="space-y-2">
                  {diagnostics.routes.map((route) => (
                    <div key={route.agent_id} className="flex flex-wrap items-center gap-2 rounded-md border bg-background/60 p-3 text-sm">
                      <span className="font-medium">agent:{route.agent_id}</span>
                      <Badge variant={route.openfga_tuple ? "default" : "outline"}>
                        {route.openfga_tuple ? "OpenFGA tuple" : "missing tuple"}
                      </Badge>
                      <Badge variant={route.route_metadata ? "secondary" : "outline"}>
                        {route.route_metadata ? `listen:${route.listen}` : "default metadata"}
                      </Badge>
                      <span className="text-xs text-muted-foreground">
                        mention {route.runtime_matches.mention ? "yes" : "no"} / message {route.runtime_matches.message ? "yes" : "no"}
                      </span>
                      {adapter.diagnosticRouteIsFixable(route) && (
                        <Button
                          type="button" variant="outline" size="sm" className="ml-auto"
                          onClick={() => void fixDiagnosticRoute(route)}
                          disabled={disabled || !selectedCanManage || loading}
                          aria-label={`Fix agent:${route.agent_id} routing`}
                        >
                          Fix it
                        </Button>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}

// ── ItemDetail subcomponent ───────────────────────────────────────────────────

interface ItemDetailProps {
  adapter: ConnectorAdminAdapter;
  selected: ItemSummary;
  diagnostics: ItemDiagnostics | null;
  routes: ItemAgentRoute[];
  teams: TeamOption[];
  setChannelTeam: (teamSlug: string) => Promise<void> | void;
  onCreateRoute: () => void;
  onEditRoute: (route: ItemAgentRoute) => void;
  deleteRoute: (route: ItemAgentRoute) => void;
  fixDiagnosticRoute: (route: DiagnosticRoute) => Promise<void> | void;
  fixMissingRouteableAgent: () => Promise<void> | void;
  disabled: boolean; loading: boolean; selectedCanManage: boolean; message: string | null;
}

function ItemDetail({
  adapter, selected, diagnostics, routes,
  teams, setChannelTeam,
  onCreateRoute, onEditRoute, deleteRoute,
  fixDiagnosticRoute, fixMissingRouteableAgent, disabled, loading, selectedCanManage, message,
}: ItemDetailProps) {
  const diagnosticsMissingRouteableAgent =
    adapter.missingRouteableAgentAutoFix?.isApplicable(selected, diagnostics ?? {
      openfga: { reachable: false, tuple_count: 0 }, routes: [], warnings: [],
    }) ?? false;
  const autoFixAgentId = "";

  return (
    <div className="space-y-4">
      <DiagnosticsPanel
        adapter={adapter}
        selected={selected}
        diagnostics={diagnostics}
        missingRouteableAgent={diagnosticsMissingRouteableAgent}
        autoFixAgentId={autoFixAgentId}
        fixDiagnosticRoute={fixDiagnosticRoute}
        fixMissingRouteableAgent={fixMissingRouteableAgent}
        disabled={disabled}
        loading={loading}
        selectedCanManage={selectedCanManage}
      />

      {adapter.manualRouteEditing && (
        <div className="rounded-md border bg-background/60 p-3">
          <div className="mb-2 flex items-center justify-between gap-3">
            <div>
              <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Team</div>
              <p className="text-sm text-muted-foreground">
                Assign a team so this channel can be managed and shown to the right admins.
              </p>
            </div>
            {selected.team_slug ? <Badge variant="secondary">team:{selected.team_slug}</Badge> : <Badge variant="outline" className="border-amber-300 bg-amber-50 text-amber-800">no team</Badge>}
          </div>
          <TeamPicker
            value={selected.team_slug ?? ""}
            onChange={(teamSlug) => void setChannelTeam(teamSlug)}
            disabled={disabled || !selectedCanManage || loading || teams.length === 0}
            placeholder={teams.length === 0 ? "No teams configured" : "Select team"}
            searchPlaceholder="Search teams..."
            ariaLabel={`Team for ${selected.item_name || selected.item_id}`}
            options={teams.map<TeamPickerOption>((team) => ({ slug: team.slug, name: team.name || team.slug, id: team.id, _id: team._id }))}
          />
        </div>
      )}

      {/* Manual route editing — Slack only */}
      {adapter.manualRouteEditing && (
        <div className="space-y-3">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Agents</div>
              <p className="text-sm text-muted-foreground">
                {routes.length > 0
                  ? `${pluralize(routes.length, "agent")} can respond in ${selected.item_name || selected.item_id}.`
                  : `No agents can respond in ${selected.item_name || selected.item_id} yet.`}
              </p>
            </div>
            <Button
              type="button"
              size="sm"
              onClick={onCreateRoute}
              disabled={disabled || !selectedCanManage || loading}
            >
              Add Agent
            </Button>
          </div>
          {adapter.manualRouteFormHint?.(selected)}
          {message && <p className="text-sm text-muted-foreground">{message}</p>}
          {routes.length === 0 ? (
            <div className="rounded-md border border-dashed bg-muted/20 p-4 text-sm text-muted-foreground">
              Add an agent to let this {adapter.itemSingular} respond to Slack messages.
            </div>
          ) : (
            <div className="space-y-2">
              {routes.map((route) => (
                <div key={route.agent_id} className="flex flex-wrap items-center justify-between gap-3 rounded-md border bg-background/60 px-3 py-2 text-sm">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-medium">agent:{route.agent_id}</span>
                      <Badge variant="secondary">priority {route.priority}</Badge>
                      {routeSummaryBadges(route).map((badge) => <Badge key={badge} variant="outline">{badge}</Badge>)}
                    </div>
                    <div className="mt-1 text-xs text-muted-foreground">
                      Users: {route.users?.listen ?? "mention"}{route.bots ? ` · Bots: ${route.bots.listen ?? "message"}` : ""}{route.escalation ? " · Escalation enabled" : ""}
                    </div>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <Button type="button" variant="outline" size="sm" onClick={() => onEditRoute(route)}
                      disabled={disabled || !selectedCanManage || loading} aria-label={`Edit agent:${route.agent_id}`}>Edit</Button>
                    <Button type="button" variant="destructive" size="sm" onClick={() => deleteRoute(route)}
                      disabled={disabled || !selectedCanManage || loading} aria-label={`Delete agent:${route.agent_id}`}>Delete</Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── ConnectorAdminPanel ───────────────────────────────────────────────────────

export function ConnectorAdminPanel({
  adapter,
  disabled = false,
  selfService = false,
}: {
  adapter: ConnectorAdminAdapter;
  disabled?: boolean;
  selfService?: boolean;
}) {
  const { toast } = useToast();
  const [items, setItems] = useState<ItemSummary[]>([]);
  const [selectedKey, setSelectedKey] = useState("");
  const [routes, setRoutes] = useState<ItemAgentRoute[]>([]);
  const [diagnostics, setDiagnostics] = useState<ItemDiagnostics | null>(null);
  const [dynamicAgents, setDynamicAgents] = useState<DynamicAgentOption[]>([]);
  const [teams, setTeams] = useState<TeamOption[]>([]);
  const [routeDraft, setRouteDraft] = useState<RouteDraft>(emptyRouteDraft);
  const [editingRouteAgentId, setEditingRouteAgentId] = useState<string | null>(null);
  const [routeEditorOpen, setRouteEditorOpen] = useState(false);
  const [routePendingDelete, setRoutePendingDelete] = useState<ItemAgentRoute | null>(null);
  const [runtimeStatus, setRuntimeStatus] = useState<RuntimeStatus | null>(null);
  const [runtimeSyncSummary, setRuntimeSyncSummary] = useState<RuntimeSyncSummary | null>(null);
  const [runtimeSyncModalOpen, setRuntimeSyncModalOpen] = useState(false);
  const [runtimeSyncModalMode, setRuntimeSyncModalMode] = useState<SyncModalMode>("preview");
  const [runtimeSyncModalStatus, setRuntimeSyncModalStatus] = useState<SyncModalStatus>("idle");
  const [runtimeSyncModalError, setRuntimeSyncModalError] = useState<string | null>(null);
  const [discoverLoading, setDiscoverLoading] = useState(false);
  const [discoverError, setDiscoverError] = useState<string | null>(null);
  const [discoveredItems, setDiscoveredItems] = useState<DiscoveredItem[]>([]);
  const [discoveredRows, setDiscoveredRows] = useState<Array<DiscoveredItem & { selected: boolean; team_slug: string; agent_id: string; is_existing: boolean }>>([]);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [view, setView] = useState<PanelView>("channels");
  const [configuredSearch, setConfiguredSearch] = useState("");
  const [discoverySearch, setDiscoverySearch] = useState("");

  const selected = useMemo(
    () => items.find((item) => adapter.itemKey(item) === selectedKey),
    [items, selectedKey, adapter],
  );
  const selectedCanManage = !selfService || selected?.can_manage === true;
  const unassignedCount = useMemo(() => items.filter((item) => !item.team_slug).length, [items]);
  const configuredItemIds = useMemo(() => new Set(items.map((item) => item.item_id)), [items]);
  const configuredItemsById = useMemo(() => new Map(items.map((item) => [item.item_id, item])), [items]);
  const filteredConfiguredItems = useMemo(() => {
    const query = configuredSearch.trim().toLowerCase();
    if (!query) return items;
    return items.filter((item) =>
      [
        item.item_name,
        item.item_id,
        item.workspace_id,
        item.team_slug ?? "",
      ].some((value) => value.toLowerCase().includes(query)),
    );
  }, [configuredSearch, items]);
  const sortedDynamicAgents = useMemo(
    () => [...dynamicAgents].sort((a, b) => agentLabel(a).localeCompare(agentLabel(b))),
    [dynamicAgents],
  );
  const discoveredNewCount = useMemo(
    () => discoveredItems.filter((item) => !configuredItemIds.has(item.id)).length,
    [configuredItemIds, discoveredItems],
  );
  const selectedDiscoveredRows = useMemo(
    () => discoveredRows.filter((row) => row.selected && row.team_slug && row.agent_id),
    [discoveredRows],
  );

  // ── Data loaders ────────────────────────────────────────────────────────────

  const loadItems = useCallback(async () => {
    setLoading(true); setMessage(null);
    try {
      const res = await fetch(`${adapter.api.list}?health=1`);
      if (!res.ok) throw new Error(await res.text());
      const json = await res.json();
      const rows = adapter.parseListResponse(json);
      const parsed = rows.map((r) => adapter.parseListItem(r)).filter((x): x is ItemSummary => x !== null);
      setItems(parsed);
    } catch (err) {
      setMessage(err instanceof Error ? err.message : `Failed to load ${adapter.itemPlural}`);
    } finally { setLoading(false); }
  }, [adapter]);

  const loadRoutes = useCallback(async () => {
    if (!selected) return;
    const res = await fetch(adapter.api.routesFor(selected.workspace_id, selected.item_id));
    if (!res.ok) throw new Error(await res.text());
    const data = apiData<{ routes: ItemAgentRoute[] }>(await res.json());
    setRoutes(data.routes ?? []);
  }, [selected, adapter]);

  const loadDiagnostics = useCallback(async () => {
    if (!selected) return;
    const res = await fetch(adapter.api.diagnosticsFor(selected.workspace_id, selected.item_id));
    if (!res.ok) throw new Error(await res.text());
    const data = apiData<ItemDiagnostics>(await res.json());
    setDiagnostics(data);
  }, [selected, adapter]);

  const loadDynamicAgents = useCallback(async () => {
    const res = await fetch("/api/dynamic-agents?enabled_only=true");
    if (!res.ok) throw new Error(await res.text());
    const data = apiData<{ items: DynamicAgentOption[] }>(await res.json());
    setDynamicAgents(data.items ?? []);
  }, []);

  const loadTeams = useCallback(async () => {
    const res = await fetch("/api/admin/teams");
    if (!res.ok) throw new Error(await res.text());
    const data = apiData<{ teams: TeamOption[] }>(await res.json());
    setTeams(data.teams ?? []);
  }, []);

  const loadRuntimeStatus = useCallback(async () => {
    const res = await fetch(adapter.api.runtimeStatus);
    if (!res.ok) throw new Error(await res.text());
    const data = apiData<Record<string, unknown>>(await res.json());
    setRuntimeStatus(adapter.parseRuntimeStatus(data));
  }, [adapter]);

  // ── Effects ─────────────────────────────────────────────────────────────────

  useEffect(() => { void loadItems(); }, [loadItems]);
  useEffect(() => {
    void loadDynamicAgents().catch((e) =>
      setMessage(e instanceof Error ? e.message : "Failed to load Dynamic Agents"));
  }, [loadDynamicAgents]);
  useEffect(() => {
    if (selfService) return;
    void loadTeams().catch((e) => setMessage(e instanceof Error ? e.message : "Failed to load teams"));
  }, [loadTeams, selfService]);
  useEffect(() => {
    if (selfService) return;
    void loadRuntimeStatus().catch((e) =>
      setMessage(e instanceof Error ? e.message : `Failed to load ${adapter.connectorName} bot runtime status`));
  }, [loadRuntimeStatus, selfService, adapter.connectorName]);
  const connectorName = adapter.connectorName;
  const itemSingular = adapter.itemSingular;
  useEffect(() => {
    void loadRoutes().catch((e) =>
      setMessage(e instanceof Error ? e.message : `Failed to load ${connectorName} ${itemSingular} routes`));
  }, [loadRoutes, connectorName, itemSingular]);
  useEffect(() => {
    setDiagnostics(null);
    void loadDiagnostics().catch((e) =>
      setMessage(e instanceof Error ? e.message : `Failed to load ${connectorName} runtime diagnostics`));
  }, [loadDiagnostics, connectorName]);

  // ── Route form helpers ───────────────────────────────────────────────────────

  const resetRouteForm = () => {
    setRouteDraft(emptyRouteDraft()); setEditingRouteAgentId(null);
  };
  const openCreateRoute = () => {
    resetRouteForm();
    setRouteEditorOpen(true);
  };
  const editRoute = (route: ItemAgentRoute) => {
    setRouteDraft(routeToDraft(route));
    setEditingRouteAgentId(route.agent_id);
    setRouteEditorOpen(true);
  };

  const saveRoute = async () => {
    const agentId = routeDraft.agentId.trim();
    if (!selected || !agentId) return;
    const validationErrors = validateRouteDraft(routeDraft);
    if (validationErrors.length > 0) {
      setMessage(validationErrors.join(" "));
      return;
    }
    setLoading(true); setMessage(null);
    try {
      // Build the complete route from the draft so every field (users,
      // bots, allow lists, overthink, escalation) round-trips. The PUT
      // handler replaces the channel's routes wholesale and $unsets any
      // omitted side config, so we MUST resend the full set each save —
      // hence we preserve the other routes verbatim and swap in this one.
      const nextRoutes: ItemAgentRoute[] = [
        ...routes.filter((r) => r.agent_id !== agentId && r.agent_id !== editingRouteAgentId),
        draftToRoute(routeDraft),
      ];
      const res = await fetch(adapter.api.routesFor(selected.workspace_id, selected.item_id), {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ routes: nextRoutes }),
      });
      if (!res.ok) throw new Error(await res.text());
      const data = apiData<{ routes: ItemAgentRoute[] }>(await res.json());
      setRoutes(data.routes ?? []);
      resetRouteForm();
      setRouteEditorOpen(false);
      toast(editingRouteAgentId
        ? `${adapter.connectorName} ${adapter.itemSingular} agent updated.`
        : `${adapter.connectorName} ${adapter.itemSingular} agent added.`, "success");
      await Promise.all([loadItems(), loadDiagnostics()]);
    } catch (err) {
      setMessage(err instanceof Error ? err.message : `Failed to save ${adapter.connectorName} agent`);
    } finally { setLoading(false); }
  };

  const deleteRouteConfirmed = async () => {
    if (!selected || !routePendingDelete) return;
    setLoading(true); setMessage(null);
    try {
      const res = await fetch(adapter.api.routesFor(selected.workspace_id, selected.item_id), {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ agent_id: routePendingDelete.agent_id }),
      });
      if (!res.ok) throw new Error(await res.text());
      if (editingRouteAgentId === routePendingDelete.agent_id) resetRouteForm();
      setRoutePendingDelete(null);
      toast(`${adapter.connectorName} ${adapter.itemSingular} agent removed.`, "success");
      await Promise.all([loadItems(), loadRoutes(), loadDiagnostics()]);
    } catch (err) {
      setMessage(err instanceof Error ? err.message : `Failed to remove ${adapter.connectorName} agent`);
    } finally { setLoading(false); }
  };

  const setChannelTeam = async (teamSlug: string) => {
    if (!selected || !teamSlug) return;
    setLoading(true); setMessage(null);
    try {
      const res = await fetch(`${adapter.api.list}/${encodeURIComponent(selected.workspace_id)}/${encodeURIComponent(selected.item_id)}/team`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          team_slug: teamSlug,
          channel_name: selected.item_name || selected.item_id,
        }),
      });
      if (!res.ok) throw new Error(await res.text());
      toast(`${adapter.connectorName} ${adapter.itemSingular} team updated.`, "success");
      await Promise.all([loadItems(), loadDiagnostics()]);
    } catch (err) {
      const msg = err instanceof Error ? err.message : `Failed to update ${adapter.connectorName} ${adapter.itemSingular} team`;
      setMessage(msg); toast(msg, "error");
    } finally { setLoading(false); }
  };

  // ── Runtime / advanced tab actions ──────────────────────────────────────────

  const refreshRuntimeStatus = async () => {
    setLoading(true); setMessage(null);
    try { await loadRuntimeStatus(); toast(`${adapter.connectorName} bot runtime status refreshed.`, "success"); }
    catch (err) { setMessage(err instanceof Error ? err.message : "Failed to load runtime status"); }
    finally { setLoading(false); }
  };

  const reloadBotRoutes = async () => {
    setLoading(true); setMessage(null);
    try {
      const res = await fetch(adapter.api.runtimeReload, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({}) });
      if (!res.ok) throw new Error(await res.text());
      await loadRuntimeStatus();
      toast(`${adapter.connectorName} bot route cache reloaded.`, "success");
    } catch (err) { setMessage(err instanceof Error ? err.message : "Failed to reload bot routes"); }
    finally { setLoading(false); }
  };

  const syncBotConfig = async (dryRun: boolean) => {
    setRuntimeSyncModalOpen(true); setRuntimeSyncModalMode(dryRun ? "preview" : "apply");
    setRuntimeSyncModalStatus("loading"); setRuntimeSyncModalError(null);
    if (dryRun) setRuntimeSyncSummary(null);
    setLoading(true); setMessage(null);
    try {
      const res = await fetch(adapter.api.runtimeSyncFromConfig, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ dry_run: dryRun }),
      });
      if (!res.ok) throw new Error(await res.text());
      const raw = apiData<Record<string, unknown>>(await res.json());
      const summary = adapter.parseRuntimeSyncSummary(raw);
      setRuntimeSyncSummary(summary); setRuntimeSyncModalStatus("success");
      if (!dryRun) {
        toast(
          `Config sync applied: upserted ${summary.routes_upserted} routes and wrote ${summary.openfga_tuples_written} OpenFGA tuples.`,
          "success"
        );
      }
      await Promise.all([loadRuntimeStatus(), loadItems(), loadRoutes(), loadDiagnostics()]);
    } catch (err) {
      const msg = err instanceof Error ? err.message : `Failed to sync ${adapter.connectorName} bot config`;
      setRuntimeSyncModalError(msg); setRuntimeSyncModalStatus("error"); setMessage(msg);
    } finally { setLoading(false); }
  };

  // ── Diagnostic fix actions ───────────────────────────────────────────────────

  const fixDiagnosticRoute = async (route: DiagnosticRoute) => {
    if (!selected) return;
    setLoading(true); setMessage(null);
    try {
      const result = await adapter.fixDiagnosticRoute({ item: selected, route, routes });
      if (result.nextRoutes) setRoutes(result.nextRoutes);
      await Promise.all([loadItems(), loadRoutes(), loadDiagnostics()]);
      toast(result.toast, "success");
    } catch (err) {
      setMessage(err instanceof Error ? err.message : `Failed to fix agent:${route.agent_id}`);
    } finally { setLoading(false); }
  };

  const fixMissingRouteableAgent = async () => {
    if (!selected) return;
    toast(`Add an agent manually for this ${adapter.itemSingular}.`, "warning");
  };

  // ── Discovery / onboarding ───────────────────────────────────────────────────

  const discoverItems = async () => {
    setDiscoverLoading(true); setDiscoverError(null); setMessage(null);
    try {
      const discovered: DiscoveredItem[] = [];
      let cursor: string | null = null;
      let page = 0;
      do {
        const url = adapter.api.discoveryUrl(page, cursor);
        const res = await fetch(url, { cache: "no-store" });
        if (!res.ok) throw new Error(await res.text());
        const pageData = adapter.parseDiscoveryPage(await res.json());
        discovered.push(...pageData.items);
        cursor = pageData.hasMore ? pageData.nextCursor : null;
        page++;
      } while (cursor);
      setDiscoveredItems(discovered);
      const hasNewItems = discovered.some((item) => !configuredItemIds.has(item.id));
      setDiscoveredRows(discovered.map((item) => {
        const existing = configuredItemsById.get(item.id);
        const isExisting = configuredItemIds.has(item.id);
        const isSetupComplete = Boolean(existing?.team_slug && (existing.active_grants ?? 0) > 0);
        // Slack: never auto-select (admin opts in per row).
        // Webex: auto-select new items when there are new ones to onboard.
        const autoSelect = adapter.discoveryAutoSelectNewItems
          ? (hasNewItems ? !isExisting : true)
          : false;
        return { ...item, selected: autoSelect, team_slug: "", agent_id: "", is_existing: isSetupComplete };
      }));
      toast(`Found ${pluralize(discovered.length, adapter.copy.discoveryDiscoveredLabel)}.`, "success");
    } catch (err) {
      const msg = err instanceof Error ? err.message : `Failed to discover ${adapter.connectorName} ${adapter.itemPlural}`;
      setDiscoverError(msg); setMessage(msg); setDiscoveredRows([]);
    } finally { setDiscoverLoading(false); }
  };

  const updateDiscoveredRow = (itemId: string, updates: Partial<{ selected: boolean; team_slug: string; agent_id: string }>) => {
    setDiscoveredRows((rows) => rows.map((row) => row.id === itemId ? { ...row, ...updates } : row));
  };
  const setAllRowsSelected = (sel: boolean) => {
    setDiscoveredRows((rows) => rows.map((row) => ({ ...row, selected: sel })));
  };

  const applyOnboarding = async () => {
    setLoading(true); setMessage(null);
    try {
      const result = await adapter.applyOnboarding({
        rows: discoveredRows.map((r) => ({ id: r.id, name: r.name, teamSlug: r.team_slug, agentId: r.agent_id, selected: r.selected })),
        defaultTeamSlug: "", defaultAgentId: "", createDefaultRoutes: true, fetchFn: fetch,
      });
      await Promise.all([loadItems(), loadRoutes(), loadDiagnostics()]);
      const appliedIds = new Set(discoveredRows.filter((r) => r.selected).map((r) => r.id));
      setDiscoveredRows((rows) => rows.map((row) => appliedIds.has(row.id) ? { ...row, is_existing: true, selected: false } : row));
      toast(result.toastMessage, "success");
    } catch (err) {
      const msg = err instanceof Error ? err.message : `Failed to apply ${adapter.connectorName} onboarding`;
      setMessage(msg); toast(msg, "error");
    } finally { setLoading(false); }
  };

  // ── Derived display values ────────────────────────────────────────────────────

  const discoveryStatusText = adapter.discoveryStatusText({
    discoveredCount: discoveredItems.length,
    newCount: discoveredNewCount,
    configuredCount: items.length,
    unassignedCount: unassignedCount,
  });

  const viewTitle: Record<PanelView, string> = {
    channels: adapter.copy.configuredTabTitle,
    onboard: adapter.copy.onboardTabTitle,
    advanced: adapter.copy.advancedTabTitle,
  };
  const viewDescription: Record<PanelView, string> = {
    channels: adapter.copy.configuredTabDescription,
    onboard: adapter.copy.onboardTabDescription,
    advanced: adapter.copy.advancedTabDescription,
  };

  // ── Render ────────────────────────────────────────────────────────────────────

  return (
    <Card>
      <CardHeader>
        <CardTitle>{selfService ? adapter.copy.selfServiceTitle : viewTitle[view]}</CardTitle>
        <CardDescription>
          {selfService ? adapter.copy.selfServiceDescription : viewDescription[view]}
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {/* Tab bar */}
        {!selfService && (
          <div role="tablist" aria-label={adapter.ariaLabels.tablist}
            className="flex flex-wrap gap-1 rounded-md border bg-muted/30 p-1">
            {(Object.keys(viewTitle) as PanelView[]).map((key) => (
              <Button key={key} role="tab" type="button" size="sm"
                variant={view === key ? "default" : "ghost"}
                aria-selected={view === key} onClick={() => setView(key)}>
                {viewTitle[key]}
              </Button>
            ))}
          </div>
        )}

        {/* Auth disclaimer */}
        {(selfService || view === "onboard") && (
          <div className="space-y-2 rounded-md border p-3 text-sm text-muted-foreground">
            {adapter.authzDisclaimer}
          </div>
        )}

        {/* Advanced tab */}
        {!selfService && view === "advanced" && (
          <div role="region" aria-label={adapter.ariaLabels.advancedRegion} className="space-y-3">
            <div
              data-section-tone="slate"
              className="rounded-md border border-slate-500/20 bg-slate-500/5 p-4 space-y-3"
            >
              <div>
                <h3 className="inline-flex items-center gap-2 text-base font-semibold tracking-tight">
                  <Settings2 className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
                  {adapter.copy.advancedHeading}
                </h3>
                <p className="text-xs text-muted-foreground">
                  {adapter.copy.advancedSectionDescription ?? adapter.copy.advancedTabDescription}
                </p>
              </div>
              <div className={`grid gap-2 text-sm ${adapter.advancedExtraTiles ? "md:grid-cols-4" : "md:grid-cols-3"}`}>
                <RuntimeTile
                  label="Route mode"
                  description={`Shows whether the ${adapter.copy.botNameInLegend} reads routes from database, YAML, or both.`}
                >
                  <div className="font-medium">{runtimeStatus?.route_mode ?? "unknown"}</div>
                </RuntimeTile>
                <RuntimeTile
                  label="Static config"
                  description={`Counts ${adapter.itemPlural}/routes currently loaded from ${adapter.copy.botNameInLegend} YAML.`}
                >
                  <div className="font-medium">{runtimeStatus ? adapter.staticConfigLabel({ items: Object.values(runtimeStatus.static_config)[0] ?? 0, routes: Object.values(runtimeStatus.static_config)[1] ?? 0 }) : "unknown"}</div>
                </RuntimeTile>
                <RuntimeTile
                  label="Route cache"
                  description={`Shows cached runtime ${adapter.itemSingular} routes and how soon they expire.`}
                >
                  <div className="font-medium">{runtimeStatus ? adapter.routeCacheLabel(runtimeStatus.route_cache.cache_size) : "unknown"}</div>
                  <div className="text-xs text-muted-foreground">TTL {runtimeStatus?.route_cache.ttl_seconds ?? "?"}s</div>
                </RuntimeTile>
                {runtimeStatus && adapter.advancedExtraTiles?.(runtimeStatus).map((tile) => (
                  <RuntimeTile key={tile.label} label={tile.label} description={tile.description}>
                    <div className="font-medium">{tile.value}</div>
                  </RuntimeTile>
                ))}
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <AdvancedActionButton
                  label="Refresh Runtime Status"
                  description="Reloads these status numbers from the running bot."
                  icon={<RefreshCw className="h-4 w-4" aria-hidden="true" />}
                  onClick={() => void refreshRuntimeStatus()}
                  disabled={disabled || loading}
                />
                <AdvancedActionButton
                  label="Reload Bot Cache"
                  description="Refreshes the running bot after UI route changes."
                  icon={<RotateCw className="h-4 w-4" aria-hidden="true" />}
                  onClick={() => void reloadBotRoutes()}
                  disabled={disabled || loading}
                />
                <div className="inline-flex items-center gap-1">
                  <Button type="button" onClick={() => void syncBotConfig(true)} disabled={disabled || loading}><FileUp className="h-4 w-4" aria-hidden="true" />Import from YAML</Button>
                </div>
              </div>
            </div>
            {adapter.advancedTabExtraSection?.({ disabled })}
          </div>
        )}

        {/* Sync modal */}
        <Dialog open={runtimeSyncModalOpen} onOpenChange={setRuntimeSyncModalOpen}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>{adapter.syncDialogueTitle(runtimeSyncModalMode)}</DialogTitle>
              <DialogDescription>{adapter.syncDialogueDescription}</DialogDescription>
            </DialogHeader>
            <div className="space-y-3">
              <div className="rounded-md border bg-muted/20 p-3 text-sm">
                <div className="font-medium">
                  {runtimeSyncModalStatus === "loading" ? (runtimeSyncModalMode === "preview" ? "Previewing..." : "Applying...")
                    : runtimeSyncModalStatus === "success" ? (runtimeSyncModalMode === "preview" ? "Preview complete" : "Apply complete")
                    : runtimeSyncModalStatus === "error" ? "Sync failed" : "Ready"}
                </div>
                <div className="text-xs text-muted-foreground">
                  {runtimeSyncModalStatus === "loading" ? `Contacting the ${adapter.connectorName} bot admin API...`
                    : "Static config sync is upsert-only and leaves existing UI-managed channel agents in place."}
                </div>
              </div>
              {runtimeSyncModalError && <div className="rounded-md border border-destructive/40 p-3 text-sm text-destructive">{runtimeSyncModalError}</div>}
              {runtimeSyncSummary && (
                <div className="grid gap-2 text-sm md:grid-cols-2">
                  <div className="rounded-md border p-3"><div className="text-xs text-muted-foreground">{adapter.syncSummaryItemsLabel}</div><div className="font-medium">{pluralize(runtimeSyncSummary.items_seen, adapter.itemSingular)} scanned</div></div>
                  <div className="rounded-md border p-3"><div className="text-xs text-muted-foreground">Planned routes</div><div className="font-medium">{pluralize(runtimeSyncSummary.routes_planned, "route")} planned</div></div>
                  <div className="rounded-md border p-3"><div className="text-xs text-muted-foreground">MongoDB route metadata</div><div className="font-medium">{pluralize(runtimeSyncSummary.routes_upserted, "route")} upserted</div></div>
                  <div className="rounded-md border p-3"><div className="text-xs text-muted-foreground">OpenFGA tuples</div><div className="font-medium">{pluralize(runtimeSyncSummary.openfga_tuples_written, "OpenFGA tuple")} written</div></div>
                </div>
              )}
              {runtimeSyncSummary?.channels && runtimeSyncSummary.channels.length > 0 && (
                <SyncPreviewBreakdown channels={runtimeSyncSummary.channels} />
              )}
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setRuntimeSyncModalOpen(false)} disabled={runtimeSyncModalStatus === "loading"}>Close</Button>
              {runtimeSyncModalMode === "preview" && runtimeSyncModalStatus === "success" && (
                <Button type="button" onClick={() => void syncBotConfig(false)} disabled={disabled || loading}><FileUp className="h-4 w-4" aria-hidden="true" />Apply Import</Button>
              )}
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Empty state */}
        {!selfService && view === "channels" && items.length === 0 && (
          <div className="rounded-md border border-dashed bg-muted/20 p-6 text-center text-sm text-muted-foreground">
            <p className="font-medium text-foreground">No {adapter.itemPlural} configured yet.</p>
            <p className="mt-1">Switch to <button type="button" className="underline underline-offset-2" onClick={() => setView("onboard")}>Onboard {adapter.itemPlural}</button> to find {adapter.connectorName} {adapter.itemPlural} where the bot is installed and set them up.</p>
          </div>
        )}

        {/* Configured items table */}
        {(selfService || view === "channels") && items.length > 0 && (
          <div role="region" aria-label={adapter.ariaLabels.configuredRegion}
            className="rounded-md border bg-background/60 overflow-hidden">
            <div className="flex flex-col gap-2 border-b bg-background/80 p-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="text-sm font-medium">
                {filteredConfiguredItems.length === items.length
                  ? `${items.length} configured ${adapter.itemPlural}`
                  : `${filteredConfiguredItems.length} of ${items.length} ${adapter.itemPlural}`}
              </div>
              <div className="flex w-full gap-2 sm:max-w-sm">
                <Input
                  value={configuredSearch}
                  onChange={(event) => setConfiguredSearch(event.target.value)}
                  placeholder={`Search ${adapter.itemPlural}`}
                  aria-label={`Search configured ${adapter.itemPlural}`}
                  className="h-8"
                />
                {configuredSearch && (
                  <Button type="button" variant="ghost" size="sm" onClick={() => setConfiguredSearch("")}>
                    Clear
                  </Button>
                )}
              </div>
            </div>
            <div className="overflow-auto" style={{ maxHeight: "min(70vh, 100vh - 320px)" }}>
              <table className="w-full text-sm">
                <thead className="bg-muted/40 text-xs uppercase tracking-wide text-muted-foreground">
                  <tr>
                    <th className="px-3 py-2 text-left font-medium">{adapter.itemSingular.charAt(0).toUpperCase() + adapter.itemSingular.slice(1)}</th>
                    <th className="px-3 py-2 text-left font-medium">Team</th>
                    <th className="px-3 py-2 text-left font-medium">Agents</th>
                    <th className="px-3 py-2 text-left font-medium">Health</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredConfiguredItems.length === 0 && (
                    <tr>
                      <td colSpan={4} className="px-3 py-6 text-center text-sm text-muted-foreground">
                        No configured {adapter.itemPlural} match “{configuredSearch.trim()}”.
                      </td>
                    </tr>
                  )}
                  {filteredConfiguredItems.map((item) => {
                    const key = adapter.itemKey(item);
                    const isSelected = key === selectedKey;
                    const grants = item.active_grants ?? 0;
                    const warningsCount = isSelected && diagnostics
                      ? diagnostics.warnings.length : item.health?.warnings_count;
                    const health = !item.team_slug
                      ? { label: "no team", className: "border-amber-300 bg-amber-50 text-amber-800" }
                      : typeof warningsCount === "number"
                        ? warningsCount > 0
                          ? { label: `${warningsCount} issue${warningsCount === 1 ? "" : "s"}`, className: "border-amber-300 bg-amber-50 text-amber-800" }
                          : { label: "healthy", className: "border-emerald-300 bg-emerald-50 text-emerald-700" }
                        : grants === 0
                          ? { label: "no agents", className: "border-amber-300 bg-amber-50 text-amber-800" }
                          : { label: "checking…", className: "border-slate-300 bg-slate-50 text-slate-600" };
                    const toggle = () => setSelectedKey(isSelected ? "" : key);
                    return (
                      <React.Fragment key={key}>
                        <tr role="button" tabIndex={0} aria-expanded={isSelected} onClick={toggle}
                          onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); toggle(); } }}
                          className={cn("cursor-pointer border-t transition-colors hover:bg-muted/30 focus:bg-muted/30 focus:outline-none", isSelected && "bg-muted/50")}>
                          <td className="px-3 py-2">
                            <div className="flex items-center gap-1.5">
                              <ChevronRight className={cn("h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform", isSelected && "rotate-90")} aria-hidden="true" />
                              <div>
                                <div className="font-medium">{item.item_name}</div>
                                <div className="text-xs text-muted-foreground">{item.item_id}</div>
                              </div>
                            </div>
                          </td>
                          <td className="px-3 py-2">{item.team_slug ? <Badge variant="secondary">team:{item.team_slug}</Badge> : <span className="text-xs text-muted-foreground">—</span>}</td>
                          <td className="px-3 py-2"><span className={grants === 0 ? "text-muted-foreground" : "font-medium"}>{grants}</span></td>
                          <td className="px-3 py-2"><Badge variant="outline" className={health.className}>{health.label}</Badge></td>
                        </tr>
                        {isSelected && (
                          <tr className="border-t bg-muted/20">
                            <td colSpan={4} className="p-4">
                              <ItemDetail
                                adapter={adapter} selected={item} diagnostics={diagnostics} routes={routes}
                                teams={teams}
                                setChannelTeam={setChannelTeam}
                                onCreateRoute={openCreateRoute}
                                onEditRoute={editRoute}
                                deleteRoute={setRoutePendingDelete}
                                fixDiagnosticRoute={fixDiagnosticRoute} fixMissingRouteableAgent={fixMissingRouteableAgent}
                                disabled={disabled} loading={loading} selectedCanManage={selectedCanManage} message={message}
                              />
                            </td>
                          </tr>
                        )}
                      </React.Fragment>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* Onboarding wizard */}
        {!selfService && view === "onboard" && (
          <ConnectorOnboardingWizard
            connectorName={adapter.connectorName}
            provider={adapter.discoveryCacheProvider}
            isAdmin={!selfService}
            itemSingular={adapter.itemSingular}
            itemPlural={adapter.itemPlural}
            discoveredLabel={adapter.copy.discoveryDiscoveredLabel}
            findLabel={adapter.copy.discoveryFindLabel}
            refreshLabel={adapter.copy.discoveryRefreshLabel}
            loadingLabel={adapter.copy.discoveryLoadingLabel}
            emptyLabel={adapter.copy.discoveryEmptyLabel}
            description={adapter.copy.discoveryDescription}
            discoveryStatusText={discoveryStatusText}
            discoveredCount={discoveredItems.length}
            newCount={discoveredNewCount}
            selectedCount={selectedDiscoveredRows.length}
            rows={discoveredRows.map((row) => ({
              id: row.id,
              name: row.name,
              secondary: row.secondary,
              selected: row.selected,
              teamSlug: row.team_slug,
              agentId: row.agent_id,
              isExisting: row.is_existing,
              importLabel: `Import ${row.name}`,
              teamLabel: `Team for ${row.name}`,
              agentLabel: `Dynamic Agent for ${row.name}`,
            }))}
            teams={teams.map((t) => ({ value: t.slug, label: t.name || t.slug }))}
            agents={sortedDynamicAgents.map((a) => ({ value: a._id, label: a.name || a._id }))}
            error={discoverError}
            disabled={disabled}
            loading={loading}
            discovering={discoverLoading}
            searchValue={discoverySearch}
            onSearchChange={setDiscoverySearch}
            enableBulkApply
            onDiscover={() => void discoverItems()}
            onSelectAll={() => setAllRowsSelected(true)}
            onClearSelection={() => setAllRowsSelected(false)}
            onRowChange={(id, updates) => updateDiscoveredRow(id, {
              ...(typeof updates.selected === "boolean" ? { selected: updates.selected } : {}),
              ...(typeof updates.teamSlug === "string" ? { team_slug: updates.teamSlug } : {}),
              ...(typeof updates.agentId === "string" ? { agent_id: updates.agentId } : {}),
            })}
            onApply={() => void applyOnboarding()}
          />
        )}

        {/* Route association editor dialog */}
        <Dialog
          open={routeEditorOpen}
          onOpenChange={(open) => {
            setRouteEditorOpen(open);
            if (!open && !loading) resetRouteForm();
          }}
        >
          <DialogContent className="max-h-[90vh] max-w-5xl overflow-y-auto">
            <DialogHeader>
              <DialogTitle>
                {editingRouteAgentId
                  ? `Edit agent:${editingRouteAgentId}`
                  : `Add Agent${selected ? ` to ${selected.item_name || selected.item_id}` : ""}`}
              </DialogTitle>
              <DialogDescription>
                Configure how this Slack channel routes messages to a Dynamic Agent. Optional response and escalation settings stay hidden until enabled.
              </DialogDescription>
            </DialogHeader>
            <RouteAssociationEditor
              selected={selected}
              dynamicAgents={dynamicAgents}
              routeDraft={routeDraft}
              setRouteDraft={setRouteDraft}
              editingRouteAgentId={editingRouteAgentId}
              saveRoute={saveRoute}
              onCancel={() => {
                setRouteEditorOpen(false);
                resetRouteForm();
              }}
              disabled={disabled}
              loading={loading}
              selectedCanManage={selectedCanManage}
            />
          </DialogContent>
        </Dialog>

        {/* Delete confirmation dialog */}
        <Dialog open={Boolean(routePendingDelete)} onOpenChange={(open) => { if (!open && !loading) setRoutePendingDelete(null); }}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Remove agent from {adapter.itemSingular}?</DialogTitle>
              <DialogDescription>
                {routePendingDelete ? `This removes agent:${routePendingDelete.agent_id} from the selected ${adapter.connectorName} ${adapter.itemSingular}.` : `This removes the selected agent from the ${adapter.connectorName} ${adapter.itemSingular}.`}
              </DialogDescription>
            </DialogHeader>
            <p className="text-sm text-muted-foreground">The OpenFGA tuple will be deleted, and the saved Mongo route metadata for listen mode and priority will be deleted as well.</p>
            {routePendingDelete && (
              <div className="rounded-md border bg-muted/30 p-3 text-sm">
                <div><span className="font-medium">Listen:</span> {routePendingDelete.users?.listen ?? "mention"}</div>
                <div><span className="font-medium">Priority:</span> {routePendingDelete.priority}</div>
              </div>
            )}
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setRoutePendingDelete(null)} disabled={loading}>Cancel</Button>
              <Button type="button" variant="destructive" onClick={() => void deleteRouteConfirmed()} disabled={loading}>{loading ? "Removing..." : "Remove agent"}</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </CardContent>
    </Card>
  );
}
