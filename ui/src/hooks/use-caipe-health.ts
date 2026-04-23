"use client";

import { useState, useEffect, useCallback, useRef, startTransition } from "react";
import { config as appConfig } from "@/lib/config";

export type HealthStatus = "checking" | "connected" | "disconnected";

const POLL_INTERVAL_MS = 30000; // 30 seconds

interface AgentInfo {
  name: string;
  description?: string;
  tags?: string[];
}

interface UseCAIPEHealthResult {
  status: HealthStatus;
  url: string;
  lastChecked: Date | null;
  secondsUntilNextCheck: number;
  agents: AgentInfo[];
  tags: string[];
  mongoDBStatus: 'connected' | 'disconnected' | 'checking';
  storageMode: 'mongodb' | 'localStorage' | null;
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
  const [tags, setTags] = useState<string[]>([]);
  const [mongoDBStatus, setMongoDBStatus] = useState<'connected' | 'disconnected' | 'checking'>('checking');
  const [storageMode, setStorageMode] = useState<'mongodb' | 'localStorage' | null>(null);
  const nextCheckTimeRef = useRef(0);
  const url = appConfig.caipeUrl;

  const checkHealth = useCallback(async () => {
    setStatus("checking");

    // Storage mode: read from config (injected by server into window.__APP_CONFIG__)
    const mode = appConfig.storageMode;
    setStorageMode(mode);
    setMongoDBStatus(mode === "mongodb" ? "connected" : "disconnected");

    // Go through the server-side proxy at /api/health/supervisor instead of
    // fetching the supervisor directly from the browser. In cluster
    // deployments the supervisor lives on an internal Service URL that the
    // browser cannot resolve; a direct fetch would always report OFFLINE even
    // when the supervisor is healthy. The proxy reaches the supervisor over
    // the internal A2A_BASE_URL from inside the UI pod.
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 6000);
    try {
      const response = await fetch('/api/health/supervisor', {
        method: 'GET',
        signal: controller.signal,
        headers: { Accept: 'application/json' },
      });
      clearTimeout(timeoutId);

      if (!response.ok) {
        setStatus('disconnected');
        setLastChecked(new Date());
        nextCheckTimeRef.current = Date.now() + POLL_INTERVAL_MS;
        return;
      }

      const body: {
        status: 'healthy' | 'unhealthy';
        agentCard?: {
          name?: string;
          description?: string;
          skills?: Array<{ name?: string; id?: string; description?: string; tags?: string[] }>;
          agents?: AgentInfo[];
          capabilities?: Array<{ name?: string; type?: string; description?: string }>;
        };
      } = await response.json();

      if (body.status === 'healthy') {
        setStatus('connected');
      } else {
        setStatus('disconnected');
      }
      setLastChecked(new Date());
      nextCheckTimeRef.current = Date.now() + POLL_INTERVAL_MS;

      const agentCard = body.agentCard;
      if (agentCard) {
        const availableAgents: AgentInfo[] = [];
        const allTags: string[] = [];

        // Extract tags from skills array
        if (Array.isArray(agentCard.skills)) {
          agentCard.skills.forEach((skill) => {
            if (Array.isArray(skill.tags)) {
              allTags.push(...skill.tags);
            }
            availableAgents.push({
              name: skill.name || skill.id || 'Unknown',
              description: skill.description,
              tags: skill.tags,
            });
          });
        }

        // Legacy: agents / capabilities arrays
        if (Array.isArray(agentCard.agents)) {
          availableAgents.push(
            ...agentCard.agents.map((a: AgentInfo) => ({
              name: a.name || 'Unknown',
              description: a.description,
              tags: a.tags,
            })),
          );
        } else if (Array.isArray(agentCard.capabilities)) {
          availableAgents.push(
            ...agentCard.capabilities.map((cap) => ({
              name: cap.name || cap.type || 'Unknown',
              description: cap.description,
            })),
          );
        } else if (agentCard.name && availableAgents.length === 0) {
          availableAgents.push({ name: agentCard.name, description: agentCard.description });
        }

        const uniqueTags = Array.from(new Set(allTags)).sort();
        setAgents(availableAgents);
        setTags(uniqueTags);
      }
    } catch {
      // Timeout or network error contacting our own origin — treat as disconnected.
      clearTimeout(timeoutId);
      setStatus('disconnected');
      setLastChecked(new Date());
      nextCheckTimeRef.current = Date.now() + POLL_INTERVAL_MS;
    }
  }, []);

  // Update countdown timer every second
  useEffect(() => {
    if (nextCheckTimeRef.current === 0) {
      nextCheckTimeRef.current = Date.now() + POLL_INTERVAL_MS;
    }
    const countdownInterval = setInterval(() => {
      const remaining = Math.max(0, Math.ceil((nextCheckTimeRef.current - Date.now()) / 1000));
      startTransition(() => {
        setSecondsUntilNextCheck(remaining);
      });
    }, 1000);

    return () => clearInterval(countdownInterval);
  }, []);

  useEffect(() => {
    startTransition(() => {
      void checkHealth();
    });

    // Set up 30-second polling interval
    const interval = setInterval(() => {
      void checkHealth();
    }, POLL_INTERVAL_MS);

    return () => clearInterval(interval);
  }, [checkHealth]);

  return {
    status,
    url,
    lastChecked,
    secondsUntilNextCheck,
    agents,
    tags,
    mongoDBStatus,
    storageMode,
    checkNow: checkHealth,
  };
}
