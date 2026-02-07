"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { useConfig } from "@/components/config-provider";

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
  const appConfig = useConfig();
  const [status, setStatus] = useState<HealthStatus>("checking");
  const [lastChecked, setLastChecked] = useState<Date | null>(null);
  const [secondsUntilNextCheck, setSecondsUntilNextCheck] = useState(0);
  const [agents, setAgents] = useState<AgentInfo[]>([]);
  const [tags, setTags] = useState<string[]>([]);
  const [mongoDBStatus, setMongoDBStatus] = useState<'connected' | 'disconnected' | 'checking'>('checking');
  const [storageMode, setStorageMode] = useState<'mongodb' | 'localStorage' | null>(null);
  const nextCheckTimeRef = useRef<number>(Date.now() + POLL_INTERVAL_MS);
  const url = appConfig.caipeUrl;

  const checkHealth = useCallback(async () => {
    setStatus("checking");

    // Storage mode: use server as source of truth (GET /api/storage-mode)
    // so the UI label matches what the backend actually uses (process.env.MONGODB_URI)
    try {
      const storageRes = await fetch("/api/storage-mode", {
        cache: "no-store",
        headers: { "Cache-Control": "no-cache" },
      });
      if (storageRes.ok) {
        const { mode } = await storageRes.json();
        setStorageMode(mode);
        setMongoDBStatus(mode === "mongodb" ? "connected" : "disconnected");
      } else {
        setStorageMode(appConfig.storageMode);
        setMongoDBStatus(appConfig.storageMode === "mongodb" ? "connected" : "disconnected");
      }
    } catch {
      setStorageMode(appConfig.storageMode);
      setMongoDBStatus(appConfig.storageMode === "mongodb" ? "connected" : "disconnected");
    }

    try {
      // Use the A2A agent card endpoint which supports GET
      // Base URL is like http://localhost:8000, agent card is at /.well-known/agent-card.json
      const baseUrl = url.replace(/\/$/, ''); // Remove trailing slash
      const agentCardUrl = `${baseUrl}/.well-known/agent-card.json`;

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

      // Try to parse agent card to get available agents and tags
      if (response.ok) {
        try {
          const agentCard = await response.json();
          const availableAgents: AgentInfo[] = [];
          const allTags: string[] = [];
          
          // Extract tags from skills array
          if (agentCard.skills && Array.isArray(agentCard.skills)) {
            agentCard.skills.forEach((skill: any) => {
              if (skill.tags && Array.isArray(skill.tags)) {
                allTags.push(...skill.tags);
              }
              // Also add skill as an agent
              availableAgents.push({
                name: skill.name || skill.id || 'Unknown',
                description: skill.description,
                tags: skill.tags
              });
            });
          }
          
          // Legacy: Extract agents from other structures
          if (agentCard.agents && Array.isArray(agentCard.agents)) {
            availableAgents.push(...agentCard.agents.map((agent: any) => ({
              name: agent.name || agent.id || 'Unknown',
              description: agent.description,
              tags: agent.tags
            })));
          } else if (agentCard.capabilities && Array.isArray(agentCard.capabilities)) {
            availableAgents.push(...agentCard.capabilities.map((cap: any) => ({
              name: cap.name || cap.type || 'Unknown',
              description: cap.description
            })));
          } else if (agentCard.name && availableAgents.length === 0) {
            // Single agent (supervisor) - only if no skills found
            availableAgents.push({
              name: agentCard.name,
              description: agentCard.description
            });
          }
          
          // Remove duplicates from tags and sort
          const uniqueTags = Array.from(new Set(allTags)).sort();
          
          setAgents(availableAgents);
          setTags(uniqueTags);
        } catch (parseError) {
          // Failed to parse agent card, but server is still reachable
          setAgents([]);
          setTags([]);
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
    // Check immediately on mount (includes fetching storage mode from server)
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
    tags,
    mongoDBStatus,
    storageMode,
    checkNow: checkHealth,
  };
}
