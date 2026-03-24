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
 * 2. Skills from GET /api/skills (dynamic, fetched once)
 * 3. Agents from DEFAULT_AGENTS (static)
 */
export function useSlashCommands(): SlashCommand[] {
  const [skillCommands, setSkillCommands] = useState<SlashCommand[]>([]);

  // Fetch skills from the API once on mount
  useEffect(() => {
    let cancelled = false;

    fetch("/api/skills", { credentials: "include" })
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (cancelled || !data?.skills) return;
        const skills: SlashCommand[] = data.skills.map(
          (s: { id: string; name: string; description: string }) => ({
            id: s.name.toLowerCase().replace(/\s+/g, "-"),
            label: s.name,
            description: s.description || s.name,
            category: "skill" as const,
            action: "insert" as const,
            value: s.name,
          }),
        );
        setSkillCommands(skills);
      })
      .catch(() => {
        // Skills unavailable — the menu still works with built-ins + agents
      });

    return () => {
      cancelled = true;
    };
  }, []);

  // Convert DEFAULT_AGENTS to slash commands
  const agentCommands: SlashCommand[] = useMemo(
    () =>
      DEFAULT_AGENTS.map((agent) => ({
        id: agent.id,
        label: agent.label,
        description: `${agent.label} agent`,
        category: "agent" as const,
        action: "insert" as const,
        value: agent.prompt, // e.g. "@argocd"
      })),
    [],
  );

  return useMemo(
    () => [...BUILTIN_COMMANDS, ...skillCommands, ...agentCommands],
    [skillCommands, agentCommands],
  );
}
