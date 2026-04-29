"use client";

import { useState, useEffect, useMemo } from "react";
import { DEFAULT_AGENTS } from "./CustomCallButtons";
import type { SlashCommand } from "./SlashCommandMenu";

/**
 * Built-in commands that are always available.
 */
const BUILTIN_COMMANDS: SlashCommand[] = [
  {
    id: "skills",
    label: "skills",
    description: "List available skills",
    category: "command",
    action: "execute",
    value: "skills",
  },
  {
    id: "help",
    label: "help",
    description: "Show available commands",
    category: "command",
    action: "execute",
    value: "help",
  },
  {
    id: "clear",
    label: "clear",
    description: "Clear conversation",
    category: "command",
    action: "execute",
    value: "clear",
  },
];

/**
 * Hook that assembles the full slash command list from:
 * 1. Built-in commands (static)
 * 2. Skills (dynamic, scoped to agent when agentSkillIds is provided)
 * 3. Agents from DEFAULT_AGENTS (static)
 *
 * @param agentSkillIds - Skill IDs configured on the current dynamic agent.
 *   When provided with items: fetches /api/agent-skills, filters to those IDs.
 *   When provided as empty array: no skills shown.
 *   When undefined (supervisor): fetches full global catalog from /api/skills.
 */
export function useSlashCommands(agentSkillIds?: string[]): SlashCommand[] {
  const [skillCommands, setSkillCommands] = useState<SlashCommand[]>([]);

  // Stable key for the dependency array — avoids re-fetching on every render
  const skillIdsKey = agentSkillIds ? agentSkillIds.join(",") : undefined;

  useEffect(() => {
    // Dynamic agent with no skills configured — show nothing
    if (agentSkillIds && agentSkillIds.length === 0) {
      setSkillCommands([]);
      return;
    }

    let cancelled = false;

    if (agentSkillIds) {
      // Dynamic agent — fetch from unified catalog and filter to configured IDs
      const skillIdSet = new Set(agentSkillIds);

      fetch("/api/skills", { credentials: "include" })
        .then((res) => (res.ok ? res.json() : null))
        .then((data) => {
          if (cancelled) return;
          const allSkills = data?.skills || [];
          const filtered = allSkills.filter(
            (s: { id: string }) => skillIdSet.has(s.id),
          );
          setSkillCommands(
            filtered.map(
              (s: { id: string; title?: string; name?: string; description?: string }) => ({
                id: s.id,
                label: s.title || s.name || s.id,
                description: s.description || s.title || s.name || s.id,
                category: "skill" as const,
                action: "insert" as const,
                value: s.title || s.name || s.id,
              }),
            ),
          );
        })
        .catch(() => {});
    } else {
      // Supervisor / no agent context — fetch full global catalog
      fetch("/api/skills", { credentials: "include" })
        .then((res) => (res.ok ? res.json() : null))
        .then((data) => {
          if (cancelled || !data?.skills) return;
          setSkillCommands(
            data.skills.map(
              (s: { id: string; name: string; description: string }) => ({
                id: s.name.toLowerCase().replace(/\s+/g, "-"),
                label: s.name,
                description: s.description || s.name,
                category: "skill" as const,
                action: "insert" as const,
                value: s.name,
              }),
            ),
          );
        })
        .catch(() => {});
    }

    return () => {
      cancelled = true;
    };
  }, [skillIdsKey]); // eslint-disable-line react-hooks/exhaustive-deps

  // Convert DEFAULT_AGENTS to slash commands
  const agentCommands: SlashCommand[] = useMemo(
    () =>
      DEFAULT_AGENTS.map((agent) => ({
        id: agent.id,
        label: agent.label,
        description: `${agent.label} agent`,
        category: "agent" as const,
        action: "insert" as const,
        value: agent.prompt,
      })),
    [],
  );

  return useMemo(
    () => [...BUILTIN_COMMANDS, ...skillCommands, ...agentCommands],
    [skillCommands, agentCommands],
  );
}
