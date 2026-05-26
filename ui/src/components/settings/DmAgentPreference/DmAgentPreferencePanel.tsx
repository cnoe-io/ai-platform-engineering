"use client";

import React, { useCallback, useEffect, useState } from "react";

import { useAccessibleAgents } from "./useAccessibleAgents";

const DEPLOYMENT_DEFAULT_KEY = "__deployment_default__";

interface PreferenceResponse {
  success?: boolean;
  data?: { dm_default_agent_id: string | null };
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
    return { agentId: json.data?.dm_default_agent_id ?? null, error: null };
  } catch (err) {
    return {
      agentId: null,
      error: err instanceof Error ? err.message : "Failed to load preference",
    };
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
      body: JSON.stringify({ dm_default_agent_id: agentIdOrNull }),
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

/**
 * DM Default Agent picker. Renders a list of agents the user has `can_use`
 * on, plus a synthetic "Deployment default" entry. Selecting an agent
 * upserts the user's preference; selecting deployment default clears it.
 *
 * Spec FR-019..FR-022.
 */
export function DmAgentPreferencePanel(): React.ReactElement {
  const { agents, loading: agentsLoading, error: agentsError, refresh: refreshAgents } =
    useAccessibleAgents();
  const [selected, setSelected] = useState<string>(DEPLOYMENT_DEFAULT_KEY);
  const [preferenceLoading, setPreferenceLoading] = useState<boolean>(true);
  const [saving, setSaving] = useState<boolean>(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const { agentId, error } = await fetchSavedPreference();
      if (cancelled) return;
      setSelected(agentId ?? DEPLOYMENT_DEFAULT_KEY);
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
      if (key === selected) return;
      setSelected(key);
      setSaving(true);
      setSaveError(null);
      const agentIdOrNull = key === DEPLOYMENT_DEFAULT_KEY ? null : key;
      const { ok, error } = await persistPreference(agentIdOrNull);
      if (!ok) {
        setSaveError(error ?? "Failed to save preference");
      }
      setSaving(false);
    },
    [selected],
  );

  const loading = agentsLoading || preferenceLoading;

  return (
    <section className="space-y-3">
      <header>
        <h3 className="font-medium">DM Default Agent</h3>
        <p className="text-sm text-muted-foreground">
          When you send a direct message to the bot, route the conversation to
          this agent by default. The bot still re-checks your permissions on
          every message.
        </p>
      </header>

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
        <ul className="space-y-2" role="radiogroup">
          <li>
            <label className="flex items-start gap-2 rounded border border-input p-2 cursor-pointer">
              <input
                type="radio"
                name="dm-default-agent"
                value={DEPLOYMENT_DEFAULT_KEY}
                checked={selected === DEPLOYMENT_DEFAULT_KEY}
                onChange={() => void handleSelect(DEPLOYMENT_DEFAULT_KEY)}
                disabled={saving}
              />
              <span>
                <span className="block font-medium">Use deployment default</span>
                <span className="block text-xs text-muted-foreground">
                  Let the platform pick the default agent. You can change this at
                  any time.
                </span>
              </span>
            </label>
          </li>
          {agents.map((agent) => (
            <li key={agent.id}>
              <label className="flex items-start gap-2 rounded border border-input p-2 cursor-pointer">
                <input
                  type="radio"
                  name="dm-default-agent"
                  value={agent.id}
                  checked={selected === agent.id}
                  onChange={() => void handleSelect(agent.id)}
                  disabled={saving}
                />
                <span>
                  <span className="block font-medium">{agent.name}</span>
                  {agent.description ? (
                    <span className="block text-xs text-muted-foreground">
                      {agent.description}
                    </span>
                  ) : null}
                </span>
              </label>
            </li>
          ))}
        </ul>
      )}

      {saveError ? (
        <div className="rounded border border-destructive/40 bg-destructive/10 p-2 text-sm">
          {saveError}
        </div>
      ) : null}
    </section>
  );
}
