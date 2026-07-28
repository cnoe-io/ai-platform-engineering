"use client";

import React,{ useCallback,useEffect,useState } from "react";

import { SaveButton } from "@/components/admin/shared/SaveButton";
import { useAccessibleAgents } from "@/components/settings/DefaultAgents/useAccessibleAgents";
import { AgentPicker,type AgentPickerOption } from "@/components/ui/agent-picker";

const PLATFORM_DEFAULT_KEY = "__platform_default__";

type Surface = "web" | "slack" | "webex";
type SurfacePreferenceField =
  | "web_default_agent_id"
  | "slack_default_agent_id"
  | "webex_default_agent_id";

interface SurfaceSelections {
  web: string;
  slack: string;
  webex: string;
}

interface PreferenceData {
  platform_default_agent_id?: string | null;
  web_default_agent_id?: string | null;
  slack_default_agent_id?: string | null;
  webex_default_agent_id?: string | null;
  integrations?: { slack?: boolean; webex?: boolean };
}

interface PreferenceResponse {
  success?: boolean;
  data?: PreferenceData;
  error?: string;
}

const INITIAL_SELECTIONS: SurfaceSelections = {
  web: PLATFORM_DEFAULT_KEY,
  slack: PLATFORM_DEFAULT_KEY,
  webex: PLATFORM_DEFAULT_KEY,
};

const PREFERENCE_FIELDS: Record<Surface, SurfacePreferenceField> = {
  web: "web_default_agent_id",
  slack: "slack_default_agent_id",
  webex: "webex_default_agent_id",
};

async function fetchSavedPreferences(): Promise<{
  data: PreferenceData;
  error: string | null;
}> {
  try {
    const response = await fetch("/api/user/preferences", {
      method: "GET",
      credentials: "same-origin",
    });
    const json = (await response.json()) as PreferenceResponse;
    if (!response.ok || !json.success) {
      return {
        data: {},
        error:
          typeof json.error === "string"
            ? json.error
            : `Failed to load preferences (HTTP ${response.status})`,
      };
    }
    return { data: json.data ?? {}, error: null };
  } catch (err) {
    return {
      data: {},
      error: err instanceof Error ? err.message : "Failed to load preferences",
    };
  }
}

async function persistPreferences(
  preferences: Partial<Record<SurfacePreferenceField,string | null>>,
): Promise<{ ok: boolean; error: string | null }> {
  try {
    const response = await fetch("/api/user/preferences", {
      method: "PUT",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(preferences),
    });
    const json = (await response.json()) as PreferenceResponse;
    if (!response.ok || !json.success) {
      return {
        ok: false,
        error:
          typeof json.error === "string"
            ? json.error
            : `Failed to save (HTTP ${response.status})`,
      };
    }
    return { ok: true, error: null };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Failed to save preference",
    };
  }
}

interface DefaultAgentSettingProps {
  title: string;
  description: string;
  ariaLabel: string;
  options: AgentPickerOption[];
  value: string;
  agentDescription: string | null;
  disabled: boolean;
  onChange: (value: string) => void;
}

function DefaultAgentSetting({
  title,
  description,
  ariaLabel,
  options,
  value,
  agentDescription,
  disabled,
  onChange,
}: DefaultAgentSettingProps): React.ReactElement {
  return (
    <div className="space-y-3">
      <div>
        <p className="text-sm font-medium">{title}</p>
        <p className="text-xs text-muted-foreground">{description}</p>
      </div>
      <AgentPicker
        ariaLabel={ariaLabel}
        options={options}
        value={value}
        onChange={onChange}
        disabled={disabled}
        clearValue={PLATFORM_DEFAULT_KEY}
        hideIdSuffix
        placeholder="Select your default agent..."
        searchPlaceholder="Search agents..."
        emptyLabel="No agents match"
        triggerClassName="max-w-sm"
      />
      {agentDescription ? (
        <p className="text-xs text-muted-foreground">
          {`Agent Description: ${agentDescription}`}
        </p>
      ) : null}
    </div>
  );
}

interface UserDefaultAgentsPanelProps {
  /** Suppress writes (e.g. when an admin is previewing as another user). */
  disabled?: boolean;
}

