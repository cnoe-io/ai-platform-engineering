// assisted-by Codex Codex-sonnet-4-6

import type { AgentAccessGap } from "@/app/api/workflow-configs/check-agent-access/route";

const GLOBAL_ACCESS_LABEL = "(all users)";

type FetchLike = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

function grantBodyForGapTarget(gap: AgentAccessGap, target: string) {
  return {
    resource: { type: "agent", id: gap.agentId },
    grantee: target === GLOBAL_ACCESS_LABEL ? { type: "everyone" } : { type: "team", id: target },
    capability: "use",
  };
}

async function grantErrorMessage(response: Response, gap: AgentAccessGap, target: string): Promise<string> {
  try {
    const body = (await response.json()) as { error?: unknown; message?: unknown };
    const detail = typeof body.error === "string" ? body.error : typeof body.message === "string" ? body.message : "";
    if (detail) return detail;
  } catch {
    // Fall through to a stable generic message.
  }
  return `Failed to grant ${gap.agentName || gap.agentId} access to ${target} (${response.status})`;
}

export async function grantAgentAccessGaps(
  gaps: AgentAccessGap[],
  fetchImpl: FetchLike = fetch,
): Promise<void> {
  for (const gap of gaps) {
    for (const target of gap.teamsWithoutAccess) {
      const response = await fetchImpl("/api/authz/v1/grants", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(grantBodyForGapTarget(gap, target)),
      });
      if (!response.ok) {
        throw new Error(await grantErrorMessage(response, gap, target));
      }
    }
  }
}
