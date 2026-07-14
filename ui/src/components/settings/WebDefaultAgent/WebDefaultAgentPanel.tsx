"use client";

import React,{ useCallback,useEffect,useState } from "react";

import { useAccessibleAgents } from "@/components/settings/DmAgentPreference/useAccessibleAgents";

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
 * has access to, plus a synthetic "Platform default" entry. Selecting an
 * agent upserts the user's `web_default_agent_id`; selecting platform default
 * clears it so new chats fall through to the admin-configured default.
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
  const [preferenceLoading, setPreferenceLoading] = useState<boolean>(true);
  const [platformDefaultId, setPlatformDefaultId] = useState<string | null>(null);
  const [saving, setSaving] = useState<boolean>(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const [{ agentId, error }, platformId] = await Promise.all([
        fetchSavedPreference(),
        fetchPlatformDefaultAgentId(),
      ]);
      if (cancelled) return;
      setSelected(agentId ?? PLATFORM_DEFAULT_KEY);
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
    async (key: string) => {
      if (disabled || key === selected) return;
      setSelected(key);
      setSaving(true);
      setSaveError(null);
      const agentIdOrNull = key === PLATFORM_DEFAULT_KEY ? null : key;
      const { ok, error } = await persistPreference(agentIdOrNull);
      if (!ok) {
        setSaveError(error ?? "Failed to save preference");
      }
      setSaving(false);
    },
    [disabled, selected],
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

  return (
    <div className="space-y-3">
      <div>
        <p className="text-sm font-medium">My default agent</p>
        <p className="text-xs text-muted-foreground">
          Choose the agent your new web chats open with. This overrides the
          platform default just for you. Pick <em>Use platform default</em> to
          follow whatever your administrators have configured.
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
        // A user may own hundreds of agents, so this is a dropdown rather than
        // a radio list. Defaults to "Use platform default".
        <select
          aria-label="My default agent"
          value={selected}
          onChange={(e) => void handleSelect(e.target.value)}
          disabled={inputsDisabled}
          className="w-full max-w-sm h-9 rounded-md border border-input bg-background px-3 text-sm focus:outline-none focus:ring-1 focus:ring-ring disabled:opacity-60"
        >
          <option value={PLATFORM_DEFAULT_KEY}>{platformDefaultLabel}</option>
          {agents.map((agent) => (
            <option key={agent.id} value={agent.id}>
              {agent.name}
            </option>
          ))}
        </select>
      )}

      {saveError ? (
        <div className="rounded border border-destructive/40 bg-destructive/10 p-2 text-sm">
          {saveError}
        </div>
      ) : null}
    </div>
  );
}
