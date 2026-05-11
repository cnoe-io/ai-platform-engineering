#!/usr/bin/env node
// assisted-by Codex Codex-sonnet-4-6
import { createServer } from "node:http";

import { createAgenticAppJwtVerifier } from "../../_lib/jwt-verify.mjs";

const port = Number(process.env.OSS_REPO_MANAGEMENT_APP_PORT ?? "3040");
const basePath = normalizeBasePath(process.env.OSS_REPO_MANAGEMENT_APP_BASE_PATH ?? "/apps/oss-repo-management");
const defaultGithubAgentId = process.env.OSS_REPO_MANAGEMENT_GITHUB_AGENT_ID ?? "agent-github-agent";
const defaultRepoName = "cnoe-io/ai-platform-engineering";

const verifier =
  process.env.AGENTIC_APP_OSS_REPO_MANAGEMENT_JWT_DISABLED === "true"
    ? null
    : createAgenticAppJwtVerifier({ appId: "oss-repo-management" });

const server = createServer(async (request, response) => {
  const url = new URL(request.url ?? "/", `http://${request.headers.host ?? "localhost"}`);

  if (url.pathname === "/healthz") {
    sendJson(response, 200, {
      ok: true,
      app: "oss-repo-management",
      runtime: "separate-process",
      agent: defaultGithubAgentId,
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

  if (url.pathname === "/api/summary") {
    const repo = url.searchParams.get("repo") || defaultRepoName;
    sendJson(response, 200, buildAgentUnavailableRepoSummary(repo, "Waiting for CAIPE GitHub agent structured output"));
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

  if (url.pathname === "/embed") {
    sendHtml(response, renderDashboard({ compact: true }));
    return;
  }

  if (url.pathname === "/" || url.pathname === "/dashboard") {
    sendHtml(response, renderDashboard({ compact: false }));
    return;
  }

  sendJson(response, 404, { error: "not_found" });
});

server.listen(port, () => {
  console.log(`OSS Repo Management listening on http://localhost:${port}`);
  console.log(`Configure CAIPE with AGENTIC_APP_OSS_REPO_MANAGEMENT_ORIGIN=http://localhost:${port}`);
});

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
      open: 0,
      stale: 0,
      p0: 0,
      needsTriage: 0,
    },
    pullRequests: {
      open: 0,
      awaitingReview: 0,
      blocked: 0,
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
      status: "ready",
    },
  };
}

function renderDashboard({ compact }) {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>OSS Repo Management</title>
    <style>
      :root {
        color-scheme: dark;
        --app-font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        --app-font-scale: 0.8;
        font-size: calc(14px * var(--app-font-scale));
        font-family: var(--app-font-family);
        background: #020617;
        color: #e2e8f0;
      }
      * { box-sizing: border-box; }
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
      .eyebrow { display: inline-flex; gap: 7px; align-items: center; color: #86efac; letter-spacing: 0.22em; font-size: 0.64rem; font-weight: 800; text-transform: uppercase; margin: 0; }
      .pulse { display: inline-block; width: 8px; height: 8px; border-radius: 999px; background: #22c55e; box-shadow: 0 0 0 6px rgba(34, 197, 94, 0.12); }
      h1 { margin: 0; font-size: 1.28rem; line-height: 1.15; letter-spacing: -0.025em; font-weight: 800; }
      h2 { margin: 0 0 8px; font-size: 0.78rem; font-weight: 800; letter-spacing: 0.14em; text-transform: uppercase; color: #94a3b8; }
      .subtitle { color: #94a3b8; line-height: 1.4; font-size: 0.78rem; max-width: 720px; }
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
      .controls input, .controls select { padding: 6px 10px; font-size: 0.78rem; }
      .controls button { padding: 6px 12px; font-size: 0.78rem; }
      input { min-width: 180px; }
      textarea { border-radius: 10px; min-height: 76px; width: 100%; resize: vertical; line-height: 1.45; }
      button { cursor: pointer; border: 0; font-weight: 700; background: linear-gradient(135deg, #22c55e, #0ea5e9); color: white; }
      button.ghost { background: rgba(2, 6, 23, 0.72); border: 1px solid rgba(255,255,255,0.12); font-weight: 600; }
      button:disabled { opacity: 0.6; cursor: wait; }
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
        font-size: 0.64rem;
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
      .kpi .kpi-sub { color: #94a3b8; font-size: 0.72rem; font-weight: 600; }
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
        font-size: 0.78rem;
      }
      .repo-health-card strong, .action-card strong { color: #f8fafc; font-size: 0.86rem; font-weight: 700; display: block; margin-top: 2px; }
      .repo-health-card p, .action-card p { margin: 4px 0 0; color: #cbd5e1; line-height: 1.45; }
      .label { color: #94a3b8; font-size: 0.64rem; font-weight: 700; letter-spacing: 0.12em; text-transform: uppercase; }
      .action-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px; }
      .severity-high { color: #fca5a5; }
      .severity-medium { color: #fde68a; }
      .maintainer-ask { border-left: 3px solid #22c55e; }
      .message { margin-top: 8px; border-radius: 10px; padding: 10px 12px; background: rgba(2,6,23,0.45); border: 1px solid rgba(255,255,255,0.07); color: #cbd5e1; line-height: 1.5; white-space: pre-wrap; font-size: 0.78rem; }
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
      @media (max-width: 1100px) {
        .kpi-strip { grid-template-columns: repeat(3, minmax(0, 1fr)); }
      }
      @media (max-width: 760px) {
        .shell, .activity-drawer-body { grid-template-columns: 1fr; }
        .kpi-strip { grid-template-columns: repeat(2, minmax(0, 1fr)); }
        .action-grid { grid-template-columns: 1fr; }
        .assistant { position: static; }
        .font-customizer { position: static; margin: 12px 0 0; }
      }
    </style>
  </head>
  <body>
    <main>
      <section class="hero">
        <div class="hero-row">
          <div class="hero-title">
            <p class="eyebrow"><span class="pulse"></span>OSS Repo Management • GitHub Issues • Maintainer Intelligence</p>
            <h1>OSS Repo Management</h1>
            <p class="subtitle">Give the repo name as <strong>owner/repo</strong> to see project health, stale issues, PR queue, maintainer asks, risks, and recommended next actions.</p>
          </div>
          <div class="controls">
            <input id="repoInput" value="${defaultRepoName}" aria-label="Repository owner/repo" placeholder="owner/repo" />
            <select id="dashboardKind" aria-label="Dashboard kind">
              <option value="repo-health">Repo health</option>
              <option value="issue-triage">Issue triage</option>
              <option value="release-readiness">Release readiness</option>
            </select>
            <button id="runAnalysis">Run analysis</button>
          </div>
        </div>
        <div class="run-history">
          <select id="runHistory" aria-label="Previous OSS repo runs"><option value="">No previous runs loaded yet</option></select>
        </div>
      </section>

      <button class="settings-fab" id="settingsToggle" type="button" aria-expanded="false" aria-controls="fontCustomizer">Settings</button>
      <div class="font-customizer font-dock" id="fontCustomizer" aria-label="Font customization" hidden>
        <span class="font-dock-title">View settings</span>
        <label>Font <select id="fontFamilySelect" aria-label="Font family"><option value="inter">Inter</option><option value="system">System</option><option value="mono">Mono</option><option value="serif">Serif</option></select></label>
        <label>Size <select id="fontScaleSelect" aria-label="Text size"><option value="small">Small</option><option value="default">Default</option><option value="large">Large</option><option value="xl">XL</option></select></label>
      </div>

      <div class="panel">
        <h2>Repository health</h2>
        <div class="kpi-strip" id="summaryCards"></div>
        <div class="insights-strip" id="insightsStrip" hidden></div>
      </div>

      <div class="shell">
        <section>
          <div class="panel">
            <h2>Maintainer Action Cards</h2>
            <div class="action-grid" id="actionCards"></div>
          </div>
        </section>
        <aside class="assistant">
          <p class="eyebrow">Agent Conversation</p>
          <h2>Repo Assistant</h2>
          <p class="subtitle">Ask about stale issues, P0s, PR review queues, release readiness, or maintainer next actions.</p>
          <input id="githubAgentId" aria-label="GitHub agent id" value="${escapeHtml(defaultGithubAgentId)}" style="width: 100%; margin: 8px 0;" />
          <textarea id="questionInput" aria-label="Repository question" placeholder="Ask: what needs maintainer attention in this repo?"></textarea>
          <button id="askRepoCopilot" style="margin-top: 8px;">Ask Repo Assistant</button>
          <button id="openAssistantChat" class="ghost" type="button">Open Ask Repo Chat</button>
          <div class="message" id="copilotMessage">Repo assistant is ready.</div>
        </aside>
      </div>

      <footer class="activity-footer" id="activityFooter">
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
    <script>
      const basePath = ${JSON.stringify(basePath)};
      const state = { dashboard: null, activityEventCount: 0, runs: loadRunHistory() };
      const fontStorageKey = "agentic-app.fontPreferences";
      const repoInput = document.getElementById("repoInput");
      const dashboardKind = document.getElementById("dashboardKind");
      const questionInput = document.getElementById("questionInput");
      const copilotMessage = document.getElementById("copilotMessage");
      const settingsToggle = document.getElementById("settingsToggle");
      const fontCustomizer = document.getElementById("fontCustomizer");
      const fontFamilySelect = document.getElementById("fontFamilySelect");
      const fontScaleSelect = document.getElementById("fontScaleSelect");

      document.getElementById("runAnalysis").addEventListener("click", () => runRepoAgent(""));
      document.getElementById("askRepoCopilot").addEventListener("click", () => runRepoAgent(questionInput.value.trim()));
      document.getElementById("openAssistantChat").addEventListener("click", openAssistantChat);
      document.getElementById("runHistory").addEventListener("change", loadSelectedRun);
      settingsToggle.addEventListener("click", toggleFontSettings);
      fontFamilySelect.addEventListener("change", writeFontPreferences);
      fontScaleSelect.addEventListener("change", writeFontPreferences);

      applyFontPreferences();
      renderRunHistory();
      loadLocalSummary();

      async function loadLocalSummary() {
        const response = await fetch(appUrl("/api/summary?repo=" + encodeURIComponent(repoInput.value)), { headers: { accept: "application/json" } });
        applyDashboard(await response.json());
      }

      async function runRepoAgent(question) {
        const githubAgentId = document.getElementById("githubAgentId").value.trim() || ${JSON.stringify(defaultGithubAgentId)};
        const repo = repoInput.value.trim() || "owner/repo";
        const kind = dashboardKind.value || "repo-health";
        initializeActivityFeed();
        setRunButtonBusy(true);
        copilotMessage.textContent = "Streaming GitHub repository analysis...";
        const prompt = [
          "Build an OSS Repo Management dashboard for repository " + repo + " with dashboard kind " + kind + ".",
          question ? "User question: " + question + "." : "User question: summarize repository health and maintainer next actions.",
          "Use GitHub issue and pull request context through the configured CAIPE GitHub agent.",
          "Use submit_structured_response with the requested oss_repo_management.dashboard.v1 schema before the final explanation.",
          "Render repo-health-card, maintainer-ask, risks, recommendations, confidence, issue counts, and pull request counts.",
          "Do not invent issue IDs, PRs, or owners. If agent data is unavailable, explain what configuration is missing."
        ].join(" ");
        try {
          updateAgentProgress("Opening live CAIPE stream", "GitHub: " + githubAgentId + " • Repo: " + repo);
          const response = await fetch("/api/v1/chat/stream/start", {
            method: "POST",
            headers: { "content-type": "application/json", accept: "text/event-stream" },
            body: JSON.stringify({
              agent_id: githubAgentId,
              message: prompt,
              conversation_id: "oss-repo-management-" + Date.now(),
              protocol: "custom",
              client_context: {
                source: "agentic-app",
                appId: "oss-repo-management",
                repo,
                dashboardKind: kind,
                question,
                response_format: ${JSON.stringify(buildOssRepoManagementDashboardResponseFormat())},
              },
            }),
          });
          if (!response.ok || !response.body) throw new Error("stream unavailable");
          const streamed = await consumeAgentStream(response);
          if (streamed.structuredOutput) {
            applyDashboard(normalizeDashboard(streamed.structuredOutput, repo));
            copilotMessage.textContent = streamed.text || "Repository agent finished.";
            setRunStatus("done", "Complete");
          } else {
            updateAgentProgress("No structured output", "The GitHub agent stream completed without oss_repo_management.dashboard.v1.", "error");
            const local = await fetch(appUrl("/api/copilotkit/repo-agent"), {
              method: "POST",
              headers: { "content-type": "application/json", accept: "application/json" },
              body: JSON.stringify({ repo, dashboardKind: kind, question }),
            });
            const result = await local.json();
            applyDashboard(result.dashboard);
            copilotMessage.textContent = result.message;
            setRunStatus("error", "Agent output missing");
          }
        } catch (error) {
          updateAgentProgress("GitHub agent stream unavailable", error instanceof Error ? error.message : "Stream unavailable", "error");
          const local = await fetch(appUrl("/api/copilotkit/repo-agent"), {
            method: "POST",
            headers: { "content-type": "application/json", accept: "application/json" },
            body: JSON.stringify({ repo, dashboardKind: kind, question }),
          });
          const result = await local.json();
          applyDashboard(result.dashboard);
          copilotMessage.textContent = result.message;
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

      function applyDashboard(dashboard) {
        state.dashboard = normalizeDashboard(dashboard, repoInput.value);
        renderSummaryCards(state.dashboard);
        renderInsights(state.dashboard);
        renderActionCards(state.dashboard);
        persistRun(state.dashboard);
        publishAssistantContext("dashboard");
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
        };
      }

      function renderSummaryCards(dashboard) {
        const repo = dashboard.repo || "owner/repo";
        const openIssues = dashboard.issues.open ?? 0;
        const stale = dashboard.issues.stale ?? 0;
        const p0 = dashboard.issues.p0 ?? 0;
        const needsTriage = dashboard.issues.needsTriage ?? 0;
        const openPRs = dashboard.pullRequests.open ?? 0;
        const awaitingReview = dashboard.pullRequests.awaitingReview ?? 0;
        const blockedPRs = dashboard.pullRequests.blocked ?? 0;
        const confidence = dashboard.confidence || "unknown";

        const stalePct = openIssues > 0 ? Math.round((stale / openIssues) * 100) : 0;
        const reviewPct = openPRs > 0 ? Math.round((awaitingReview / openPRs) * 100) : 0;
        const flowAccent = blockedPRs > 0 ? "warn" : awaitingReview > 0 ? "attention" : "good";
        const triageAccent = p0 > 0 ? "danger" : needsTriage > 0 ? "warn" : "good";
        const staleAccent = stalePct >= 40 ? "warn" : stalePct >= 20 ? "attention" : "good";

        document.getElementById("summaryCards").innerHTML = [
          kpiTile({
            label: "Repository",
            value: repo,
            sub: "Confidence: " + escapeHtml(confidence),
            accent: "attention",
            valueClass: "kpi-repo",
          }),
          kpiTile({
            label: "Open issues",
            value: formatCount(openIssues),
            sub: needsTriage ? formatCount(needsTriage) + " need triage" : "All triaged",
            accent: triageAccent,
          }),
          kpiTile({
            label: "P0 / Critical",
            value: formatCount(p0),
            sub: p0 ? "Immediate attention" : "None reported",
            accent: p0 ? "danger" : "good",
          }),
          kpiTile({
            label: "Stale issues",
            value: formatCount(stale),
            sub: openIssues ? stalePct + "% of open" : "No open issues",
            accent: staleAccent,
          }),
          kpiTile({
            label: "Open PRs",
            value: formatCount(openPRs),
            sub: blockedPRs ? formatCount(blockedPRs) + " blocked" : "Flow looks clean",
            accent: flowAccent,
          }),
          kpiTile({
            label: "Awaiting review",
            value: formatCount(awaitingReview),
            sub: openPRs ? reviewPct + "% of open PRs" : "No PRs open",
            accent: awaitingReview ? "attention" : "good",
            bar: openPRs ? reviewPct : null,
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
          insights.push({ icon: "👀", title: formatCount(awaitingReview) + " PRs awaiting review", sub: "Reviewer load is high" });
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
        button.textContent = isBusy ? "Running GitHub repo analysis..." : "Run GitHub repo analysis";
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
        window.parent.postMessage({
          type: "caipe.agenticApp.context.v1",
          appId: "oss-repo-management",
          reason,
          context: state.dashboard,
          resourceRefs: [{ kind: "agent", id: "github-agent" }, { kind: "schema", id: "oss_repo_management.dashboard.v1" }],
          suggestedPrompts: ["What needs maintainer attention?", "What should we close before release?"],
        }, "*");
      }

      function openAssistantChat() {
        publishAssistantContext("open-chat");
        if (!window.parent || window.parent === window) return;
        window.parent.postMessage({ type: "caipe.agenticApp.assistant.open.v1", appId: "oss-repo-management" }, "*");
      }

      function persistRun(dashboard) {
        const run = { id: String(Date.now()), updatedAt: new Date().toISOString(), dashboard };
        state.runs = [run, ...state.runs.filter((item) => item.dashboard?.repo !== dashboard.repo)].slice(0, 8);
        try { localStorage.setItem("oss-repo-management.runHistory", JSON.stringify(state.runs)); } catch {}
        renderRunHistory();
      }

      function renderRunHistory() {
        const runHistory = document.getElementById("runHistory");
        runHistory.innerHTML = '<option value="">Previous repo runs</option>' + state.runs.map((run) => '<option value="' + escapeAttribute(run.id) + '">' + escapeHtml(run.dashboard?.repo || "repo") + " • " + new Date(run.updatedAt).toLocaleString() + '</option>').join("");
      }

      function loadRunHistory() {
        try {
          const parsed = JSON.parse(localStorage.getItem("oss-repo-management.runHistory") || "[]");
          return Array.isArray(parsed) ? parsed : [];
        } catch {
          return [];
        }
      }

      function loadSelectedRun() {
        const id = document.getElementById("runHistory").value;
        const run = state.runs.find((item) => item.id === id);
        if (run?.dashboard) applyDashboard(run.dashboard);
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
        const scales = { small: "0.9", default: "1", large: "1.08", xl: "1.16" };
        const family = families[preferences.family] ? preferences.family : "inter";
        const scale = scales[preferences.scale] ? preferences.scale : "small";
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

function normalizeRepoName(repoName) {
  const value = String(repoName || "").trim();
  return value.includes("/") ? value : `owner/${value || "repo"}`;
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

function sendHtml(response, html) {
  response.writeHead(200, {
    "content-type": "text/html; charset=utf-8",
    "cache-control": "no-store",
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
