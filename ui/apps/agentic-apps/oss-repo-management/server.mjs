#!/usr/bin/env node
// assisted-by Codex Codex-sonnet-4-6
import { createServer } from "node:http";

import { handleAppMcpRequest } from "../../_lib/app-mcp-server.mjs";
import { renderAgenticAppConversationClient } from "../../_lib/conversation-client.mjs";
import { createRequiredAgenticAppJwtVerifier } from "../../_lib/jwt-verify.mjs";
import { renderMicrofrontendClient } from "../../_lib/microfrontend-client.mjs";
import { authorizeAgenticAppRuntimeRequest } from "../../_lib/runtime-authorization.mjs";
import {
  resolveAgenticAppRuntimeBasePath,
  resolveAgenticAppSurface,
} from "../../_lib/runtime-base-path.mjs";
import { renderStaticDashboardExample } from "../../_lib/static-dashboard-examples.mjs";
import {
  fetchGitHubRepoDashboard,
  GitHubDashboardError,
  normalizeRepoName,
} from "./github-dashboard.mjs";
import { buildOssRepoMarkdownReport } from "./markdown-report.mjs";
import { registerOssReportCardMcpTools } from "./mcp.mjs";

const port = Number(process.env.OSS_REPO_MANAGEMENT_APP_PORT ?? "3040");
const configuredBasePath = normalizeBasePath(process.env.OSS_REPO_MANAGEMENT_APP_BASE_PATH ?? "/apps/oss-repo-management");
const defaultGithubAgentId = String(process.env.OSS_REPO_MANAGEMENT_GITHUB_AGENT_ID ?? "").trim();
const defaultRepoName = String(process.env.OSS_REPO_MANAGEMENT_DEFAULT_REPO ?? "").trim();
const githubToken = String(process.env.OSS_REPO_MANAGEMENT_GITHUB_TOKEN ?? process.env.GITHUB_TOKEN ?? "").trim();
const githubApiBase = process.env.OSS_REPO_MANAGEMENT_GITHUB_API_URL ?? "https://api.github.com";
const configuredReportCacheTtlMs = Number(process.env.OSS_REPO_MANAGEMENT_REPORT_CACHE_TTL_MS || 900_000);
const reportCacheTtlMs = Number.isFinite(configuredReportCacheTtlMs) ? Math.max(60_000, configuredReportCacheTtlMs) : 900_000;
const reportCache = new Map();

const verifier = createRequiredAgenticAppJwtVerifier({
  appId: "oss-repo-management",
  disabled: process.env.AGENTIC_APP_OSS_REPO_MANAGEMENT_JWT_DISABLED === "true",
});

const server = createServer(async (request, response) => {
  const url = new URL(request.url ?? "/", `http://${request.headers.host ?? "localhost"}`);
  const basePath = resolveAgenticAppRuntimeBasePath(
    request.headers,
    configuredBasePath,
    "oss-repo-management",
  );
  const surface = resolveAgenticAppSurface(request.headers);

  if (url.pathname === "/healthz") {
    sendJson(response, 200, {
      ok: true,
      app: "oss-repo-management",
      runtime: "separate-process",
      source: "github-rest-api",
      githubCredentialConfigured: Boolean(githubToken),
      optionalAgent: defaultGithubAgentId || null,
      mcp: { endpoint: "/mcp", authentication: "forwarded-bearer" },
    });
    return;
  }

  if (url.pathname === "/mcp") {
    await handleAppMcpRequest(request, response, {
      name: "oss-repo-report-card-app",
      authenticationDisabled: process.env.AGENTIC_APP_OSS_REPO_MANAGEMENT_MCP_AUTH_DISABLED === "true",
      registerTools(mcpServer) {
        registerOssReportCardMcpTools(mcpServer, {
          loadReportCard: loadRepoReportCard,
          renderMarkdown: buildOssRepoMarkdownReport,
        });
      },
    });
    return;
  }

  if (verifier) {
    const result = await verifier(request.headers);
    if (!result.ok) {
      sendJson(response, result.status, { error: "unauthorized", reason: result.reason });
      return;
    }
    request.caipeIdentity = result.identity;
  }
  const authorization = authorizeAgenticAppRuntimeRequest({
    identity: request.caipeIdentity,
    appId: "oss-repo-management",
    method: request.method,
    readScope: "oss-repo-management:read",
    invokeScope: "oss-repo-management:agent:invoke",
    allowDevelopmentBypass: verifier === null,
  });
  if (!authorization.ok) {
    sendJson(response, authorization.status, {
      error: authorization.error,
      requiredScope: authorization.requiredScope,
    });
    return;
  }

  if (url.pathname === "/api/summary") {
    try {
      const repo = normalizeRepoName(url.searchParams.get("repo") || defaultRepoName);
      const staleDays = Number(url.searchParams.get("staleDays") || "30");
      sendJson(response, 200, await loadRepoReportCard({
        repo,
        staleDays,
        refresh: url.searchParams.get("refresh") === "1",
      }));
    } catch (error) {
      const status = error instanceof GitHubDashboardError ? error.status : 502;
      const code = error instanceof GitHubDashboardError ? error.code : "github_request_failed";
      sendJson(response, status, {
        error: code,
        message: error instanceof Error ? error.message : "Could not load repository data",
      });
    }
    return;
  }

  if (url.pathname === "/api/copilotkit/repo-agent" && request.method === "POST") {
    try {
      const body = await readJsonBody(request);
      sendJson(response, 200, buildLocalRepoAgentResponse(body));
    } catch (error) {
      sendJson(response, 400, {
        error: "invalid_repo_agent_request",
        message: error instanceof Error ? error.message : "Could not run repository agent",
      });
    }
    return;
  }

  if (url.pathname === "/example") {
    sendHtml(response, renderStaticDashboardExample("oss-repo-management", authorization.summary), "no-store");
    return;
  }

  if (url.pathname === "/" || url.pathname === "/dashboard") {
    sendHtml(response, renderDashboard({ compact: surface === "hosted", basePath, authorization: authorization.summary }));
    return;
  }

  sendJson(response, 404, { error: "not_found" });
});

server.listen(port, () => {
  console.log(`OSS Repo Report Card listening on http://localhost:${port}`);
  console.log(`Configure CAIPE with AGENTIC_APP_OSS_REPO_MANAGEMENT_ORIGIN=http://localhost:${port}`);
});

async function loadRepoReportCard({ repo, staleDays = 30, refresh = false }) {
  const normalizedRepo = normalizeRepoName(repo || defaultRepoName);
  const normalizedStaleDays = Math.min(365, Math.max(7, Math.round(Number(staleDays) || 30)));
  const cacheKey = `${normalizedRepo.toLowerCase()}::${normalizedStaleDays}::${githubToken ? "credential" : "public"}`;
  const cached = reportCache.get(cacheKey);
  if (!refresh && cached && Date.now() - cached.cachedAt < reportCacheTtlMs) {
    return {
      ...cached.dashboard,
      delivery: { cache: "hit", cachedAt: new Date(cached.cachedAt).toISOString() },
    };
  }
  const dashboard = await fetchGitHubRepoDashboard({
    repo: normalizedRepo,
    staleDays: normalizedStaleDays,
    token: githubToken,
    apiBase: githubApiBase,
  });
  const cachedAt = Date.now();
  reportCache.set(cacheKey, { cachedAt, dashboard });
  return {
    ...dashboard,
    delivery: { cache: "miss", cachedAt: new Date(cachedAt).toISOString() },
  };
}

function buildOssRepoManagementDashboardResponseFormat() {
  return {
    type: "json_schema",
    schema_id: "oss_repo_management.dashboard.v1",
    schema: {
      type: "object",
      required: ["summary", "confidence", "repo", "issues", "pullRequests", "risks", "recommendations", "maintainerAsks"],
      properties: {
        summary: { type: "string" },
        confidence: { type: "string" },
        repo: { type: "string" },
        issues: { type: "object" },
        pullRequests: { type: "object" },
        risks: { type: "array" },
        recommendations: { type: "array" },
        maintainerAsks: { type: "array" },
      },
    },
  };
}

function buildAgentUnavailableRepoSummary(repoName, reason = "No GitHub structured output received from the CAIPE GitHub agent") {
  const repo = normalizeRepoName(repoName);
  return {
    source: "agent-unavailable",
    generatedAt: new Date().toISOString(),
    reason,
    repo,
    summary: `No GitHub structured output received from the CAIPE GitHub agent for ${repo}.`,
    confidence: "none",
    issues: {
      open: null,
      stale: null,
      p0: null,
      needsTriage: null,
    },
    pullRequests: {
      open: null,
      awaitingReview: null,
      blocked: null,
    },
    risks: [
      {
        severity: "medium",
        title: "GitHub agent structured output is unavailable",
        rationale: reason,
      },
    ],
    recommendations: [
      "Verify the CAIPE GitHub agent is reachable and has the structured response middleware enabled.",
      "Confirm the agent prompt requests oss_repo_management.dashboard.v1 before the final answer.",
    ],
    maintainerAsks: [
      {
        title: "Restore agent structured output",
        detail: "The embedded app will render GitHub data only after the CAIPE GitHub agent emits oss_repo_management.dashboard.v1.",
        priority: "high",
      },
    ],
  };
}

