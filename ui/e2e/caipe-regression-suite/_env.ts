import { test } from "@playwright/test";

export type CaipeTapEnv = {
  baseUrl: string;
  admin: { email: string; subject: string };
  member: { email: string; subject: string };
  teamSlug: string;
  orgKey: string;
  runId: string;
  prefix: string;
  mcpEndpoint: string;
};

function slug(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 48);
}

export function caipeTapEnvOrSkip(): CaipeTapEnv {
  if (process.env.RUN_CAIPE_REGRESSION_SUITE !== "1") {
    test.skip(true, "RUN_CAIPE_REGRESSION_SUITE is not set.");
  }

  const required = [
    "CAIPE_REGRESSION_SUITE_BASE_URL",
    "CAIPE_REGRESSION_SUITE_APPROVED_HOST",
    "CAIPE_REGRESSION_SUITE_ADMIN_EMAIL",
    "CAIPE_REGRESSION_SUITE_ADMIN_SUB",
    "CAIPE_REGRESSION_SUITE_MEMBER_EMAIL",
    "CAIPE_REGRESSION_SUITE_MEMBER_SUB",
    "CAIPE_REGRESSION_SUITE_TEAM_SLUG",
    "CAIPE_REGRESSION_SUITE_ORG_KEY",
    "CAIPE_REGRESSION_SUITE_MCP_ENDPOINT",
    "NEXTAUTH_SECRET",
  ] as const;
  const missing = required.filter((key) => !process.env[key]?.trim());
  if (missing.length > 0) {
    throw new Error(`CAIPE Regression Suite is enabled but required variables are missing: ${missing.join(", ")}`);
  }

  const baseUrl = process.env.CAIPE_REGRESSION_SUITE_BASE_URL!;
  const hostname = new URL(baseUrl).hostname;
  if (hostname !== process.env.CAIPE_REGRESSION_SUITE_APPROVED_HOST) {
    throw new Error(`Refusing target ${hostname}: it does not match CAIPE_REGRESSION_SUITE_APPROVED_HOST.`);
  }

  const release = slug(process.env.CAIPE_REGRESSION_SUITE_RELEASE || "release");
  const runId = slug(process.env.CAIPE_REGRESSION_SUITE_RUN_ID || new Date().toISOString());
  return {
    baseUrl,
    admin: { email: process.env.CAIPE_REGRESSION_SUITE_ADMIN_EMAIL!, subject: process.env.CAIPE_REGRESSION_SUITE_ADMIN_SUB! },
    member: { email: process.env.CAIPE_REGRESSION_SUITE_MEMBER_EMAIL!, subject: process.env.CAIPE_REGRESSION_SUITE_MEMBER_SUB! },
    teamSlug: process.env.CAIPE_REGRESSION_SUITE_TEAM_SLUG!,
    orgKey: process.env.CAIPE_REGRESSION_SUITE_ORG_KEY!,
    runId,
    prefix: `caipe-regression-suite-${release}-${runId}`.slice(0, 96),
    mcpEndpoint: process.env.CAIPE_REGRESSION_SUITE_MCP_ENDPOINT!,
  };
}
