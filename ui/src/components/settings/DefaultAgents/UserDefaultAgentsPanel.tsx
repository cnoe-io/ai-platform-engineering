"use client";

import { AutoSaveStatus } from "@/components/settings/shared/AutoSaveStatus";
import { useAccessibleAgents } from "@/components/settings/DefaultAgents/useAccessibleAgents";
import { AgentPicker,type AgentPickerOption } from "@/components/ui/agent-picker";
import { useKeyedAutoSave,type AutoSaveState } from "@/hooks/use-keyed-auto-save";
import React,{ useCallback,useEffect,useRef,useState } from "react";

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
  integrations?: { slack?: boolean; webex?: boolean };
  platform_default_agent_id?: string | null;
  slack_default_agent_id?: string | null;
  web_default_agent_id?: string | null;
  webex_default_agent_id?: string | null;
}

interface PreferenceResponse {
  data?: PreferenceData;
  error?: string;
  success?: boolean;
}

const INITIAL_SELECTIONS: SurfaceSelections = {
  web: PLATFORM_DEFAULT_KEY,
  slack: PLATFORM_DEFAULT_KEY,
  webex: PLATFORM_DEFAULT_KEY,
};

const PREFERENCE_FIELDS: Record<Surface,SurfacePreferenceField> = {
  web: "web_default_agent_id",
  slack: "slack_default_agent_id",
  webex: "webex_default_agent_id",
};

async function fetchSavedPreferences(): Promise<PreferenceData> {
  const response = await fetch("/api/user/preferences",{
    method: "GET",
    credentials: "same-origin",
  });
  const json = (await response.json()) as PreferenceResponse;
  if (!response.ok || !json.success) {
    throw new Error(
      typeof json.error === "string"
        ? json.error
        : `Failed to load preferences (HTTP ${response.status})`,
    );
  }
  return json.data ?? {};
}

async function persistPreference(surface: Surface,value: string): Promise<void> {
  const response = await fetch("/api/user/preferences",{
    method: "PUT",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      [PREFERENCE_FIELDS[surface]]: value === PLATFORM_DEFAULT_KEY ? null : value,
    }),
  });
  const json = (await response.json()) as PreferenceResponse;
  if (!response.ok || !json.success) {
    throw new Error(
      typeof json.error === "string"
        ? json.error
        : `Failed to save (HTTP ${response.status})`,
    );
  }
}

interface DefaultAgentSettingProps {
  agentDescription: string | null;
  ariaLabel: string;
  description: string;
  disabled: boolean;
  onChange: (value: string) => void;
  onRetry: () => void;
  options: AgentPickerOption[];
  saveState: AutoSaveState;
  title: string;
  value: string;
}

function DefaultAgentSetting({
  agentDescription,
  ariaLabel,
  description,
  disabled,
  onChange,
  onRetry,
  options,
  saveState,
  title,
  value,
}: DefaultAgentSettingProps): React.ReactElement {
  return (
    <div className="space-y-3 rounded-lg border border-border/70 p-4">
      <div>
        <p className="text-sm font-medium">{title}</p>
        <p className="text-xs text-muted-foreground">{description}</p>
      </div>
      <AgentPicker
        ariaLabel={ariaLabel}
        clearValue={PLATFORM_DEFAULT_KEY}
        disabled={disabled}
        emptyLabel="No agents match"
        hideIdSuffix
        onChange={onChange}
        options={options}
        placeholder="Select your default agent..."
        searchPlaceholder="Search agents..."
        triggerClassName="max-w-sm"
        value={value}
      />
      {agentDescription ? (
        <p className="text-xs text-muted-foreground">
          {`Agent description: ${agentDescription}`}
        </p>
      ) : null}
      <AutoSaveStatus onRetry={onRetry} state={saveState} />
    </div>
  );
}

interface UserDefaultAgentsPanelProps {
  /** Suppress writes, for example while an admin previews another user. */
  disabled?: boolean;
}

