import type { GradientThemeId } from "@/lib/gradient-themes";

export interface HarnessPresentation {
  id: string;
  label: string;
  shortLabel: string;
  badgeClassName: string;
  dotClassName: string;
}

const HARNESS_PRESENTATIONS: Record<string, HarnessPresentation> = {
  dynamic_agents: {
    id: "dynamic_agents",
    label: "LangChain Deep Agents",
    shortLabel: "Deep Agents",
    badgeClassName:
      "border-teal-500/30 bg-teal-500/10 text-teal-700 dark:text-teal-300",
    dotClassName: "bg-teal-500",
  },
  agentcore: {
    id: "agentcore",
    label: "Amazon Bedrock AgentCore",
    shortLabel: "AgentCore",
    badgeClassName:
      "border-orange-500/30 bg-orange-500/10 text-orange-700 dark:text-orange-300",
    dotClassName: "bg-orange-500",
  },
  claude_agent_sdk: {
    id: "claude_agent_sdk",
    label: "Claude Agent SDK",
    shortLabel: "Claude SDK",
    badgeClassName:
      "border-violet-500/30 bg-violet-500/10 text-violet-700 dark:text-violet-300",
    dotClassName: "bg-violet-500",
  },
};

const FALLBACK_HARNESS: HarnessPresentation = {
  id: "unknown",
  label: "Custom harness",
  shortLabel: "Custom",
  badgeClassName:
    "border-slate-500/30 bg-slate-500/10 text-slate-700 dark:text-slate-300",
  dotClassName: "bg-slate-500",
};

const AGENT_THEME_PALETTE: readonly GradientThemeId[] = [
  "ocean",
  "sunset",
  "forest",
  "lavender",
  "ember",
  "professional",
  "cyberpunk",
  "tron",
  "matrix",
  "default",
];

export function normalizeHarnessId(harnessId?: string | null): string {
  const normalized = harnessId?.trim().toLowerCase();
  if (
    !normalized ||
    normalized === "dynamic_agents" ||
    normalized === "langchain-deepagents" ||
    normalized === "langchain_deepagents"
  ) {
    return "dynamic_agents";
  }
  return normalized;
}

export function getHarnessPresentation(
  harnessId?: string | null,
): HarnessPresentation {
  const normalized = normalizeHarnessId(harnessId);
  return (
    HARNESS_PRESENTATIONS[normalized] ?? {
      ...FALLBACK_HARNESS,
      id: normalized,
      label: normalized,
    }
  );
}

/**
 * Give agents without an explicitly configured theme a stable identity color.
 * The same agent receives the same theme in every picker, sidebar row, and chat.
 */
export function getDeterministicAgentThemeId(agentId: string): GradientThemeId {
  let hash = 0x811c9dc5;
  for (let index = 0; index < agentId.length; index += 1) {
    hash ^= agentId.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return AGENT_THEME_PALETTE[(hash >>> 0) % AGENT_THEME_PALETTE.length];
}