function buildLocalRepoAgentResponse(body) {
  const dashboard = buildAgentUnavailableRepoSummary(body?.repo || defaultRepoName);
  const question = String(body?.question || "").trim();
  const message = [
    dashboard.summary,
    question ? `Question: ${question}` : "",
    `Recommendation: ${dashboard.recommendations[0]}`,
  ].filter(Boolean).join(" ");
  return {
    message,
    dashboard,
    copilotKit: {
      pattern: "useCopilotAction",
      actionName: "renderOssRepoInsight",
      status: "agent-unavailable",
    },
  };
}

function renderDashboard({ compact, basePath, authorization }) {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>OSS Repo Report Card</title>
    <style>
      :root {
        color-scheme: dark;
        --app-font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        --app-font-scale: 1;
        font-size: calc(16px * var(--app-font-scale));
        font-family: var(--app-font-family);
        background: #020617;
        color: #e2e8f0;
      }
      * { box-sizing: border-box; }
      [hidden] { display: none !important; }
      body {
        margin: 0;
        min-height: 100vh;
        font-size: 1rem;
        font-family: var(--app-font-family);
        line-height: 1.45;
        background:
          radial-gradient(circle at 10% 8%, rgba(34, 197, 94, 0.18), transparent 28rem),
          radial-gradient(circle at 84% 16%, rgba(59, 130, 246, 0.14), transparent 30rem),
          #020617;
      }
      main { max-width: 1340px; margin: 0 auto; padding: ${compact ? "14px" : "18px 18px 24px"}; }
      .hero, .panel, .assistant {
        border: 1px solid rgba(255,255,255,0.10);
        background: rgba(15, 23, 42, 0.62);
        box-shadow: 0 18px 50px rgba(15, 23, 42, 0.18);
        backdrop-filter: blur(14px);
      }
      .hero { border-radius: 14px; padding: 12px 16px; margin-bottom: 10px; overflow: hidden; position: relative; }
      .hero-row { display: flex; align-items: center; gap: 14px; flex-wrap: wrap; }
      .hero-title { display: flex; flex-direction: column; gap: 2px; flex: 1; min-width: 220px; }
      .eyebrow { display: inline-flex; gap: 7px; align-items: center; color: #86efac; letter-spacing: 0.16em; font-size: 0.72rem; font-weight: 800; text-transform: uppercase; margin: 0; }
      .pulse { display: inline-block; width: 8px; height: 8px; border-radius: 999px; background: #22c55e; box-shadow: 0 0 0 6px rgba(34, 197, 94, 0.12); }
      h1 { margin: 0; font-size: 1.5rem; line-height: 1.15; letter-spacing: -0.025em; font-weight: 800; }
      h2 { margin: 0 0 10px; font-size: 0.92rem; font-weight: 800; letter-spacing: 0.1em; text-transform: uppercase; color: #a7b4c8; }
      .subtitle { color: #a7b4c8; line-height: 1.55; font-size: 0.92rem; max-width: 720px; }
      .data-status { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; margin-top: 10px; color: #cbd5e1; font-size: 0.82rem; line-height: 1.45; }
      .status-chip { display: inline-flex; align-items: center; gap: 6px; padding: 4px 8px; border: 1px solid rgba(255,255,255,.1); border-radius: 999px; background: rgba(2,6,23,.48); }
      .status-chip.good { color: #a7f3d0; border-color: rgba(52,211,153,.28); }
      .status-chip.warn { color: #fde68a; border-color: rgba(251,191,36,.28); }
      .controls { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; }
      .run-history { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 6px; align-items: center; margin-top: 8px; }
      .run-history select { width: 100%; padding: 6px 10px; font-size: 0.78rem; }
      .settings-fab { position: fixed; left: 18px; bottom: 24px; z-index: 31; display: inline-flex; align-items: center; gap: 7px; padding: 10px 13px; border: 1px solid rgba(125, 211, 252, 0.4); border-radius: 999px; background: rgba(2, 6, 23, 0.9); box-shadow: 0 18px 50px rgba(2, 6, 23, 0.34); color: #e0f2fe; font-size: 0.86rem; font-weight: 1000; letter-spacing: 0.08em; text-transform: uppercase; backdrop-filter: blur(18px); }
      .settings-fab:hover { border-color: rgba(125, 211, 252, 0.75); background: rgba(14, 165, 233, 0.18); }
      .font-customizer { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; position: fixed; left: 18px; bottom: 74px; z-index: 30; max-width: calc(100vw - 36px); padding: 8px 10px; border: 1px solid rgba(255,255,255,0.12); border-radius: 18px; background: rgba(2, 6, 23, 0.92); box-shadow: 0 18px 50px rgba(2, 6, 23, 0.34); backdrop-filter: blur(18px); font-size: 0.78rem; line-height: 1; }
      .font-customizer[hidden] { display: none; }
      .font-dock-title { color: #e2e8f0; font-size: 0.72rem; font-weight: 1000; letter-spacing: 0.1em; text-transform: uppercase; }
      .font-customizer label { display: inline-flex; align-items: center; gap: 6px; color: #cbd5e1; font-size: 0.72rem; font-weight: 900; letter-spacing: 0.08em; text-transform: uppercase; }
      .font-customizer select { min-width: 82px; padding: 7px 10px; font-size: 0.86rem; line-height: 1; }
      input, select, textarea, button {
        border-radius: 8px;
        border: 1px solid rgba(255,255,255,0.12);
        background: rgba(2, 6, 23, 0.72);
        color: #e2e8f0;
        padding: 7px 10px;
        font-family: inherit;
        font-size: 0.78rem;
      }
      .controls input, .controls select { min-height: 38px; padding: 7px 10px; font-size: 0.84rem; }
      .controls button { min-height: 38px; padding: 7px 12px; font-size: 0.84rem; }
      input { min-width: 180px; }
      textarea { border-radius: 10px; min-height: 76px; width: 100%; resize: vertical; line-height: 1.45; }
      button { cursor: pointer; border: 0; font-weight: 700; background: linear-gradient(135deg, #22c55e, #0ea5e9); color: white; }
      button.ghost { background: rgba(2, 6, 23, 0.72); border: 1px solid rgba(255,255,255,0.12); font-weight: 600; }
      button:disabled { opacity: 0.6; cursor: wait; }
      :is(a, button, input, select, textarea, summary):focus-visible { outline: 3px solid rgba(103, 232, 249, 0.78); outline-offset: 2px; }
      .shell { display: grid; grid-template-columns: minmax(0, 1.35fr) minmax(280px, 0.65fr); gap: 12px; margin-top: 10px; }
      .panel, .assistant { border-radius: 14px; padding: 12px 14px; }
      .panel + .panel { margin-top: 10px; }
      .assistant { position: sticky; top: 12px; align-self: start; }
      .assistant button { width: 100%; }
      .assistant button + button { margin-top: 6px; }
      .kpi-strip { display: grid; grid-template-columns: 1.4fr repeat(5, minmax(0, 1fr)); gap: 8px; }
      .kpi {
        border-radius: 12px;
        background: linear-gradient(180deg, rgba(15, 23, 42, 0.72), rgba(2, 6, 23, 0.65));
        border: 1px solid rgba(255,255,255,0.08);
        padding: 10px 12px;
        position: relative;
        overflow: hidden;
        min-height: 78px;
        display: flex;
        flex-direction: column;
        justify-content: center;
        gap: 4px;
      }
      .kpi.accent-good { border-color: rgba(52, 211, 153, 0.30); }
      .kpi.accent-attention { border-color: rgba(56, 189, 248, 0.28); }
      .kpi.accent-warn { border-color: rgba(248, 191, 36, 0.32); }
      .kpi.accent-danger { border-color: rgba(248, 113, 113, 0.32); }
      .kpi .kpi-label {
        color: #94a3b8;
        font-size: 0.7rem;
        font-weight: 800;
        letter-spacing: 0.14em;
        text-transform: uppercase;
        display: flex;
        align-items: center;
        gap: 6px;
      }
      .kpi .kpi-value {
        color: #f8fafc;
        font-size: 1.42rem;
        font-weight: 800;
        letter-spacing: -0.025em;
        line-height: 1.05;
      }
      .kpi .kpi-sub { color: #94a3b8; font-size: 0.78rem; font-weight: 600; }
      .insights-strip { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 10px; }
      .insight {
        flex: 1 1 200px;
        display: flex;
        align-items: center;
        gap: 8px;
        padding: 8px 10px;
        border-radius: 10px;
        background: rgba(2, 6, 23, 0.55);
        border: 1px solid rgba(255,255,255,0.07);
        font-size: 0.78rem;
      }
      .insight .insight-icon { font-size: 1.14rem; line-height: 1; }
      .insight .insight-text { color: #e2e8f0; line-height: 1.3; }
      .insight .insight-text strong { color: #f8fafc; font-weight: 700; }
      .insight .insight-text small { display: block; color: #94a3b8; font-size: 0.72rem; font-weight: 500; margin-top: 1px; }
      .progress-bar { width: 100%; height: 5px; background: rgba(148,163,184,0.18); border-radius: 999px; overflow: hidden; margin-top: 4px; }
      .progress-fill { height: 100%; background: linear-gradient(90deg, #34d399, #38bdf8); }
      .repo-health-card, .action-card {
        border: 1px solid rgba(255,255,255,0.08);
        border-radius: 10px;
        padding: 10px 12px;
        background: rgba(2, 6, 23, 0.45);
        font-size: 0.84rem;
      }
      .repo-health-card strong, .action-card strong { color: #f8fafc; font-size: 0.86rem; font-weight: 700; display: block; margin-top: 2px; }
      .repo-health-card p, .action-card p { margin: 4px 0 0; color: #cbd5e1; line-height: 1.45; }
      .label { color: #94a3b8; font-size: 0.64rem; font-weight: 700; letter-spacing: 0.12em; text-transform: uppercase; }
      .action-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px; }
      .empty-state { grid-column: 1 / -1; padding: 22px; border: 1px dashed rgba(125,211,252,.32); border-radius: 12px; background: rgba(14,165,233,.06); }
      .empty-state strong { display: block; color: #e0f2fe; font-size: 1rem; margin-bottom: 5px; }
      .empty-state p { margin: 0; color: #a7b4c8; font-size: .88rem; line-height: 1.55; }
      .repo-profile { margin-top: 10px; display: grid; grid-template-columns: repeat(4,minmax(0,1fr)); gap: 8px; }
      .repo-profile .repo-health-card { min-height: 68px; }
      .repo-link { color: #7dd3fc; text-decoration: none; overflow-wrap: anywhere; }
      .repo-link:hover { text-decoration: underline; }
      .report-grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 10px; }
      .chart-card { min-height: 220px; }
      .chart-head { display: flex; justify-content: space-between; gap: 10px; align-items: baseline; margin-bottom: 10px; }
      .chart-head strong { color: #f8fafc; font-size: 0.92rem; }
      .chart-head span, .coverage { color: #94a3b8; font-size: 0.72rem; line-height: 1.4; }
      .bar-chart { height: 118px; display: flex; align-items: end; gap: 5px; padding-top: 8px; border-bottom: 1px solid rgba(148,163,184,.2); }
      .bar { flex: 1; min-width: 4px; border-radius: 4px 4px 0 0; background: linear-gradient(180deg, #38bdf8, #22c55e); position: relative; }
      .bar:hover::after { content: attr(data-label); position: absolute; left: 50%; bottom: calc(100% + 5px); transform: translateX(-50%); z-index: 3; white-space: nowrap; padding: 4px 6px; border-radius: 5px; background: #020617; color: #e2e8f0; font-size: .68rem; }
      .axis-labels { display: flex; justify-content: space-between; color: #64748b; font-size: .66rem; margin-top: 5px; }
      .sparkline { width: 100%; height: 118px; overflow: visible; }
      .sparkline .line { fill: none; stroke: #34d399; stroke-width: 4; stroke-linecap: round; stroke-linejoin: round; }
      .sparkline .area { fill: url(#starGradient); opacity: .34; }
      .practice-grid { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 8px; }
      .practice { padding: 9px; border-radius: 9px; border: 1px solid rgba(255,255,255,.08); background: rgba(2,6,23,.42); }
      .practice.good { border-color: rgba(52,211,153,.32); }
      .practice.warn { border-color: rgba(251,191,36,.28); }
      .framework-links { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 10px; }
      .framework-links a { color: #7dd3fc; border: 1px solid rgba(125,211,252,.22); border-radius: 999px; padding: 5px 9px; text-decoration: none; font-size: .75rem; }
      .readiness-head { display: flex; flex-wrap: wrap; gap: 8px; justify-content: space-between; align-items: baseline; margin: 14px 0 8px; }
      .readiness-head strong { color: #f8fafc; }
      .readiness-head span { color: #94a3b8; font-size: .75rem; }
      .criteria-grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 8px; }
      .criterion { padding: 9px 10px; border-radius: 9px; background: rgba(2,6,23,.42); border: 1px solid rgba(148,163,184,.18); }
      .criterion.pass { border-color: rgba(52,211,153,.34); }
      .criterion.warn { border-color: rgba(251,191,36,.34); }
      .criterion.manual, .criterion.unavailable { border-color: rgba(56,189,248,.28); }
      .criterion p { margin: 5px 0 0; color: #a7b4c8; font-size: .74rem; line-height: 1.4; }
      .criterion .criterion-status { float: right; color: #cbd5e1; font-size: .65rem; text-transform: uppercase; }
      .severity-high { color: #fca5a5; }
      .severity-medium { color: #fde68a; }
      .maintainer-ask { border-left: 3px solid #22c55e; }
      .message { margin-top: 8px; border-radius: 10px; padding: 10px 12px; background: rgba(2,6,23,0.45); border: 1px solid rgba(255,255,255,0.07); color: #cbd5e1; line-height: 1.55; white-space: pre-wrap; font-size: 0.84rem; }
      .activity-footer { position: sticky; bottom: 12px; z-index: 5; margin-top: 12px; border: 1px solid rgba(255,255,255,0.10); border-radius: 14px; background: rgba(2,6,23,0.92); backdrop-filter: blur(18px); }
      .activity-footer:has(details[open]) { position: relative; bottom: auto; background: rgba(2,6,23,0.96); }
      .activity-footer summary { cursor: pointer; display: flex; align-items: center; gap: 12px; padding: 10px 14px; list-style: none; }
      .activity-footer summary::-webkit-details-marker { display: none; }
      .activity-footer details[open] summary { border-bottom: 1px solid rgba(255,255,255,0.08); }
      .activity-footer details[open] .activity-drawer-body { max-height: 320px; overflow: auto; }
      .run-status { display: inline-flex; align-items: center; gap: 7px; border-radius: 999px; padding: 5px 10px; background: rgba(15,23,42,0.9); font-weight: 800; font-size: 0.78rem; border: 1px solid rgba(148, 163, 184, 0.18); }
      .status-dot { width: 8px; height: 8px; border-radius: 999px; background: #94a3b8; }
      .active .status-dot { background: #38bdf8; animation: pulse 1s infinite; }
      .done .status-dot { background: #22c55e; }
      .error .status-dot { background: #ef4444; }
      .activity-summary { color: #cbd5e1; font-size: 0.78rem; flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
      .activity-toggle-hint { color: #67e8f9; font-size: 0.78rem; font-weight: 800; }
      .activity-drawer-body { display: grid; grid-template-columns: minmax(0, 0.9fr) minmax(0, 1.1fr); gap: 12px; padding: 0 14px 14px; }
      .activity-drawer-body h2 { font-size: 0.78rem; }
      .timeline { list-style: none; margin: 0; padding: 0; display: grid; gap: 6px; }
      .timeline li { display: flex; gap: 10px; align-items: flex-start; border: 1px solid rgba(255,255,255,0.08); border-radius: 10px; padding: 8px 10px; background: rgba(15,23,42,0.54); font-size: 0.78rem; }
      .activity-spinner { width: 14px; height: 14px; border-radius: 999px; border: 2px solid rgba(148,163,184,0.30); border-top-color: #38bdf8; animation: spin 0.8s linear infinite; }
      .activity-time { display: block; color: #94a3b8; font-size: 0.72rem; font-weight: 700; letter-spacing: 0.08em; text-transform: uppercase; }
      @keyframes spin { to { transform: rotate(360deg); } }
      @keyframes pulse { 50% { transform: scale(1.3); opacity: 0.7; } }
      .example-link { color: #7dd3fc; font-size: 0.8rem; font-weight: 800; text-decoration: none; }
      .example-link:hover { text-decoration: underline; }
      body.compact .settings-fab,
      body.compact .font-customizer,
      body.compact #githubAgentId { display: none; }
      @media (max-width: 1100px) {
        .kpi-strip { grid-template-columns: repeat(3, minmax(0, 1fr)); }
        .report-grid { grid-template-columns: 1fr 1fr; }
      }
      @media (max-width: 760px) {
        .shell, .activity-drawer-body { grid-template-columns: 1fr; }
        .kpi-strip { grid-template-columns: repeat(2, minmax(0, 1fr)); }
        .action-grid { grid-template-columns: 1fr; }
        .repo-profile { grid-template-columns: repeat(2,minmax(0,1fr)); }
        .report-grid, .practice-grid, .criteria-grid { grid-template-columns: 1fr; }
        .assistant { position: static; }
        .font-customizer { position: static; margin: 12px 0 0; }
      }
      @media (prefers-reduced-motion: reduce) {
        *, *::before, *::after { scroll-behavior: auto !important; animation-duration: 0.01ms !important; animation-iteration-count: 1 !important; }
      }
    </style>
  </head>
  <body class="${compact ? "compact" : "standalone"}">
    <main>
      <section class="hero">
        <div class="hero-row">
          <div class="hero-title">
            <p class="eyebrow"><span class="pulse"></span>GitHub REST API • CAS protected</p>
            <h1>OSS Repo Report Card</h1>
            <p class="subtitle">Source-backed adoption, engagement, delivery, contributor, and security trends for an open source repository.</p>
          </div>
          <div class="controls">
            <input id="repoInput" value="${escapeHtml(defaultRepoName)}" aria-label="Repository owner/repo" placeholder="owner/repo or GitHub URL" />
            <button id="runAnalysis">Generate report card</button>
            <button id="downloadMarkdown" class="ghost" type="button" disabled>Download Markdown</button>
            <a class="example-link" href="${basePath}/example">Static example</a>
          </div>
        </div>
        <div class="run-history">
          <select id="runHistory" aria-label="Cached OSS repo report cards"><option value="">No cached report cards yet</option></select>
        </div>
        <div class="data-status" id="dataStatus" role="status" aria-live="polite">
          <span class="status-chip good">CAS ${escapeHtml(authorization?.launchDecision || "verified")}</span>
          <span class="status-chip ${githubToken ? "good" : "warn"}">GitHub ${githubToken ? "server credential" : "public API"}</span>
          <span>Enter a repository to load a live snapshot.</span>
        </div>
      </section>

      <button class="settings-fab" id="settingsToggle" type="button" aria-expanded="false" aria-controls="fontCustomizer">Settings</button>
      <div class="font-customizer font-dock" id="fontCustomizer" aria-label="Font customization" hidden>
        <span class="font-dock-title">View settings</span>
        <label>Font <select id="fontFamilySelect" aria-label="Font family"><option value="inter">Inter</option><option value="system">System</option><option value="mono">Mono</option><option value="serif">Serif</option></select></label>
        <label>Size <select id="fontScaleSelect" aria-label="Text size"><option value="small">Small</option><option value="default">Default</option><option value="large">Large</option><option value="xl">XL</option></select></label>
      </div>

      <div class="panel">
        <h2>Report card summary</h2>
        <div class="kpi-strip" id="summaryCards"></div>
        <div class="insights-strip" id="insightsStrip" hidden></div>
        <div class="repo-profile" id="repoProfile" hidden></div>
      </div>

      <div class="panel" id="trendsPanel" hidden>
        <h2>12-week trends</h2>
        <div class="report-grid">
          <article class="repo-health-card chart-card" id="starTrend"></article>
          <article class="repo-health-card chart-card" id="engagementTrend"></article>
          <article class="repo-health-card chart-card" id="prTrend"></article>
          <article class="repo-health-card chart-card" id="commitTrend"></article>
        </div>
      </div>

      <div class="panel" id="healthPanel" hidden>
        <h2>Community &amp; security posture</h2>
        <div class="practice-grid" id="healthPractices"></div>
        <div class="readiness-head"><strong>OSS foundation readiness criteria</strong><span id="readinessSummary"></span></div>
        <p class="coverage" id="readinessCaveat"></p>
        <div class="criteria-grid" id="readinessCriteria"></div>
        <div class="framework-links" id="frameworkLinks"></div>
      </div>

      <div class="shell">
        <section>
          <div class="panel">
            <h2>Maintainer Action Cards</h2>
            <div class="action-grid" id="actionCards"></div>
          </div>
        </section>
        <aside class="assistant">
          <p class="eyebrow">Maintainer copilot</p>
          <h2>Repo Report Card Assistant</h2>
          <p class="subtitle">Share the verified repository snapshot with Grid, then ask about triage, review queues, or release readiness.</p>
          <input id="githubAgentId" aria-label="GitHub agent id" value="${escapeHtml(defaultGithubAgentId)}" style="width: 100%; margin: 8px 0;" />
          <textarea id="questionInput" aria-label="Repository question" placeholder="Ask: what needs maintainer attention in this repo?"></textarea>
          <button id="openAssistantChat" style="margin-top: 8px;" type="button">Ask with current context</button>
          <button id="askRepoCopilot" class="ghost" ${defaultGithubAgentId ? "" : "hidden"}>Generate optional agent brief</button>
          <div class="message" id="copilotMessage">${defaultGithubAgentId ? "Optional GitHub agent is configured." : "Live metrics use GitHub directly. No optional repository agent is configured."}</div>
        </aside>
      </div>

      <footer class="activity-footer" id="activityFooter" ${defaultGithubAgentId ? "" : "hidden"}>
        <details id="activityDrawer">
          <summary>
            <span class="run-status" id="runStatus"><span class="status-dot"></span>Ready</span>
            <span class="activity-summary" id="activitySummary">Agent activity appears here during a live repo run.</span>
            <span>Details</span>
          </summary>
          <div class="activity-drawer-body">
            <section><h2>Live Agent Activity</h2><ol class="timeline" id="agentProgress"></ol></section>
            <section><h2>Streamed Report</h2><div class="message" id="streamedContent">Streamed agent content will appear here.</div></section>
          </div>
        </details>
      </footer>
    </main>
    ${renderAgenticAppConversationClient()}
    ${renderMicrofrontendClient("oss-repo-management")}
    <script>
      const basePath = ${JSON.stringify(basePath)};
      const state = { dashboard: null, activityEventCount: 0, runs: loadRunHistory(), staleDays: 30, loadedAt: null };
      ${buildOssRepoMarkdownReport.toString()}
      const fontStorageKey = "agentic-app.fontPreferences";
      const repoInput = document.getElementById("repoInput");
      const questionInput = document.getElementById("questionInput");
      const copilotMessage = document.getElementById("copilotMessage");
      const settingsToggle = document.getElementById("settingsToggle");
      const fontCustomizer = document.getElementById("fontCustomizer");
      const fontFamilySelect = document.getElementById("fontFamilySelect");
      const fontScaleSelect = document.getElementById("fontScaleSelect");

      document.getElementById("runAnalysis").addEventListener("click", () => loadGitHubSummary({ forceRefresh: true }));
      document.getElementById("downloadMarkdown").addEventListener("click", downloadMarkdownReport);
      repoInput.addEventListener("keydown", (event) => {
        if (event.key === "Enter") loadGitHubSummary({ forceRefresh: true });
      });
      document.getElementById("askRepoCopilot").addEventListener("click", () => runRepoAgent(questionInput.value.trim()));
      document.getElementById("openAssistantChat").addEventListener("click", openAssistantChat);
      document.getElementById("runHistory").addEventListener("change", loadSelectedRun);
      settingsToggle.addEventListener("click", toggleFontSettings);
      fontFamilySelect.addEventListener("change", writeFontPreferences);
      fontScaleSelect.addEventListener("change", writeFontPreferences);
      window.addEventListener("caipe:microfrontend-initialize", (event) => {
        const staleDays = Number(event.detail?.preferences?.staleDays);
        if (Number.isFinite(staleDays) && staleDays >= 1 && staleDays <= 365) {
          state.staleDays = Math.round(staleDays);
          renderDataStatus(state.dashboard);
        }
      });

      applyFontPreferences();
      renderRunHistory();
      if (repoInput.value.trim()) loadGitHubSummary();
      else renderEmptyDashboard();

      async function loadGitHubSummary({ forceRefresh = false } = {}) {
        const repo = repoInput.value.trim();
        if (!repo) {
          renderEmptyDashboard("Enter a repository as owner/repo to load live GitHub metrics.");
          repoInput.focus();
          return;
        }
        setRunButtonBusy(true);
        renderLoadingDashboard(repo);
        try {
          const refresh = forceRefresh ? "&refresh=1" : "";
          const response = await fetch(appUrl("/api/summary?repo=" + encodeURIComponent(repo) + "&staleDays=" + state.staleDays + refresh), {
            headers: { accept: "application/json" },
          });
          const payload = await response.json();
          if (!response.ok) {
            const code = payload.error ? " [" + payload.error + "]" : "";
            throw new Error((payload.message || "Could not load repository data") + code);
          }
          applyDashboard(payload);
          copilotMessage.textContent = "Live GitHub snapshot loaded. Open Repo Report Card Assistant to work with this context.";
        } catch (error) {
          renderLoadError(repo, error instanceof Error ? error.message : "Could not load repository data");
        } finally {
          setRunButtonBusy(false);
        }
      }

      async function runRepoAgent(question) {
        const githubAgentId = document.getElementById("githubAgentId").value.trim() || ${JSON.stringify(defaultGithubAgentId)};
        const repo = repoInput.value.trim() || "owner/repo";
        const kind = "repo-health";
        if (!githubAgentId) {
          copilotMessage.textContent = "No optional repository agent is configured. Use Ask with current context instead.";
          openAssistantChat();
          return;
        }
        initializeActivityFeed();
        setRunButtonBusy(true);
        copilotMessage.textContent = "Streaming GitHub repository analysis...";
        const prompt = [
          "Build an OSS Repo Report Card for repository " + repo + " with dashboard kind " + kind + ".",
          question ? "User question: " + question + "." : "User question: summarize repository health and maintainer next actions.",
          "Treat issues with no activity for at least " + state.staleDays + " days as stale.",
          "Use GitHub issue and pull request context through the configured CAIPE GitHub agent.",
          "Use submit_structured_response with the requested oss_repo_management.dashboard.v1 schema before the final explanation.",
          "Render repo-health-card, maintainer-ask, risks, recommendations, confidence, issue counts, and pull request counts.",
          "Do not invent issue IDs, PRs, or owners. If agent data is unavailable, explain what configuration is missing."
        ].join(" ");
        try {
          updateAgentProgress("Running CAIPE structured invoke", "GitHub: " + githubAgentId + " • Repo: " + repo);
          const invoked = await invokeAgenticApp({
            agentId: githubAgentId,
            appId: "oss-repo-management",
            title: "OSS repository dashboard · " + repo,
            message: prompt,
            clientContext: {
              repo,
              dashboardKind: kind,
              question,
              staleDays: state.staleDays,
              response_format: ${JSON.stringify(buildOssRepoManagementDashboardResponseFormat())},
            },
          });
          appendStreamContent(invoked.content || "");
          if (invoked.structured_output) {
            appendActivityEvent("Received oss_repo_management.dashboard.v1", invoked.structured_output_schema_id || "Schema id not provided.", "done");
            applyDashboard(normalizeDashboard(invoked.structured_output, repo));
            copilotMessage.textContent = invoked.content || "Repository agent finished.";
            setRunStatus("done", "Complete");
          } else {
            updateAgentProgress("No structured output", "The GitHub agent invoke completed without oss_repo_management.dashboard.v1.", "error");
            const local = await fetch(appUrl("/api/copilotkit/repo-agent"), {
              method: "POST",
              headers: { "content-type": "application/json", accept: "application/json" },
              body: JSON.stringify({ repo, dashboardKind: kind, question }),
            });
            const result = await local.json();
            copilotMessage.textContent = (invoked.content || result.message) + " The live GitHub metrics remain unchanged because no structured dashboard was returned.";
            setRunStatus("error", "Agent output missing");
          }
        } catch (error) {
          updateAgentProgress("GitHub agent invoke unavailable", error instanceof Error ? error.message : "Invoke unavailable", "error");
          const local = await fetch(appUrl("/api/copilotkit/repo-agent"), {
            method: "POST",
            headers: { "content-type": "application/json", accept: "application/json" },
            body: JSON.stringify({ repo, dashboardKind: kind, question }),
          });
          const result = await local.json();
          copilotMessage.textContent = (error instanceof Error ? error.message : result.message) + ". The live GitHub metrics remain available.";
          updateAgentProgress(
            "Agent structured output required",
            result.dashboard?.reason || result.dashboard?.summary || "Repository data requires the CAIPE GitHub agent.",
            "error",
          );
          setRunStatus("error", "Agent unavailable");
        } finally {
          setRunButtonBusy(false);
        }
      }

      function applyDashboard(dashboard, options = {}) {
        state.dashboard = normalizeDashboard(dashboard, repoInput.value);
        state.reportOrigin = options.origin || "live";
        state.loadedAt = resolveDashboardLoadedAt(state.dashboard);
        renderSummaryCards(state.dashboard);
        renderInsights(state.dashboard);
        renderRepoProfile(state.dashboard);
        renderReportCardPanels(state.dashboard);
        renderActionCards(state.dashboard);
        renderDataStatus(state.dashboard);
        document.getElementById("downloadMarkdown").disabled = false;
        if (options.persist !== false) persistRun(state.dashboard);
        publishAssistantContext("dashboard");
      }

      function renderEmptyDashboard(message = "Choose a repository to see live issue and pull request health.") {
        state.dashboard = null;
        state.loadedAt = null;
        document.getElementById("downloadMarkdown").disabled = true;
        document.getElementById("summaryCards").innerHTML = '<div class="empty-state"><strong>Start with a repository</strong><p>' + escapeHtml(message) + ' The GitHub credential remains on the server.</p></div>';
        document.getElementById("insightsStrip").hidden = true;
        document.getElementById("repoProfile").hidden = true;
        document.getElementById("trendsPanel").hidden = true;
        document.getElementById("healthPanel").hidden = true;
        document.getElementById("actionCards").innerHTML = '<div class="empty-state"><strong>No maintainer actions yet</strong><p>Actions are derived from a verified GitHub snapshot after the repository loads.</p></div>';
      }

      function renderLoadingDashboard(repo) {
        document.getElementById("summaryCards").innerHTML = '<div class="empty-state"><strong>Loading ' + escapeHtml(repo) + '</strong><p>Reading source-backed issue and pull request signals from GitHub.</p></div>';
        document.getElementById("insightsStrip").hidden = true;
        document.getElementById("repoProfile").hidden = true;
        document.getElementById("trendsPanel").hidden = true;
        document.getElementById("healthPanel").hidden = true;
        document.getElementById("actionCards").innerHTML = '<div class="empty-state"><strong>Computing maintainer priorities</strong><p>Reconciling critical, stale, triage, blocked, and review queues.</p></div>';
      }

      function renderLoadError(repo, message) {
        state.dashboard = null;
        state.loadedAt = null;
        document.getElementById("downloadMarkdown").disabled = true;
        document.getElementById("summaryCards").innerHTML = '<div class="empty-state"><strong>Could not load ' + escapeHtml(repo) + '</strong><p>' + escapeHtml(message) + '</p></div>';
        document.getElementById("insightsStrip").hidden = true;
        document.getElementById("repoProfile").hidden = true;
        document.getElementById("trendsPanel").hidden = true;
        document.getElementById("healthPanel").hidden = true;
        document.getElementById("actionCards").innerHTML = '<div class="empty-state"><strong>Source access needs attention</strong><p>Check the repository name and server-side GitHub credential, then retry.</p></div>';
        document.getElementById("dataStatus").innerHTML = '<span class="status-chip good">CAS ${escapeHtml(authorization?.launchDecision || "verified")}</span><span class="status-chip warn">GitHub request failed</span><span>' + escapeHtml(message) + '</span>';
        copilotMessage.textContent = "Repository context was not published because the GitHub source could not be verified.";
      }

      function normalizeDashboard(dashboard, fallbackRepo) {
        return {
          ...dashboard,
          repo: dashboard?.repo || fallbackRepo || "owner/repo",
          issues: dashboard?.issues || {},
          pullRequests: dashboard?.pullRequests || {},
          risks: Array.isArray(dashboard?.risks) ? dashboard.risks : [],
          recommendations: Array.isArray(dashboard?.recommendations) ? dashboard.recommendations : [],
          maintainerAsks: Array.isArray(dashboard?.maintainerAsks) ? dashboard.maintainerAsks : [],
          trends: dashboard?.trends || {},
          community: dashboard?.community || {},
          ownership: dashboard?.ownership || {},
          security: dashboard?.security || {},
          readiness: dashboard?.readiness || { checks: [] },
          frameworks: Array.isArray(dashboard?.frameworks) ? dashboard.frameworks : [],
        };
      }

      function renderDataStatus(dashboard) {
        const node = document.getElementById("dataStatus");
        const source = dashboard?.source === "github-api" ? "GitHub REST API" : "Not loaded";
        const freshness = state.loadedAt
          ? (state.reportOrigin === "cached" ? "Cached report generated " : "Generated ") + state.loadedAt.toLocaleString()
          : "Freshness: not loaded";
        const accessMode = dashboard?.provenance?.accessMode || ${JSON.stringify(githubToken ? "server credential" : "public API")};
        const cacheStatus = state.reportOrigin === "cached"
          ? "Browser cache"
          : dashboard?.delivery?.cache === "hit" ? "Runtime cache hit" : "Fresh source report";
        node.innerHTML =
          '<span class="status-chip good">CAS ${escapeHtml(authorization?.launchDecision || "verified")}</span>' +
          '<span class="status-chip good">Source: ' + escapeHtml(source) + '</span>' +
          '<span class="status-chip">Access: ' + escapeHtml(accessMode) + '</span>' +
          '<span class="status-chip">' + escapeHtml(cacheStatus) + '</span>' +
          '<span>' + escapeHtml(freshness) + ' · Stale threshold: ' + state.staleDays + ' days</span>';
      }

      function resolveDashboardLoadedAt(dashboard) {
        if (!dashboard || dashboard.source !== "github-api") return null;
        const reportedAt = dashboard.generatedAt || dashboard.generated_at || dashboard.updatedAt || dashboard.updated_at;
        const timestamp = Date.parse(String(reportedAt || ""));
        return Number.isNaN(timestamp) ? new Date() : new Date(timestamp);
      }

      function renderSummaryCards(dashboard) {
        const repo = dashboard.repo || "owner/repo";
        const repository = dashboard.repository || {};
        const community = dashboard.community || {};
        const securityScore = dashboard.security?.scorecard?.score;
        const openPRs = dashboard.pullRequests.open ?? 0;
        const awaitingReview = dashboard.pullRequests.awaitingReview ?? 0;
        const confidence = dashboard.confidence || "unknown";
        document.getElementById("summaryCards").innerHTML = [
          kpiTile({
            label: "Repository",
            value: repo,
            sub: "Confidence: " + escapeHtml(confidence),
            accent: "attention",
            valueClass: "kpi-repo",
          }),
          kpiTile({
            label: "Stars",
            value: formatCount(repository.stars),
            sub: formatCount(repository.forks) + " forks",
            accent: "good",
          }),
          kpiTile({
            label: "Contributors",
            value: (community.totalContributorsIsLowerBound ? "≥" : "") + formatCount(community.totalContributors),
            sub: formatCount(community.activeContributors) + " active in trend sample",
            accent: "attention",
          }),
          kpiTile({
            label: "Engagement",
            value: formatCount(community.engagementInteractions),
            sub: "issues + comments in " + formatCount(community.engagementSampleSize) + " sampled issues",
            accent: "attention",
          }),
          kpiTile({
            label: "Open PRs",
            value: formatCount(openPRs),
            sub: formatCount(awaitingReview) + " need review attention",
            accent: awaitingReview ? "warn" : "good",
          }),
          kpiTile({
            label: "OpenSSF score",
            value: securityScore == null ? "N/A" : Number(securityScore).toFixed(1),
            sub: securityScore == null ? "Not available" : "0–10 security practices",
            accent: securityScore == null ? "attention" : securityScore >= 7 ? "good" : securityScore >= 5 ? "warn" : "danger",
            bar: securityScore == null ? null : Number(securityScore) * 10,
          }),
        ].join("");

        const repoLabel = document.querySelector(".kpi-repo");
        if (repoLabel) {
          repoLabel.style.fontSize = "1.05rem";
          repoLabel.style.overflow = "hidden";
          repoLabel.style.textOverflow = "ellipsis";
          repoLabel.style.whiteSpace = "nowrap";
        }
      }

      function renderRepoProfile(dashboard) {
        const profile = document.getElementById("repoProfile");
        const repository = dashboard.repository || {};
        if (!repository.htmlUrl) {
          profile.hidden = true;
          profile.innerHTML = "";
          return;
        }
        profile.hidden = false;
        profile.innerHTML = [
          '<article class="repo-health-card"><div class="label">Repository</div><strong><a class="repo-link" href="' + escapeAttribute(repository.htmlUrl) + '" target="_blank" rel="noreferrer">' + escapeHtml(dashboard.repo) + '</a></strong><p>' + escapeHtml(repository.description || "") + '</p></article>',
          '<article class="repo-health-card"><div class="label">Visibility</div><strong>' + escapeHtml(repository.visibility || "unknown") + '</strong><p>Default branch: ' + escapeHtml(repository.defaultBranch || "unknown") + '</p></article>',
          '<article class="repo-health-card"><div class="label">Community</div><strong>' + formatCount(repository.stars) + ' stars</strong><p>' + formatCount(repository.forks) + ' forks</p></article>',
          '<article class="repo-health-card"><div class="label">Latest push</div><strong>' + escapeHtml(repository.pushedAt ? new Date(repository.pushedAt).toLocaleDateString() : "Unknown") + '</strong><p>' + (repository.archived ? "Archived repository" : "Active repository") + '</p></article>',
        ].join("");
      }

      function renderReportCardPanels(dashboard) {
        const trends = dashboard.trends || {};
        const coverage = trends.coverage || {};
        const starPoints = mergeCachedStarHistory(dashboard);
        document.getElementById("trendsPanel").hidden = false;
        document.getElementById("starTrend").innerHTML = renderLineChart("Star history", starPoints, coverage.stars || "Timestamped report-card snapshots.");
        document.getElementById("engagementTrend").innerHTML = renderBarChart("Issue engagement", trends.engagementPerWeek || [], coverage.engagement || "No issue engagement coverage.");
        document.getElementById("prTrend").innerHTML = renderBarChart("PRs per week", trends.pullRequestsPerWeek || [], coverage.pullRequests || "No pull request trend coverage.");
        document.getElementById("commitTrend").innerHTML = renderBarChart("Commits per week", trends.commitsPerWeek || [], coverage.commits || "No commit trend coverage.");

        const community = dashboard.community || {};
        const ownership = dashboard.ownership || {};
        const maintainerHandles = ownership.maintainers?.handles || [];
        const codeownerHandles = ownership.codeowners?.handles || [];
        const scorecard = dashboard.security?.scorecard || {};
        const alerts = dashboard.security?.githubAlerts || {};
        const practices = [
          practiceCard("Community health", community.communityHealthPercent == null ? "N/A" : community.communityHealthPercent + "%", community.communityHealthPercent != null),
          practiceCard("Active contributors", formatCount(community.activeContributors), Number(community.activeContributors) > 0),
          practiceCard("Declared maintainers", maintainerHandles.length ? maintainerHandles.join(", ") : (ownership.maintainers?.path ? "File detected" : "Not declared"), maintainerHandles.length > 0),
          practiceCard("CODEOWNERS", codeownerHandles.length ? codeownerHandles.join(", ") : (ownership.codeowners?.path ? "File detected" : "Not declared"), codeownerHandles.length > 0),
          practiceCard("Security policy", community.hasSecurityPolicy ? "Present" : "Missing", community.hasSecurityPolicy),
          practiceCard("Contributing guide", community.hasContributing ? "Present" : "Missing", community.hasContributing),
          practiceCard("Code of conduct", community.hasCodeOfConduct ? "Present" : "Missing", community.hasCodeOfConduct),
          practiceCard("License", community.hasLicense ? "Detected" : "Missing", community.hasLicense),
          practiceCard("Dependabot alerts", alerts.dependabotOpen == null ? "Permission needed" : formatCount(alerts.dependabotOpen) + " open", alerts.dependabotOpen === 0),
          practiceCard("Code scanning alerts", alerts.codeScanningOpen == null ? "Permission needed" : formatCount(alerts.codeScanningOpen) + " open", alerts.codeScanningOpen === 0),
        ];
        if (scorecard.status === "available") {
          practices.unshift(practiceCard("OpenSSF Scorecard", Number(scorecard.score).toFixed(1) + " / 10", Number(scorecard.score) >= 7));
          (scorecard.checks || []).slice(0, 3).forEach((check) => practices.push(practiceCard("Scorecard · " + (check.name || "check"), Number(check.score).toFixed(0) + " / 10", Number(check.score) >= 7)));
        }
        document.getElementById("healthPanel").hidden = false;
        document.getElementById("healthPractices").innerHTML = practices.join("");
        renderReadinessCriteria(dashboard.readiness || {});
        document.getElementById("frameworkLinks").innerHTML = (dashboard.frameworks || []).map((framework) =>
          '<a href="' + escapeAttribute(framework.url || "#") + '" target="_blank" rel="noreferrer">' + escapeHtml(framework.name || "Framework") + ' · ' + escapeHtml(framework.focus || "") + '</a>'
        ).join("");
      }

      function renderReadinessCriteria(readiness) {
        const checks = Array.isArray(readiness.checks) ? readiness.checks : [];
        const summary = readiness.summary || {};
        document.getElementById("readinessSummary").textContent = [
          formatCount(summary.pass) + " pass",
          formatCount(summary.warn) + " needs attention",
          formatCount(summary.manual) + " manual",
          formatCount(summary.unavailable) + " unavailable",
        ].join(" · ");
        document.getElementById("readinessCaveat").textContent = readiness.caveat || "Evidence-based checks; not a foundation acceptance grade.";
        document.getElementById("readinessCriteria").innerHTML = checks.map((check) =>
          '<article class="criterion ' + escapeAttribute(check.status || "manual") + '">' +
            '<div class="label">' + escapeHtml(check.dimension || "Criterion") + '<span class="criterion-status">' + escapeHtml(check.status || "manual") + '</span></div>' +
            '<strong>' + escapeHtml(check.criterion || "Readiness check") + '</strong>' +
            '<p>' + escapeHtml(check.evidence || "No evidence available.") + '<br>Source: ' + escapeHtml(check.source || "unknown") + '</p>' +
          '</article>'
        ).join("");
      }

      function practiceCard(label, value, healthy) {
        return '<article class="practice ' + (healthy ? "good" : "warn") + '"><div class="label">' + escapeHtml(label) + '</div><strong>' + escapeHtml(String(value)) + '</strong></article>';
      }

      function renderBarChart(title, points, coverage) {
        const values = Array.isArray(points) ? points : [];
        const max = Math.max(1, ...values.map((point) => Number(point.value || 0)));
        const total = values.reduce((sum, point) => sum + Number(point.value || 0), 0);
        const bars = values.map((point) => {
          const height = Math.max(2, Math.round((Number(point.value || 0) / max) * 100));
          const label = String(point.week || point.date || "") + ": " + Number(point.value || 0);
          return '<span class="bar" style="height:' + height + '%" data-label="' + escapeAttribute(label) + '"></span>';
        }).join("");
        const first = values[0]?.week || "";
        const last = values[values.length - 1]?.week || "";
        return '<div class="chart-head"><strong>' + escapeHtml(title) + '</strong><span>' + formatCount(total) + ' sampled</span></div>' +
          '<div class="bar-chart" role="img" aria-label="' + escapeAttribute(title) + '">' + bars + '</div>' +
          '<div class="axis-labels"><span>' + escapeHtml(shortDate(first)) + '</span><span>' + escapeHtml(shortDate(last)) + '</span></div>' +
          '<p class="coverage">' + escapeHtml(coverage) + '</p>';
      }

      function renderLineChart(title, points, coverage) {
        const values = Array.isArray(points) ? points : [];
        if (values.length < 2) {
          const current = values[0]?.value ?? state.dashboard?.repository?.stars ?? 0;
          return '<div class="chart-head"><strong>' + escapeHtml(title) + '</strong><span>' + formatCount(current) + ' current</span></div><div class="empty-state"><strong>History starts now</strong><p>Generate another report later to add a timestamped star snapshot.</p></div><p class="coverage">' + escapeHtml(coverage) + '</p>';
        }
        const numbers = values.map((point) => Number(point.value || 0));
        const min = Math.min(...numbers);
        const max = Math.max(...numbers);
        const range = Math.max(1, max - min);
        const coords = values.map((point, index) => {
          const x = values.length === 1 ? 0 : (index / (values.length - 1)) * 300;
          const y = 105 - ((Number(point.value || 0) - min) / range) * 90;
          return x.toFixed(1) + ',' + y.toFixed(1);
        }).join(' ');
        return '<div class="chart-head"><strong>' + escapeHtml(title) + '</strong><span>' + formatCount(numbers[numbers.length - 1]) + ' current</span></div>' +
          '<svg class="sparkline" viewBox="0 0 300 112" preserveAspectRatio="none" role="img" aria-label="Star count over time"><defs><linearGradient id="starGradient" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#34d399"/><stop offset="1" stop-color="#34d399" stop-opacity="0"/></linearGradient></defs><polyline class="line" points="' + coords + '"/></svg>' +
          '<div class="axis-labels"><span>' + escapeHtml(shortDate(values[0].date)) + '</span><span>' + escapeHtml(shortDate(values[values.length - 1].date)) + '</span></div><p class="coverage">' + escapeHtml(coverage) + '</p>';
      }

      function mergeCachedStarHistory(dashboard) {
        const repo = dashboard.repo;
        const points = [...(dashboard.trends?.starHistory || [])];
        state.runs.filter((run) => run.dashboard?.repo === repo).forEach((run) => {
          const date = run.dashboard?.generatedAt || run.updatedAt;
          const value = run.dashboard?.repository?.stars;
          if (date && Number.isFinite(Number(value))) points.push({ date: String(date), value: Number(value) });
        });
        if (dashboard.generatedAt && Number.isFinite(Number(dashboard.repository?.stars))) {
          points.push({ date: dashboard.generatedAt, value: Number(dashboard.repository.stars) });
        }
        const unique = new Map(points.map((point) => [String(point.date), { date: String(point.date), value: Number(point.value || 0) }]));
        return [...unique.values()].sort((left, right) => Date.parse(left.date) - Date.parse(right.date));
      }

      function shortDate(value) {
        const date = new Date(String(value || "") + (String(value || "").length === 10 ? "T00:00:00Z" : ""));
        return Number.isNaN(date.getTime()) ? "" : date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
      }

      function renderInsights(dashboard) {
        const strip = document.getElementById("insightsStrip");
        const insights = [];
        const openIssues = dashboard.issues.open ?? 0;
        const stale = dashboard.issues.stale ?? 0;
        const p0 = dashboard.issues.p0 ?? 0;
        const needsTriage = dashboard.issues.needsTriage ?? 0;
        const openPRs = dashboard.pullRequests.open ?? 0;
        const awaitingReview = dashboard.pullRequests.awaitingReview ?? 0;
        const blockedPRs = dashboard.pullRequests.blocked ?? 0;

        if (p0 > 0) {
          insights.push({ icon: "🔥", title: formatCount(p0) + " P0 issue" + (p0 === 1 ? "" : "s"), sub: "Triage and assign owners immediately" });
        }
        if (blockedPRs > 0) {
          insights.push({ icon: "🚧", title: formatCount(blockedPRs) + " blocked PR" + (blockedPRs === 1 ? "" : "s"), sub: "Unblock to restore review flow" });
        }
        if (openIssues > 0 && stale / openIssues >= 0.3) {
          insights.push({ icon: "🧹", title: Math.round((stale / openIssues) * 100) + "% of open issues are stale", sub: "Backlog hygiene needed" });
        }
        if (needsTriage > 0) {
          insights.push({ icon: "🏷️", title: formatCount(needsTriage) + " issues need triage", sub: "Label, prioritize, assign" });
        }
        if (awaitingReview >= 5) {
          insights.push({ icon: "👀", title: formatCount(awaitingReview) + " PRs need review attention", sub: "Reviewer load is high" });
        }
        const topRisk = (dashboard.risks || [])[0];
        if (topRisk?.title) {
          insights.push({ icon: topRisk.severity === "high" ? "⚠️" : "ℹ️", title: topRisk.title, sub: topRisk.rationale || "Top risk surfaced by agent" });
        }
        if (!insights.length && (openIssues || openPRs)) {
          insights.push({ icon: "✅", title: "Repository signals look healthy", sub: "No P0, blockers, or large backlog detected" });
        }

        if (!insights.length) {
          strip.hidden = true;
          strip.innerHTML = "";
          return;
        }
        strip.hidden = false;
        strip.innerHTML = insights.slice(0, 4).map((ins) =>
          '<div class="insight">' +
            '<span class="insight-icon" aria-hidden="true">' + escapeHtml(ins.icon) + '</span>' +
            '<div class="insight-text">' +
              '<strong>' + escapeHtml(ins.title) + '</strong>' +
              (ins.sub ? '<small>' + escapeHtml(ins.sub) + '</small>' : '') +
            '</div>' +
          '</div>'
        ).join("");
      }

      function kpiTile({ label, value, sub, accent = "attention", bar = null, valueClass = "" }) {
        const barHtml = typeof bar === "number"
          ? '<div class="progress-bar"><div class="progress-fill" style="width:' + Math.max(0, Math.min(100, bar)) + '%"></div></div>'
          : "";
        return (
          '<div class="kpi accent-' + escapeAttribute(accent) + '">' +
            '<div class="kpi-label">' + escapeHtml(label) + '</div>' +
            '<div class="kpi-value ' + escapeAttribute(valueClass || "") + '">' + escapeHtml(String(value)) + '</div>' +
            (sub ? '<div class="kpi-sub">' + escapeHtml(sub) + '</div>' : "") +
            barHtml +
          '</div>'
        );
      }

      function formatCount(value) {
        const num = Number(value || 0);
        if (!isFinite(num)) return "0";
        if (Math.abs(num) >= 1000) return (num / 1000).toFixed(num >= 10000 ? 0 : 1) + "k";
        return String(num);
      }

      function renderActionCards(dashboard) {
        const risks = dashboard.risks.map((risk) => '<article class="action-card repo-health-card"><div class="label severity-' + escapeAttribute(risk.severity || "medium") + '">' + escapeHtml(risk.severity || "risk") + '</div><strong>' + escapeHtml(risk.title || "Repository risk") + '</strong><p>' + escapeHtml(risk.rationale || "") + '</p></article>');
        const asks = dashboard.maintainerAsks.map((ask) => '<article class="action-card maintainer-ask"><div class="label">Maintainer Ask</div><strong>' + escapeHtml(ask.title || "Action needed") + '</strong><p>' + escapeHtml(ask.detail || "") + '</p></article>');
        const recs = dashboard.recommendations.map((rec) => '<article class="action-card"><div class="label">Recommended Action</div><p>' + escapeHtml(rec) + '</p></article>');
        document.getElementById("actionCards").innerHTML = [...risks, ...asks, ...recs].join("");
      }

      function card(label, value) {
        return '<article class="repo-health-card"><div class="label">' + escapeHtml(label) + '</div><div class="value">' + escapeHtml(String(value)) + '</div></article>';
      }

      function initializeActivityFeed() {
        state.activityEventCount = 0;
        document.getElementById("agentProgress").innerHTML = "";
        document.getElementById("streamedContent").textContent = "";
        setRunStatus("active", "Running");
      }

      function updateAgentProgress(label, detail, status = "active") {
        appendActivityEvent(label, detail, status);
      }

      function appendActivityEvent(label, detail, status = "active") {
        state.activityEventCount += 1;
        const icon = status === "active" ? '<span class="activity-spinner"></span>' : status === "error" ? "!" : "✓";
        const item = document.createElement("li");
        item.innerHTML = '<span aria-hidden="true">' + icon + '</span><span><span class="activity-time">' + new Date().toLocaleTimeString() + '</span><strong>' + escapeHtml(label) + '</strong><br><span>' + escapeHtml(detail || "") + '</span></span>';
        document.getElementById("agentProgress").prepend(item);
        document.getElementById("activitySummary").textContent = state.activityEventCount + " repo agent events captured.";
      }

      function setRunStatus(status, label) {
        const runStatus = document.getElementById("runStatus");
        runStatus.className = "run-status " + status;
        runStatus.innerHTML = '<span class="status-dot"></span>' + escapeHtml(label);
      }

      function setRunButtonBusy(isBusy) {
        const button = document.getElementById("runAnalysis");
        button.disabled = isBusy;
        button.textContent = isBusy ? "Generating report card..." : "Generate report card";
      }

      async function consumeAgentStream(response) {
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        const streamState = { text: "", structuredOutput: null, buffer: "" };
        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          streamState.buffer += decoder.decode(value, { stream: true });
          const frames = streamState.buffer.split("\\n\\n");
          streamState.buffer = frames.pop() || "";
          frames.forEach((frameText) => handleStreamEvent(parseSseFrame(frameText), streamState));
        }
        if (streamState.buffer.trim()) handleStreamEvent(parseSseFrame(streamState.buffer), streamState);
        return streamState;
      }

      function parseSseFrame(frameText) {
        const frame = { event: "message", data: "" };
        for (const line of frameText.split("\\n")) {
          if (line.startsWith("event:")) frame.event = line.slice(6).trim();
          if (line.startsWith("data:")) frame.data += line.slice(5).trim();
        }
        return frame;
      }

      function handleStreamEvent(frame, streamState) {
        const payload = parseJson(frame.data);
        if (frame.event === "content") {
          const chunk = payload.content || payload.text || frame.data;
          streamState.text += chunk;
          appendStreamContent(chunk);
          return;
        }
        if (frame.event === "tool_start") updateAgentProgress("Tool started", payload.name || "GitHub tool");
        if (frame.event === "tool_end") updateAgentProgress("Tool completed", payload.name || "GitHub tool", "done");
        if (frame.event === "structured_output") {
          streamState.structuredOutput = payload.payload || null;
          appendActivityEvent("Received oss_repo_management.dashboard.v1", payload.schema_id || "Schema id not provided.", "done");
        }
        if (frame.event === "error") appendActivityEvent("Agent stream error", payload.message || frame.data, "error");
      }

      function appendStreamContent(chunk) {
        document.getElementById("streamedContent").textContent += chunk;
      }

      function publishAssistantContext(reason) {
        if (!window.parent || window.parent === window || !state.dashboard) return;
        const dashboard = state.dashboard;
        const snapshot = {
          assistant: "Repo Report Card Assistant",
          repository: {
            name: dashboard.repo,
            description: dashboard.repository?.description,
            url: dashboard.repository?.htmlUrl,
            defaultBranch: dashboard.repository?.defaultBranch,
            visibility: dashboard.repository?.visibility,
          },
          report: {
            generatedAt: dashboard.generatedAt,
            source: dashboard.source,
            confidence: dashboard.confidence,
            cached: state.reportOrigin === "cached",
            staleThresholdDays: dashboard.provenance?.staleThresholdDays,
          },
          metrics: {
            stars: dashboard.repository?.stars,
            forks: dashboard.repository?.forks,
            watchers: dashboard.repository?.watchers,
            issues: dashboard.issues,
            pullRequests: dashboard.pullRequests,
            contributors: dashboard.community,
          },
          ownership: compactOwnership(dashboard.ownership),
          risks: (dashboard.risks || []).slice(0, 6),
          recommendations: (dashboard.recommendations || []).slice(0, 8),
          maintainerAsks: (dashboard.maintainerAsks || []).slice(0, 6),
          readiness: compactReadiness(dashboard.readiness),
          provenance: dashboard.provenance,
        };
        window.parent.postMessage({
          type: "caipe.agenticApp.context.v1",
          version: "1.0",
          appId: "oss-repo-management",
          context: {
            route: "/apps/oss-repo-management",
            title: "OSS Repo Report Card · " + dashboard.repo,
            summary: dashboard.summary + " Report generated " + (dashboard.generatedAt || "at an unknown time") + ". Context shared because: " + reason + ".",
            selection: JSON.stringify(snapshot),
            resourceRefs: [
              { kind: "repository", id: dashboard.repo },
              { kind: "agent", id: "github-agent" },
              { kind: "schema", id: "oss_repo_management.dashboard.v1" },
            ],
            suggestedPrompts: [
              "Who are the maintainers or CODEOWNERS, and what evidence supports that?",
              "What needs maintainer attention in this report card?",
              "What should we close before release?",
              "Summarize foundation-readiness gaps and recommended actions.",
            ],
          },
        }, "*");
      }

      function downloadMarkdownReport() {
        if (!state.dashboard) return;
        const markdown = buildOssRepoMarkdownReport(state.dashboard, { reportOrigin: state.reportOrigin });
        const blob = new Blob([markdown], { type: "text/markdown;charset=utf-8" });
        const url = URL.createObjectURL(blob);
        const link = document.createElement("a");
        const date = String(state.dashboard.generatedAt || new Date().toISOString()).slice(0, 10);
        const repo = String(state.dashboard.repo || "oss-repo").replace(/[^A-Za-z0-9._-]+/g, "-");
        link.href = url;
        link.download = repo + "-report-card-" + date + ".md";
        link.hidden = true;
        document.body.appendChild(link);
        link.click();
        link.remove();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
        copilotMessage.textContent = "Markdown report downloaded for " + state.dashboard.repo + ".";
      }

      function compactOwnership(ownership) {
        const value = ownership || {};
        return {
          maintainers: {
            status: value.maintainers?.status,
            path: value.maintainers?.path,
            handles: (value.maintainers?.handles || []).slice(0, 20),
            entries: (value.maintainers?.entries || []).slice(0, 8),
          },
          codeowners: {
            status: value.codeowners?.status,
            path: value.codeowners?.path,
            handles: (value.codeowners?.handles || []).slice(0, 20),
            entries: (value.codeowners?.entries || []).slice(0, 8),
          },
          topContributors: (value.topContributors || []).slice(0, 10),
          caveat: value.caveat,
        };
      }

      function compactReadiness(readiness) {
        const value = readiness || {};
        return {
          model: value.model,
          summary: value.summary,
          caveat: value.caveat,
          checks: (value.checks || []).map((check) => ({
            dimension: check.dimension,
            criterion: check.criterion,
            status: check.status,
            evidence: String(check.evidence || "").slice(0, 240),
            source: check.source,
          })),
        };
      }

      function openAssistantChat() {
        publishAssistantContext("open-chat");
        if (!window.parent || window.parent === window) return;
        window.parent.postMessage({
          type: "caipe.agenticApp.assistant.open.v1",
          version: "1.0",
          appId: "oss-repo-management",
        }, "*");
      }

      function persistRun(dashboard) {
        const updatedAt = dashboard.generatedAt || new Date().toISOString();
        const id = dashboard.repo + "::" + updatedAt;
        const run = { id, updatedAt, dashboard };
        state.runs = [run, ...state.runs.filter((item) => item.id !== id)].slice(0, 20);
        try { localStorage.setItem("oss-repo-report-card.cachedReports.v1", JSON.stringify(state.runs)); } catch {}
        renderRunHistory();
      }

      function renderRunHistory() {
        const runHistory = document.getElementById("runHistory");
        runHistory.innerHTML = '<option value="">Cached report cards · ' + state.runs.length + '</option>' + state.runs.map((run) => '<option value="' + escapeAttribute(run.id) + '">' + escapeHtml(run.dashboard?.repo || "repo") + " · " + new Date(run.updatedAt).toLocaleString() + '</option>').join("");
      }

      function loadRunHistory() {
        try {
          const current = JSON.parse(localStorage.getItem("oss-repo-report-card.cachedReports.v1") || "[]");
          if (Array.isArray(current) && current.length) return current.slice(0, 20);
          const legacy = JSON.parse(localStorage.getItem("oss-repo-management.runHistory") || "[]");
          return Array.isArray(legacy) ? legacy.slice(0, 20) : [];
        } catch {
          return [];
        }
      }

      function loadSelectedRun() {
        const id = document.getElementById("runHistory").value;
        const run = state.runs.find((item) => item.id === id);
        if (run?.dashboard) {
          repoInput.value = run.dashboard.repo || repoInput.value;
          applyDashboard(run.dashboard, { persist: false, origin: "cached" });
          copilotMessage.textContent = "Cached report card loaded from " + new Date(run.updatedAt).toLocaleString() + ". Generate a new report card to refresh source data.";
        }
      }

      function toggleFontSettings() {
        const nextOpen = fontCustomizer.hidden;
        fontCustomizer.hidden = !nextOpen;
        settingsToggle.setAttribute("aria-expanded", String(nextOpen));
      }

      function applyFontPreferences(preferences = readFontPreferences()) {
        const families = {
          inter: 'Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
          system: 'ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
          mono: '"SFMono-Regular", Consolas, "Liberation Mono", monospace',
          serif: 'Georgia, "Times New Roman", serif',
        };
        const scales = { small: "0.9", default: "1", large: "1.12", xl: "1.25" };
        const family = families[preferences.family] ? preferences.family : "inter";
        const scale = scales[preferences.scale] ? preferences.scale : "default";
        document.documentElement.style.setProperty("--app-font-family", families[family]);
        document.documentElement.style.setProperty("--app-font-scale", scales[scale]);
        fontFamilySelect.value = family;
        fontScaleSelect.value = scale;
      }

      function readFontPreferences() {
        try { return JSON.parse(localStorage.getItem(fontStorageKey) || "{}"); } catch { return {}; }
      }

      function writeFontPreferences() {
        const preferences = { family: fontFamilySelect.value, scale: fontScaleSelect.value };
        try { localStorage.setItem(fontStorageKey, JSON.stringify(preferences)); } catch {}
        applyFontPreferences(preferences);
      }

      function appUrl(path) {
        const prefix = window.location.pathname.startsWith(basePath + "/") || window.location.pathname === basePath ? basePath : "";
        return prefix + path;
      }

      function parseJson(value) {
        try { return JSON.parse(value || "{}"); } catch { return {}; }
      }

      function escapeHtml(value) {
        return String(value ?? "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);
      }

      function escapeAttribute(value) {
        return escapeHtml(value).replace(/\\n/g, " ");
      }
    </script>
  </body>
</html>`;
}

async function readJsonBody(request) {
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  const raw = Buffer.concat(chunks).toString("utf8");
  return raw ? JSON.parse(raw) : {};
}

function sendJson(response, status, payload) {
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
  });
  response.end(JSON.stringify(payload));
}

function sendHtml(response, html, cacheControl = "no-store") {
  response.writeHead(200, {
    "content-type": "text/html; charset=utf-8",
    "cache-control": cacheControl,
  });
  response.end(html);
}

function normalizeBasePath(value) {
  const normalized = value.startsWith("/") ? value : `/${value}`;
  return normalized.replace(/\/+$/, "") || "/";
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  })[char]);
}