export function UserDefaultAgentsPanel({
  disabled = false,
}: UserDefaultAgentsPanelProps): React.ReactElement {
  const { agents, loading: agentsLoading, error: agentsError, refresh: refreshAgents } =
    useAccessibleAgents();
  const [selected, setSelected] = useState<SurfaceSelections>(INITIAL_SELECTIONS);
  const [saved, setSaved] = useState<SurfaceSelections>(INITIAL_SELECTIONS);
  const [integrations, setIntegrations] = useState({ slack: false, webex: false });
  const [preferenceLoading, setPreferenceLoading] = useState(true);
  const [platformDefaultId, setPlatformDefaultId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveResult, setSaveResult] = useState<"success" | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const { data, error } = await fetchSavedPreferences();
      if (cancelled) return;
      const loaded: SurfaceSelections = {
        web: data.web_default_agent_id ?? PLATFORM_DEFAULT_KEY,
        slack: data.slack_default_agent_id ?? PLATFORM_DEFAULT_KEY,
        webex: data.webex_default_agent_id ?? PLATFORM_DEFAULT_KEY,
      };
      setSelected(loaded);
      setSaved(loaded);
      setIntegrations({
        slack: data.integrations?.slack === true,
        webex: data.integrations?.webex === true,
      });
      setPlatformDefaultId(data.platform_default_agent_id ?? null);
      setLoadError(error);
      setPreferenceLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const handleSelect = useCallback(
    (surface: Surface, value: string) => {
      if (disabled) return;
      setSelected((current) => ({ ...current, [surface]: value }));
      setSaveResult(null);
      setSaveError(null);
    },
    [disabled],
  );

  const handleSave = useCallback(
    async () => {
      if (disabled) return;
      const activeSurfaces: Surface[] = [
        "web",
        ...(integrations.slack ? (["slack"] as const) : []),
        ...(integrations.webex ? (["webex"] as const) : []),
      ];
      const changedSurfaces = activeSurfaces.filter(
        (surface) => selected[surface] !== saved[surface],
      );
      if (changedSurfaces.length === 0) return;

      const nextSelected = { ...selected };
      const updates: Partial<Record<SurfacePreferenceField,string | null>> = {};
      for (const surface of changedSurfaces) {
        updates[PREFERENCE_FIELDS[surface]] =
          nextSelected[surface] === PLATFORM_DEFAULT_KEY
            ? null
            : nextSelected[surface];
      }

      setSaving(true);
      setSaveResult(null);
      setSaveError(null);
      const { ok, error } = await persistPreferences(updates);
      if (ok) {
        setSaved((current) => {
          const next = { ...current };
          for (const surface of changedSurfaces) next[surface] = nextSelected[surface];
          return next;
        });
        setSaveResult("success");
        setTimeout(() => {
          setSaveResult(null);
        }, 3000);
      } else {
        setSaveError(error ?? "Failed to save preferences");
      }
      setSaving(false);
    },
    [disabled, integrations, saved, selected],
  );

  const loading = agentsLoading || preferenceLoading;
  const agentOptions: AgentPickerOption[] = agents.map((agent) => ({
    value: agent.id,
    label: agent.name,
  }));
  const agentName = (agentId: string | null): string | null =>
    agentId
      ? agents.find((agent) => agent.id === agentId)?.name ?? agentId
      : null;
  const agentDescription = (agentId: string | null): string | null =>
    agentId
      ? agents.find((agent) => agent.id === agentId)?.description ?? null
      : null;
  const platformDefaultName = agentName(platformDefaultId);
  const fallbackLabel = platformDefaultName
    ? `Use platform default (${platformDefaultName})`
    : "Use platform default";
  const defaultOptions: AgentPickerOption[] = [
    { value: PLATFORM_DEFAULT_KEY, label: fallbackLabel },
    ...agentOptions,
  ];
  const selectedAgentId = (surface: Surface): string | null => {
    const value = selected[surface];
    return value === PLATFORM_DEFAULT_KEY ? platformDefaultId : value;
  };
  const dirty =
    selected.web !== saved.web ||
    (integrations.slack && selected.slack !== saved.slack) ||
    (integrations.webex && selected.webex !== saved.webex);

  return (
    <div className="space-y-5">
      <div>
        <p className="text-sm font-medium">My default agents</p>
        <p className="text-xs text-muted-foreground">
          Choose which agent opens new conversations on each active surface.
        </p>
      </div>

      {agentsError || loadError ? (
        <div className="rounded border border-destructive/40 bg-destructive/10 p-3 text-sm">
          <p>Failed to load defaults: {agentsError ?? loadError}</p>
          {agentsError ? (
            <button
              type="button"
              className="mt-2 rounded border border-input bg-background px-2 py-1 text-xs"
              onClick={() => void refreshAgents()}
            >
              Retry
            </button>
          ) : null}
        </div>
      ) : loading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : (
        <div className="space-y-5">
          {agents.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No agents are currently available to you. You can still choose to
              follow the configured defaults.
            </p>
          ) : null}

          <DefaultAgentSetting
            title="Web default agent"
            description="Choose the agent your new Web chats open with."
            ariaLabel="Web default agent"
            options={defaultOptions}
            value={selected.web}
            agentDescription={agentDescription(selectedAgentId("web"))}
            disabled={disabled || saving}
            onChange={(value) => handleSelect("web", value)}
          />

          {integrations.slack ? (
            <DefaultAgentSetting
              title="Slack default agent"
              description="Choose the agent your new Slack direct messages open with."
              ariaLabel="Slack default agent"
              options={defaultOptions}
              value={selected.slack}
              agentDescription={agentDescription(selectedAgentId("slack"))}
              disabled={disabled || saving}
              onChange={(value) => handleSelect("slack", value)}
            />
          ) : null}

          {integrations.webex ? (
            <DefaultAgentSetting
              title="Webex default agent"
              description="Choose the agent your new Webex direct messages open with."
              ariaLabel="Webex default agent"
              options={defaultOptions}
              value={selected.webex}
              agentDescription={agentDescription(selectedAgentId("webex"))}
              disabled={disabled || saving}
              onChange={(value) => handleSelect("webex", value)}
            />
          ) : null}

          <SaveButton
            onSave={handleSave}
            saving={saving}
            dirty={dirty}
            disabled={disabled}
            result={saveResult}
            ariaLabel="Save personal default agents"
            testId="personal-default-agents-save"
          />
          {saveError ? (
            <div className="rounded border border-destructive/40 bg-destructive/10 p-2 text-sm">
              {saveError}
            </div>
          ) : null}
        </div>
      )}
    </div>
  );
}
