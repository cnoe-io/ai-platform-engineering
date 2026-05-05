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
 * Catalog payload shape we actually consume here. Mirrors the API contract
 * in ``app/api/skills/route.ts`` (specifically the ``applyRunnableGate``
 * helper that stamps ``runnable``/``blocked_reason``/``scan_status`` on
 * every entry). We type it locally instead of importing ``CatalogSkill``
 * to keep this hook free of cross-package coupling -- only these four
 * fields drive selection logic.
 */
type CatalogSkillLite = {
  id: string;
  name?: string;
  title?: string;
  description?: string;
  scan_status?: string | null;
  runnable?: boolean;
  blocked_reason?: string | null;
};

/**
 * Defense-in-depth filter for flagged skills.
 *
 * The supervisor's ``scan_gate.py`` already refuses to *execute* any
 * flagged skill (every loader -- ``loaders/default.py``,
 * ``loaders/agent_skill.py``, ``dynamic_agents/services/skills.py`` --
 * funnels through ``is_skill_blocked`` / ``mongo_scan_filter``). But
 * surfacing the skill in the slash-command menu means a user can pick
 * something the runtime will then refuse, which is a confusing UX and
 * leaks the skill's existence + metadata to the model. Per product
 * decision we hide flagged entries from the picker entirely so the menu
 * only shows things that are actually runnable.
 *
 * We treat all three signals the gateway stamps as authoritative
 * (``scan_status``, ``runnable``, ``blocked_reason``) so a future schema
 * tweak on either side can't silently re-enable a flagged skill in the
 * picker.
 */
function isFlaggedSkill(skill: CatalogSkillLite): boolean {
  return (
    skill.scan_status === "flagged"
    || skill.runnable === false
    || skill.blocked_reason === "scan_flagged"
  );
}

/**
 * Hook that assembles the full slash command list from:
 * 1. Built-in commands (static)
 * 2. Skills (dynamic, scoped to agent when agentSkillIds is provided)
 * 3. Agents from DEFAULT_AGENTS (static)
 *
 * @param agentSkillIds - Skill IDs configured on the current dynamic agent.
 *   When provided with items: fetches GET /api/skills (merged catalog), filters to those IDs.
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
          const allSkills: CatalogSkillLite[] = data?.skills || [];
          const filtered = allSkills.filter(
            (s) => skillIdSet.has(s.id) && !isFlaggedSkill(s),
          );
          setSkillCommands(
            filtered.map((s) => ({
              id: s.id,
              label: s.title || s.name || s.id,
              description: s.description || s.title || s.name || s.id,
              category: "skill" as const,
              action: "insert" as const,
              value: s.title || s.name || s.id,
            })),
          );
        })
        .catch(() => {});
    } else {
      // Supervisor / no agent context — fetch full global catalog
      fetch("/api/skills", { credentials: "include" })
        .then((res) => (res.ok ? res.json() : null))
        .then((data) => {
          if (cancelled || !data?.skills) return;
          const allSkills: CatalogSkillLite[] = data.skills;
          const runnable = allSkills.filter((s) => !isFlaggedSkill(s));
          setSkillCommands(
            runnable.map((s) => ({
              id: (s.name || s.id).toLowerCase().replace(/\s+/g, "-"),
              label: s.name || s.id,
              description: s.description || s.name || s.id,
              category: "skill" as const,
              action: "insert" as const,
              value: s.name || s.id,
            })),
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
