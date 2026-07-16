"use client";

import React,{ useCallback,useEffect,useState } from "react";

import { SaveButton } from "@/components/admin/shared/SaveButton";
import { useAccessibleAgents } from "@/components/settings/DmAgentPreference/useAccessibleAgents";
import { AgentPicker,type AgentPickerOption } from "@/components/ui/agent-picker";

const PLATFORM_DEFAULT_KEY = "__platform_default__";

interface PreferenceResponse {
  success?: boolean;
  data?: { web_default_agent_id?: string | null };
  error?: string;
}

async function fetchSavedPreference(): Promise<{
  agentId: string | null;
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
        agentId: null,
        error:
          typeof json.error === "string"
            ? json.error
            : `Failed to load preference (HTTP ${response.status})`,
      };
    }
    return { agentId: json.data?.web_default_agent_id ?? null, error: null };
  } catch (err) {
    return {
      agentId: null,
      error: err instanceof Error ? err.message : "Failed to load preference",
    };
  }
}

interface PlatformConfigResponse {
  success?: boolean;
  data?: { default_agent_id?: string | null };
}

/** Read the admin-configured platform default agent id (null if unset). */
async function fetchPlatformDefaultAgentId(): Promise<string | null> {
  try {
    const response = await fetch("/api/admin/platform-config", {
      method: "GET",
      credentials: "same-origin",
    });
    const json = (await response.json()) as PlatformConfigResponse;
    if (!response.ok || !json.success) return null;
    return json.data?.default_agent_id ?? null;
  } catch {
    return null;
  }
}

async function persistPreference(
  agentIdOrNull: string | null,
): Promise<{ ok: boolean; error: string | null }> {
  try {
    const response = await fetch("/api/user/preferences", {
      method: "PUT",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ web_default_agent_id: agentIdOrNull }),
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

interface WebDefaultAgentPanelProps {
  /** Suppress writes (e.g. when an admin is previewing as another user). */
  disabled?: boolean;
}

/**
 * Personal "Default Agent" section for the Web UI. Lists the agents the user
 * has access to, plus a synthetic "Platform default" entry. Saving an agent
 * upserts the user's `web_default_agent_id`; saving platform default clears it
 * so new chats fall through to the admin-configured default.
 *
 * Renders as a bare section (no Card) so it can be embedded as the "user"
 * portion of the combined Default Agent card, above the admin platform-default
 * section — mirroring the Release Notes settings layout.
 */
export function WebDefaultAgentPanel({
  disabled = false,
}: WebDefaultAgentPanelProps): React.ReactElement {
  const { agents, loading: agentsLoading, error: agentsError, refresh: refreshAgents } =
    useAccessibleAgents();
  const [selected, setSelected] = useState<string>(PLATFORM_DEFAULT_KEY);
  const [saved, setSaved] = useState<string>(PLATFORM_DEFAULT_KEY);
  const [preferenceLoading, setPreferenceLoading] = useState<boolean>(true);
  const [platformDefaultId, setPlatformDefaultId] = useState<string | null>(null);
  const [saving, setSaving] = useState<boolean>(false);
  const [saveResult, setSaveResult] = useState<"success" | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const [{ agentId, error }, platformId] = await Promise.all([
        fetchSavedPreference(),
        fetchPlatformDefaultAgentId(),
      ]);
      if (cancelled) return;
      const savedKey = agentId ?? PLATFORM_DEFAULT_KEY;
      setSelected(savedKey);
      setSaved(savedKey);
      setPlatformDefaultId(platformId);
      if (error) {
        setSaveError(error);
      }
      setPreferenceLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const handleSelect = useCallback(
    (key: string) => {
      if (disabled) return;
      setSelected(key);
      setSaveResult(null);
      setSaveError(null);
    },
    [disabled],
  );

  const handleSave = useCallback(
    async () => {
      if (disabled || selected === saved) return;
      setSaving(true);
      setSaveResult(null);
      setSaveError(null);
      const agentIdOrNull = selected === PLATFORM_DEFAULT_KEY ? null : selected;
      const { ok, error } = await persistPreference(agentIdOrNull);
      if (ok) {
        setSaved(selected);
        setSaveResult("success");
        setTimeout(() => setSaveResult(null), 3000);
      } else {
        setSaveError(error ?? "Failed to save preference");
      }
      setSaving(false);
    },
    [disabled, saved, selected],
  );

  const loading = agentsLoading || preferenceLoading;
  const inputsDisabled = saving || disabled;

  // Show which agent the platform default currently resolves to, e.g.
  // "Use platform default (Basic SRE)". Falls back to the raw id when the
  // agent isn't in the user's accessible list, and to a plain label when no
  // platform default is configured.
  const platformDefaultName = platformDefaultId
    ? agents.find((a) => a.id === platformDefaultId)?.name ?? platformDefaultId
    : null;
  const platformDefaultLabel = platformDefaultName
    ? `Use platform default (${platformDefaultName})`
    : "Use platform default";
  const pickerOptions: AgentPickerOption[] = [
    { value: PLATFORM_DEFAULT_KEY, label: platformDefaultLabel },
    ...agents.map((agent) => ({ value: agent.id, label: agent.name })),
  ];
  const selectedAgentId =
    selected === PLATFORM_DEFAULT_KEY ? platformDefaultId : selected;
  const selectedAgentDescription = selectedAgentId
    ? agents.find((agent) => agent.id === selectedAgentId)?.description
    : null;

  return (
    <div className="space-y-3">
      <div>
        <p className="text-sm font-medium">My default agent</p>
        <p className="text-xs text-muted-foreground">
          Choose the agent your new web chats open with.
        </p>
      </div>

      {agentsError ? (
        <div className="rounded border border-destructive/40 bg-destructive/10 p-3 text-sm">
          <p>Failed to load agents: {agentsError}</p>
          <button
            type="button"
            className="mt-2 rounded border border-input bg-background px-2 py-1 text-xs"
            onClick={() => {
              void refreshAgents();
            }}
          >
            Retry
          </button>
        </div>
      ) : loading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : agents.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No agents available to you yet. Ask an administrator to grant you
          access to an agent or to add you to a team that has one.
        </p>
      ) : (
        <AgentPicker
          ariaLabel="My default agent"
          options={pickerOptions}
          value={selected}
          onChange={(value) => void handleSelect(value)}
          disabled={inputsDisabled}
          clearValue={PLATFORM_DEFAULT_KEY}
          hideIdSuffix
          placeholder="Select your default agent..."
          searchPlaceholder="Search agents..."
          emptyLabel="No agents match"
          triggerClassName="max-w-sm"
        />
      )}

      {!loading && !agentsError && selectedAgentDescription ? (
        <p className="text-xs text-muted-foreground">
          {`Agent Description: ${selectedAgentDescription}`}
        </p>
      ) : null}

      {!loading && !agentsError && agents.length > 0 ? (
        <SaveButton
          onSave={handleSave}
          saving={saving}
          dirty={selected !== saved}
          disabled={disabled}
          result={saveResult}
          ariaLabel="Save my default agent"
          testId="web-default-agent-save"
        />
      ) : null}

      {saveError ? (
        <div className="rounded border border-destructive/40 bg-destructive/10 p-2 text-sm">
          {saveError}
        </div>
      ) : null}
    </div>
  );
}