export function UserDefaultAgentsPanel({
  disabled = false,
}: UserDefaultAgentsPanelProps): React.ReactElement {
  const {
    agents,
    error: agentsError,
    loading: agentsLoading,
    refresh: refreshAgents,
  } = useAccessibleAgents();
  const [selected,setSelected] = useState<SurfaceSelections>(INITIAL_SELECTIONS);
  const savedRef = useRef<SurfaceSelections>(INITIAL_SELECTIONS);
  const [integrations,setIntegrations] = useState({ slack: false,webex: false });
  const [preferenceLoading,setPreferenceLoading] = useState(true);
  const [platformDefaultId,setPlatformDefaultId] = useState<string | null>(null);
  const [loadError,setLoadError] = useState<string | null>(null);

  const autoSave = useKeyedAutoSave<Surface,string>({
    persist: persistPreference,
    onSuccess: (surface,value) => {
      savedRef.current = { ...savedRef.current,[surface]: value };
    },
    onError: (surface) => {
      setSelected((current) => ({
        ...current,
        [surface]: savedRef.current[surface],
      }));
    },
  });

  useEffect(() => {
    let cancelled = false;
    void fetchSavedPreferences()
      .then((data) => {
        if (cancelled) return;
        const loaded: SurfaceSelections = {
          web: data.web_default_agent_id ?? PLATFORM_DEFAULT_KEY,
          slack: data.slack_default_agent_id ?? PLATFORM_DEFAULT_KEY,
          webex: data.webex_default_agent_id ?? PLATFORM_DEFAULT_KEY,
        };
        savedRef.current = loaded;
        setSelected(loaded);
        setIntegrations({
          slack: data.integrations?.slack === true,
          webex: data.integrations?.webex === true,
        });
        setPlatformDefaultId(data.platform_default_agent_id ?? null);
      })
      .catch((reason: unknown) => {
        if (!cancelled) {
          setLoadError(reason instanceof Error ? reason.message : "Failed to load preferences");
        }
      })
      .finally(() => {
        if (!cancelled) setPreferenceLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const handleSelect = useCallback((surface: Surface,value: string) => {
    if (disabled || selected[surface] === value) return;
    setSelected((current) => ({ ...current,[surface]: value }));
    autoSave.enqueue(surface,value);
  }, [autoSave,disabled,selected]);

  const loading = agentsLoading || preferenceLoading;
  const agentOptions: AgentPickerOption[] = agents.map((agent) => ({
    value: agent.id,
    label: agent.name,
  }));
  const agentName = (agentId: string | null): string | null =>
    agentId ? agents.find((agent) => agent.id === agentId)?.name ?? agentId : null;
  const agentDescription = (agentId: string | null): string | null =>
    agentId ? agents.find((agent) => agent.id === agentId)?.description ?? null : null;
  const platformDefaultName = agentName(platformDefaultId);
  const defaultOptions: AgentPickerOption[] = [
    {
      value: PLATFORM_DEFAULT_KEY,
      label: platformDefaultName
        ? `Use platform default (${platformDefaultName})`
        : "Use platform default",
    },
    ...agentOptions,
  ];
  const selectedAgentId = (surface: Surface): string | null => {
    const value = selected[surface];
    return value === PLATFORM_DEFAULT_KEY ? platformDefaultId : value;
  };
  const retrySurface = (surface: Surface) => {
    const pendingValue = autoSave.pendingValueFor(surface);
    if (pendingValue !== undefined) {
      setSelected((current) => ({ ...current,[surface]: pendingValue }));
    }
    autoSave.retry(surface);
  };

  if (agentsError || loadError) {
    return (
      <div className="rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-sm">
        <p>Failed to load defaults: {agentsError ?? loadError}</p>
        {agentsError ? (
          <button
            className="mt-2 rounded border border-input bg-background px-2 py-1 text-xs"
            onClick={() => void refreshAgents()}
            type="button"
          >
            Retry
          </button>
        ) : null}
      </div>
    );
  }

  if (loading) {
    return <p className="text-sm text-muted-foreground">Loading default agents…</p>;
  }

  return (
    <div className="space-y-4">
      {agents.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No agents are currently available to you. You can still follow the platform default.
        </p>
      ) : null}

      <DefaultAgentSetting
        agentDescription={agentDescription(selectedAgentId("web"))}
        ariaLabel="Web default agent"
        description="Choose the agent your new Web chats open with."
        disabled={disabled}
        onChange={(value) => handleSelect("web",value)}
        onRetry={() => retrySurface("web")}
        options={defaultOptions}
        saveState={autoSave.stateFor("web")}
        title="Web default agent"
        value={selected.web}
      />

      {integrations.slack ? (
        <DefaultAgentSetting
          agentDescription={agentDescription(selectedAgentId("slack"))}
          ariaLabel="Slack default agent"
          description="Choose the agent your new Slack direct messages open with."
          disabled={disabled}
          onChange={(value) => handleSelect("slack",value)}
          onRetry={() => retrySurface("slack")}
          options={defaultOptions}
          saveState={autoSave.stateFor("slack")}
          title="Slack default agent"
          value={selected.slack}
        />
      ) : null}

      {integrations.webex ? (
        <DefaultAgentSetting
          agentDescription={agentDescription(selectedAgentId("webex"))}
          ariaLabel="Webex default agent"
          description="Choose the agent your new Webex direct messages open with."
          disabled={disabled}
          onChange={(value) => handleSelect("webex",value)}
          onRetry={() => retrySurface("webex")}
          options={defaultOptions}
          saveState={autoSave.stateFor("webex")}
          title="Webex default agent"
          value={selected.webex}
        />
      ) : null}
    </div>
  );
}
