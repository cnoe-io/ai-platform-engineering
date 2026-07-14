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
  source: "user-default" | "platform-default" | "first-available";
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

/**
 * The user's personal Web new-chat default, when they've set one. A missing
 * or cleared preference resolves to null so we fall through to the platform
 * default. Never throws — a preference-service hiccup must not block new chats.
 */
async function fetchUserWebDefaultAgentId(): Promise<string | null> {
  try {
    const payload = await fetchJson<ApiEnvelope<{ web_default_agent_id?: unknown }>>(
      "/api/user/preferences",
    );
    const value = payload.success ? payload.data?.web_default_agent_id : null;
    return typeof value === "string" && value.trim() ? value.trim() : null;
  } catch {
    return null;
  }
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
  const [userDefaultResult, defaultResult, agentsResult] = await Promise.allSettled([
    fetchUserWebDefaultAgentId(),
    fetchPlatformDefaultAgentId(),
    fetchAvailableAgents(),
  ]);

  const userDefaultAgentId =
    userDefaultResult.status === "fulfilled" ? userDefaultResult.value : null;
  const defaultAgentId =
    defaultResult.status === "fulfilled" ? defaultResult.value : null;
  const availableAgents =
    agentsResult.status === "fulfilled" ? agentsResult.value : [];

  // Highest priority: the user's own Web default, but only if they still have
  // access to it (it's in the available list). A stale/revoked choice falls
  // through to the platform default rather than dead-ending the new chat.
  if (userDefaultAgentId) {
    const userAgent = availableAgents.find((agent) => agent._id === userDefaultAgentId);
    if (userAgent) {
      return {
        id: userAgent._id,
        name: userAgent.name,
        source: "user-default",
      };
    }
  }

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
