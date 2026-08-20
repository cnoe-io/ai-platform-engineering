import { test } from "@playwright/test";

export type GridTapEnv = {
  baseUrl: string;
  admin: { email: string; subject: string };
  member: { email: string; subject: string };
  teamSlug: string;
  orgKey: string;
  runId: string;
  prefix: string;
  mcpEndpoint: string;
  mcpServerId: string;
  mcpToolName: string;
  mcpToolParams: Record<string, unknown>;
  agentModel: { id: string; provider: string };
};

function slug(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 48);
}

export function gridTapEnvOrSkip(): GridTapEnv {
  if (process.env.RUN_GRID_TAP !== "1") {
    test.skip(true, "RUN_GRID_TAP is not set.");
  }

  const required = [
    "GRID_TAP_BASE_URL",
    "GRID_TAP_ADMIN_EMAIL",
    "GRID_TAP_ADMIN_SUB",
    "GRID_TAP_MEMBER_EMAIL",
    "GRID_TAP_MEMBER_SUB",
    "GRID_TAP_TEAM_SLUG",
    "NEXTAUTH_SECRET",
  ] as const;
  const missing = required.filter((key) => !process.env[key]?.trim());
  if (missing.length > 0) {
    throw new Error(`GRID TAP is enabled but required variables are missing: ${missing.join(", ")}`);
  }

  const baseUrl = process.env.GRID_TAP_BASE_URL!;
  const hostname = new URL(baseUrl).hostname;
  if (hostname !== "grid.outshift.io" && process.env.GRID_TAP_ALLOW_NON_PROD !== "1") {
    throw new Error(`Refusing unapproved target ${hostname}. Set GRID_TAP_ALLOW_NON_PROD=1 only for an approved non-production run.`);
  }

  const release = slug(process.env.GRID_TAP_RELEASE || "release");
  const runId = slug(process.env.GRID_TAP_RUN_ID || new Date().toISOString());
  let mcpToolParams: Record<string, unknown>;
  try {
    const parsed = JSON.parse(process.env.GRID_TAP_MCP_TOOL_PARAMS || "{}");
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) throw new Error("not an object");
    mcpToolParams = parsed as Record<string, unknown>;
  } catch (error) {
    throw new Error(`GRID_TAP_MCP_TOOL_PARAMS must be a JSON object: ${error instanceof Error ? error.message : String(error)}`);
  }
  return {
    baseUrl,
    admin: { email: process.env.GRID_TAP_ADMIN_EMAIL!, subject: process.env.GRID_TAP_ADMIN_SUB! },
    member: { email: process.env.GRID_TAP_MEMBER_EMAIL!, subject: process.env.GRID_TAP_MEMBER_SUB! },
    teamSlug: process.env.GRID_TAP_TEAM_SLUG!,
    orgKey: process.env.GRID_TAP_ORG_KEY || "caipe",
    runId,
    prefix: `grid-tap-${release}-${runId}`.slice(0, 96),
    mcpEndpoint: process.env.GRID_TAP_MCP_ENDPOINT || "",
    mcpServerId: process.env.GRID_TAP_MCP_SERVER_ID || "",
    mcpToolName: process.env.GRID_TAP_MCP_TOOL_NAME || "",
    mcpToolParams,
    agentModel: {
      id: process.env.GRID_TAP_AGENT_MODEL_ID || "gpt-4o-mini",
      provider: process.env.GRID_TAP_AGENT_MODEL_PROVIDER || "openai",
    },
  };
}
