"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { config } from "@/lib/config";

export type HealthStatus = "checking" | "connected" | "disconnected";

const POLL_INTERVAL_MS = 30000; // 30 seconds

interface AgentInfo {
  name: string;
  description?: string;
}

interface UseCAIPEHealthResult {
  status: HealthStatus;
  url: string;
  lastChecked: Date | null;
  secondsUntilNextCheck: number;
  agents: AgentInfo[];
  checkNow: () => void;
}

/**
 * Hook to check CAIPE supervisor health status
 * Polls every 30 seconds and considers 401 as reachable (auth required but server is up)
 */
export function useCAIPEHealth(): UseCAIPEHealthResult {
  const [status, setStatus] = useState<HealthStatus>("checking");
  const [lastChecked, setLastChecked] = useState<Date | null>(null);
  const [secondsUntilNextCheck, setSecondsUntilNextCheck] = useState(0);
  const [agents, setAgents] = useState<AgentInfo[]>([]);
  const nextCheckTimeRef = useRef<number>(Date.now() + POLL_INTERVAL_MS);
  const url = config.caipeUrl;

  const checkHealth = useCallback(async () => {
    setStatus("checking");

    try {
      // Use the A2A agent card endpoint which supports GET
      // Base URL is like http://localhost:8000, agent card is at /.well-known/agent.json
      const baseUrl = url.replace(/\/$/, ''); // Remove trailing slash
      const agentCardUrl = `${baseUrl}/.well-known/agent.json`;

      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 5000);

      const response = await fetch(agentCardUrl, {
        method: "GET",
        signal: controller.signal,
        headers: {
          "Accept": "application/json",
        },
      });

      clearTimeout(timeoutId);

      // Any HTTP response (even 4xx/5xx) means server is reachable
      setStatus("connected");
      setLastChecked(new Date());
      nextCheckTimeRef.current = Date.now() + POLL_INTERVAL_MS;

      // Try to parse agent card to get available agents
      if (response.ok) {
        try {
          const agentCard = await response.json();
          // Extract available agents from the agent card
          // The agent card may have different structures, try to be flexible
          const availableAgents: AgentInfo[] = [];
          
          if (agentCard.agents && Array.isArray(agentCard.agents)) {
            // If agents is an array of objects with name/description
            availableAgents.push(...agentCard.agents.map((agent: any) => ({
              name: agent.name || agent.id || 'Unknown',
              description: agent.description
            })));
          } else if (agentCard.capabilities && Array.isArray(agentCard.capabilities)) {
            // Alternative: capabilities array
            availableAgents.push(...agentCard.capabilities.map((cap: any) => ({
              name: cap.name || cap.type || 'Unknown',
              description: cap.description
            })));
          } else if (agentCard.name) {
            // Single agent (supervisor)
            availableAgents.push({
              name: agentCard.name,
              description: agentCard.description
            });
          }
          
          setAgents(availableAgents);
        } catch (parseError) {
          // Failed to parse agent card, but server is still reachable
          setAgents([]);
        }
      }
    } catch (error) {
      // Network error or timeout
      if (error instanceof Error && error.name === "AbortError") {
        // Timeout
        setStatus("disconnected");
      } else if (error instanceof TypeError) {
        // Network error (server not reachable) or CORS
        setStatus("disconnected");
      } else {
        // Other errors - assume disconnected
        setStatus("disconnected");
      }
      setLastChecked(new Date());
      nextCheckTimeRef.current = Date.now() + POLL_INTERVAL_MS;
    }
  }, [url]);

  // Update countdown timer every second
  useEffect(() => {
    const countdownInterval = setInterval(() => {
      const remaining = Math.max(0, Math.ceil((nextCheckTimeRef.current - Date.now()) / 1000));
      setSecondsUntilNextCheck(remaining);
    }, 1000);

    return () => clearInterval(countdownInterval);
  }, []);

  useEffect(() => {
    // Check immediately on mount
    checkHealth();

    // Set up 30-second polling interval
    const interval = setInterval(checkHealth, POLL_INTERVAL_MS);

    return () => clearInterval(interval);
  }, [checkHealth]);

  return {
    status,
    url,
    lastChecked,
    secondsUntilNextCheck,
    agents,
    checkNow: checkHealth,
  };
}
