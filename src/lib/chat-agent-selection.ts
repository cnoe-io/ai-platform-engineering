"use client";

import type { DynamicAgentConfig } from "@/types/dynamic-agent";

interface ApiEnvelope<T> {
  success?: boolean;
  data?: T;
  error?: string;
}

export interface ResolvedChatAgent {
  id: string;
  name: string;
  source: "platform-default" | "first-available";
}

async function fetchJson<T>(url: string): Promise<T> {
  const response = await fetch(url, { cache: "no-store" });
  if (!response.ok) {
    throw new Error(`Failed to load ${url}: ${response.status}`);
  }
  return response.json() as Promise<T>;
}

async function fetchPlatformDefaultAgentId(): Promise<string | null> {
  const payload = await fetchJson<ApiEnvelope<{ default_agent_id?: unknown }>>(
    "/api/admin/platform-config",
  );
  const value = payload.success ? payload.data?.default_agent_id : null;
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

async function fetchAvailableAgents(): Promise<DynamicAgentConfig[]> {
  const payload = await fetchJson<ApiEnvelope<DynamicAgentConfig[]>>(
    "/api/dynamic-agents/available",
  );
  if (!payload.success || !Array.isArray(payload.data)) {
    throw new Error(payload.error || "Failed to load available agents");
  }
  return payload.data.filter((agent) => agent.enabled);
}

export async function resolveUsableChatAgent(): Promise<ResolvedChatAgent> {
  const [defaultResult, agentsResult] = await Promise.allSettled([
    fetchPlatformDefaultAgentId(),
    fetchAvailableAgents(),
  ]);

  const defaultAgentId =
    defaultResult.status === "fulfilled" ? defaultResult.value : null;
  const availableAgents =
    agentsResult.status === "fulfilled" ? agentsResult.value : [];

  if (defaultAgentId) {
    const defaultAgent = availableAgents.find((agent) => agent._id === defaultAgentId);
    if (defaultAgent) {
      return {
        id: defaultAgent._id,
        name: defaultAgent.name,
        source: "platform-default",
      };
    }

    if (agentsResult.status === "rejected") {
      return {
        id: defaultAgentId,
        name: "Default agent",
        source: "platform-default",
      };
    }
  }

  const fallbackAgent = availableAgents[0];
  if (fallbackAgent) {
    return {
      id: fallbackAgent._id,
      name: fallbackAgent.name,
      source: "first-available",
    };
  }

  throw new Error(
    "No dynamic agents are available. Ask an administrator to configure a default agent or grant you access to an agent.",
  );
}

export async function resolveUsableChatAgentId(): Promise<string> {
  return (await resolveUsableChatAgent()).id;
}
