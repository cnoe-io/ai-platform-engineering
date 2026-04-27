"use client";

import { useState, useEffect, useCallback, startTransition } from "react";
import { getConfig } from "@/lib/config";

/**
 * Canonical display labels for known subagent identifiers.
 * Unknown agents get a capitalised version of their key.
 * "user_input" is handled dynamically in {@link labelFor} via APP_NAME.
 */
const KNOWN_LABELS: Record<string, string> = {
  github: "GitHub",
  backstage: "Backstage",
  aws: "AWS",
  argocd: "ArgoCD",
  aigateway: "AI Gateway",
  jira: "Jira",
  webex: "Webex",
  slack: "Slack",
  pagerduty: "PagerDuty",
  splunk: "Splunk",
  komodor: "Komodor",
  confluence: "Confluence",
  weather: "Weather",
  rag: "RAG",
};

export interface AgentOption {
  value: string;
  label: string;
}

export interface AgentToolsData {
  /** Map of agent name → tool names */
  toolsMap: Record<string, string[]>;
  /** Ordered list of agent options for dropdowns */
  agents: AgentOption[];
  /** Whether data is still loading */
  loading: boolean;
  /** Whether the fetch failed */
  error: boolean;
  /** Human-readable error message */
  errorMessage: string;
  /** Re-fetch from the supervisor */
  refresh: () => void;
}

interface FetchResult {
  ok: boolean;
  tools: Record<string, string[]>;
  errorMessage: string;
}

let _cache: FetchResult | null = null;
let _fetchPromise: Promise<FetchResult> | null = null;

export function labelFor(key: string): string {
  if (key === "user_input") return `User Input (${getConfig("appName")})`;
  return KNOWN_LABELS[key] ?? key.charAt(0).toUpperCase() + key.slice(1);
}

async function fetchTools(): Promise<FetchResult> {
  if (_cache?.ok) return _cache;
  if (_fetchPromise) return _fetchPromise;

  _fetchPromise = (async () => {
    try {
      const res = await fetch("/api/agents/tools");
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        return {
          ok: false,
          tools: {},
          errorMessage: body?.error ?? `Supervisor returned ${res.status}`,
        };
      }
      const json = await res.json();
      const tools: Record<string, string[]> =
        json?.data?.tools ?? json?.tools ?? {};
      const result: FetchResult = { ok: true, tools, errorMessage: "" };
      _cache = result;
      return result;
    } catch (err) {
      return {
        ok: false,
        tools: {},
        errorMessage:
          err instanceof Error ? err.message : "Could not reach supervisor",
      };
    } finally {
      _fetchPromise = null;
    }
  })();

  return _fetchPromise;
}

/**
 * Hook that returns the dynamically discovered agents and their tools
 * from the running supervisor.  Results are cached for the session once
 * a successful response is received.
 *
 * "user_input" is always included (it has no MCP tools but is always valid).
 */
export function useAgentTools(): AgentToolsData {
  const [result, setResult] = useState<FetchResult>(
    _cache ?? { ok: false, tools: {}, errorMessage: "" }
  );
  const [loading, setLoading] = useState(!_cache?.ok);

  const load = useCallback(async () => {
    setLoading(true);
    const r = await fetchTools();
    setResult(r);
    setLoading(false);
  }, []);

  useEffect(() => {
    if (!_cache?.ok) {
      startTransition(() => {
        void load();
      });
    }
  }, [load]);

  const refresh = useCallback(() => {
    _cache = null;
    _fetchPromise = null;
    load();
  }, [load]);

  const agents: AgentOption[] = buildAgentList(result.tools);

  return {
    toolsMap: result.tools,
    agents,
    loading,
    error: !loading && !result.ok,
    errorMessage: result.errorMessage,
    refresh,
  };
}

function buildAgentList(toolsMap: Record<string, string[]>): AgentOption[] {
  const keys = Object.keys(toolsMap);

  const hasUserInput = keys.includes("user_input");
  const result: AgentOption[] = hasUserInput
    ? []
    : [{ value: "user_input", label: labelFor("user_input") }];

  const sorted = [...keys].sort((a, b) => {
    if (a === "user_input") return -1;
    if (b === "user_input") return 1;
    return labelFor(a).localeCompare(labelFor(b));
  });

  for (const key of sorted) {
    result.push({ value: key, label: labelFor(key) });
  }

  return result;
}
