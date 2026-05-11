#!/usr/bin/env node
// assisted-by Codex Codex-sonnet-4-6
import { createServer } from "node:http";

import { createAgenticAppJwtVerifier } from "../../_lib/jwt-verify.mjs";

const port = Number(process.env.JIRA_PROJECT_DASHBOARD_APP_PORT ?? "3041");
const basePath = normalizeBasePath(process.env.JIRA_PROJECT_DASHBOARD_APP_BASE_PATH ?? "/apps/jira-project-dashboard");
const defaultJiraAgentId = process.env.JIRA_PROJECT_DASHBOARD_JIRA_AGENT_ID ?? "agent-jira-agent";

const verifier =
  process.env.AGENTIC_APP_JIRA_PROJECT_DASHBOARD_JWT_DISABLED === "true"
    ? null
    : createAgenticAppJwtVerifier({ appId: "jira-project-dashboard" });

const server = createServer(async (request, response) => {
  const url = new URL(request.url ?? "/", `http://${request.headers.host ?? "localhost"}`);

  if (url.pathname === "/healthz") {
    sendJson(response, 200, {
      ok: true,
      app: "jira-project-dashboard",
      runtime: "separate-process",
      agent: defaultJiraAgentId,
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
    const project = url.searchParams.get("project") || "SRE";
    sendJson(response, 200, buildAgentUnavailableJiraSummary(project, "Waiting for CAIPE Jira agent structured output"));
    return;
  }

  if (url.pathname === "/api/copilotkit/jira-agent" && request.method === "POST") {
    try {
      const body = await readJsonBody(request);
      sendJson(response, 200, await buildLocalJiraAgentResponse(body));
    } catch (error) {
      sendJson(response, 400, {
        error: "invalid_jira_agent_request",
        message: error instanceof Error ? error.message : "Could not run Jira agent",
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
  console.log(`Jira Project Dashboard listening on http://localhost:${port}`);
  console.log(`Configure CAIPE with AGENTIC_APP_JIRA_PROJECT_DASHBOARD_ORIGIN=http://localhost:${port}`);
});

function buildJiraProjectDashboardResponseFormat() {
  return {
    type: "json_schema",
    schema_id: "jira_project.dashboard.v1",
    schema: {
      type: "object",
      required: ["summary", "confidence", "project", "sprint", "issues", "blockers", "risks", "recommendations", "actionAsks"],
      properties: {
        summary: { type: "string" },
        confidence: { type: "string" },
        project: { type: "string" },
        sprint: { type: "object" },
        issues: { type: "object" },
        blockers: { type: "array" },
        risks: { type: "array" },
        recommendations: { type: "array" },
        actionAsks: { type: "array" },
      },
    },
  };
}

function buildAgentUnavailableJiraSummary(projectName, reason = "No Jira structured output received from the CAIPE Jira agent") {
  const project = normalizeProjectKey(projectName);
  return {
    source: "agent-unavailable",
    generatedAt: new Date().toISOString(),
    reason,
    project,
    summary: `No Jira structured output received from the CAIPE Jira agent for ${project}.`,
    confidence: "none",
    sprint: {
      name: `${project} agent output pending`,
      committed: 0,
      completed: 0,
      atRisk: 0,
    },
    issues: {
      open: 0,
      blockers: 0,
      unassigned: 0,
      overdue: 0,
    },
    blockers: [],
    risks: [
      {
        severity: "medium",
        title: "Jira agent structured output is unavailable",
        rationale: reason,
      },
    ],
    recommendations: [
      "Verify the CAIPE Jira agent is reachable and has the structured response middleware enabled.",
      "Confirm the agent prompt requests jira_project.dashboard.v1 before the final answer.",
    ],
    actionAsks: [
      {
        title: "Restore agent structured output",
        detail: "The embedded app will render Jira data only after the CAIPE Jira agent emits jira_project.dashboard.v1.",
        priority: "high",
      },
    ],
  };
}

function buildLocalJiraAgentResponse(body) {
  const dashboard = buildAgentUnavailableJiraSummary(body?.project || "SRE");
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
      actionName: "renderJiraProjectInsight",
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
    <title>Jira Project Dashboard</title>
    <style>
      :root {
        color-scheme: dark;
        --app-font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        --app-font-scale: 0.8;
        font-size: calc(16px * var(--app-font-scale));
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
          radial-gradient(circle at 12% 10%, rgba(168, 85, 247, 0.18), transparent 28rem),
          radial-gradient(circle at 84% 18%, rgba(14, 165, 233, 0.14), transparent 30rem),
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
      .eyebrow { display: inline-flex; gap: 7px; align-items: center; color: #c4b5fd; letter-spacing: 0.22em; font-size: 0.64rem; font-weight: 800; text-transform: uppercase; margin: 0; }
      .pulse { display: inline-block; width: 8px; height: 8px; border-radius: 999px; background: #a855f7; box-shadow: 0 0 0 6px rgba(168, 85, 247, 0.12); }
      h1 { margin: 0; font-size: 1.28rem; line-height: 1.15; letter-spacing: -0.025em; font-weight: 800; }
      h2 { margin: 0 0 8px; font-size: 0.78rem; font-weight: 800; letter-spacing: 0.14em; text-transform: uppercase; color: #94a3b8; }
      .subtitle { color: #94a3b8; line-height: 1.4; font-size: 0.78rem; max-width: 720px; }
      .controls { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; }
      .run-history { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 6px; align-items: center; margin-top: 8px; }
      .run-history select { width: 100%; padding: 6px 10px; font-size: 0.78rem; }
      .settings-fab { position: fixed; left: 18px; bottom: 24px; z-index: 31; display: inline-flex; align-items: center; gap: 7px; padding: 10px 13px; border: 1px solid rgba(125, 211, 252, 0.4); border-radius: 999px; background: rgba(2, 6, 23, 0.9); box-shadow: 0 18px 50px rgba(2, 6, 23, 0.34); color: #e0f2fe; font-size: 0.86rem; font-weight: 1000; letter-spacing: 0.08em; text-transform: uppercase; backdrop-filter: blur(18px); }
      .settings-fab:hover { border-color: rgba(125, 211, 252, 0.75); background: rgba(14, 165, 233, 0.18); }
      .font-customizer { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; position: fixed; left: 18px; bottom: 74px; z-index: 30; max-width: calc(100vw - 36px); padding: 8px 10px; border: 1px solid rgba(255,255,255,0.12); border-radius: 18px; background: rgba(2, 6, 23, 0.88); box-shadow: 0 18px 50px rgba(2, 6, 23, 0.34); backdrop-filter: blur(18px); font-size: 0.78rem; line-height: 1; }
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
      button { cursor: pointer; border: 0; font-weight: 700; background: linear-gradient(135deg, #a855f7, #0ea5e9); color: white; }
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
      .progress-fill { height: 100%; background: linear-gradient(90deg, #a855f7, #38bdf8); }
      .sprint-health-card, .action-card {
        border: 1px solid rgba(255,255,255,0.08);
        border-radius: 10px;
        padding: 10px 12px;
        background: rgba(2, 6, 23, 0.45);
        font-size: 0.78rem;
      }
      .sprint-health-card strong, .action-card strong { color: #f8fafc; font-size: 0.86rem; font-weight: 700; display: block; margin-top: 2px; }
      .sprint-health-card p, .action-card p { margin: 4px 0 0; color: #cbd5e1; line-height: 1.45; }
      .label { color: #94a3b8; font-size: 0.64rem; font-weight: 700; letter-spacing: 0.12em; text-transform: uppercase; }
      .action-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px; }
      .severity-high { color: #fca5a5; }
      .severity-medium { color: #fde68a; }
      .blocker-analysis { border-left: 3px solid #a855f7; }
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
            <p class="eyebrow"><span class="pulse"></span>Jira Project Dashboard • Sprint Health • Blocker Analysis</p>
            <h1>Jira Project Dashboard</h1>
            <p class="subtitle">Give the <strong>Jira project key</strong> or project name to see sprint health, blockers, at-risk work, owner asks, and recommended next actions.</p>
          </div>
          <div class="controls">
            <input id="jiraProjectInput" value="SRE" aria-label="Jira project key" placeholder="Jira project key" />
            <select id="dashboardKind" aria-label="Dashboard kind">
              <option value="sprint-health">Sprint health</option>
              <option value="blocker-analysis">Blocker analysis</option>
              <option value="release-readiness">Release readiness</option>
            </select>
            <button id="runAnalysis">Run analysis</button>
          </div>
        </div>
        <div class="run-history">
          <select id="runHistory" aria-label="Previous Jira project runs"><option value="">No previous runs loaded yet</option></select>
        </div>
      </section>

      <button class="settings-fab" id="settingsToggle" type="button" aria-expanded="false" aria-controls="fontCustomizer">Settings</button>
      <div class="font-customizer font-dock" id="fontCustomizer" aria-label="Font customization" hidden>
        <span class="font-dock-title">View settings</span>
        <label>Font <select id="fontFamilySelect" aria-label="Font family"><option value="inter">Inter</option><option value="system">System</option><option value="mono">Mono</option><option value="serif">Serif</option></select></label>
        <label>Size <select id="fontScaleSelect" aria-label="Text size"><option value="small">Small</option><option value="default">Default</option><option value="large">Large</option><option value="xl">XL</option></select></label>
      </div>

      <div class="panel">
        <h2>Sprint health</h2>
        <div class="kpi-strip" id="summaryCards"></div>
        <div class="insights-strip" id="insightsStrip" hidden></div>
      </div>

      <div class="shell">
        <section>
          <div class="panel">
            <h2>Project Risk Cards</h2>
            <div class="action-grid" id="actionCards"></div>
          </div>
        </section>
        <aside class="assistant">
          <p class="eyebrow">Agent Conversation</p>
          <h2>Jira Assistant</h2>
          <p class="subtitle">Ask about blockers, sprint scope, overdue work, at-risk stories, or release readiness.</p>
          <input id="jiraAgentId" aria-label="Jira agent id" value="${escapeHtml(defaultJiraAgentId)}" style="width: 100%; margin: 8px 0;" />
          <textarea id="questionInput" aria-label="Jira question" placeholder="Ask: what is blocking this Jira project?"></textarea>
          <button id="askJiraCopilot" style="margin-top: 8px;">Ask Jira Assistant</button>
          <button id="openAssistantChat" class="ghost" type="button">Open Ask Jira Ops Chat</button>
          <div class="message" id="copilotMessage">Jira assistant is ready.</div>
        </aside>
      </div>

      <footer class="activity-footer" id="activityFooter">
        <details id="activityDrawer">
          <summary>
            <span class="run-status" id="runStatus"><span class="status-dot"></span>Ready</span>
            <span class="activity-summary" id="activitySummary">Agent activity appears here during a live Jira run.</span>
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
      const jiraProjectInput = document.getElementById("jiraProjectInput");
      const dashboardKind = document.getElementById("dashboardKind");
      const questionInput = document.getElementById("questionInput");
      const copilotMessage = document.getElementById("copilotMessage");
      const settingsToggle = document.getElementById("settingsToggle");
      const fontCustomizer = document.getElementById("fontCustomizer");
      const fontFamilySelect = document.getElementById("fontFamilySelect");
      const fontScaleSelect = document.getElementById("fontScaleSelect");

      document.getElementById("runAnalysis").addEventListener("click", () => runJiraAgent(""));
      document.getElementById("askJiraCopilot").addEventListener("click", () => runJiraAgent(questionInput.value.trim()));
      document.getElementById("openAssistantChat").addEventListener("click", openAssistantChat);
      document.getElementById("runHistory").addEventListener("change", loadSelectedRun);
      settingsToggle.addEventListener("click", toggleFontSettings);
      fontFamilySelect.addEventListener("change", writeFontPreferences);
      fontScaleSelect.addEventListener("change", writeFontPreferences);

      applyFontPreferences();
      renderRunHistory();
      loadLocalSummary();

      async function loadLocalSummary() {
        const response = await fetch(appUrl("/api/summary?project=" + encodeURIComponent(jiraProjectInput.value)), { headers: { accept: "application/json" } });
        applyDashboard(await response.json());
      }

      async function runJiraAgent(question) {
        const jiraAgentId = document.getElementById("jiraAgentId").value.trim() || ${JSON.stringify(defaultJiraAgentId)};
        const project = jiraProjectInput.value.trim() || "Jira project key";
        const kind = dashboardKind.value || "sprint-health";
        initializeActivityFeed();
        setRunButtonBusy(true);
        copilotMessage.textContent = "Streaming Jira project analysis...";
        const prompt = [
          "Build a Jira Project Dashboard for project " + project + " with dashboard kind " + kind + ".",
          question ? "User question: " + question + "." : "User question: summarize sprint health, blockers, and owner asks.",
          "Use Jira issue context through the configured CAIPE Jira agent.",
          "Use submit_structured_response with the requested jira_project.dashboard.v1 schema before the final explanation.",
          "Render sprint-health-card, blocker-analysis, risks, recommendations, action asks, confidence, and Jira issue counts.",
          "Do not invent Jira issue IDs or owners. If agent data is unavailable, explain what configuration is missing."
        ].join(" ");
        try {
          updateAgentProgress("Opening live CAIPE stream", "Jira: " + jiraAgentId + " • Project: " + project);
          const response = await fetch("/api/v1/chat/stream/start", {
            method: "POST",
            headers: { "content-type": "application/json", accept: "text/event-stream" },
            body: JSON.stringify({
              agent_id: jiraAgentId,
              message: prompt,
              conversation_id: "jira-project-dashboard-" + Date.now(),
              protocol: "custom",
              client_context: {
                source: "agentic-app",
                appId: "jira-project-dashboard",
                project,
                dashboardKind: kind,
                question,
                response_format: ${JSON.stringify(buildJiraProjectDashboardResponseFormat())},
              },
            }),
          });
          if (!response.ok || !response.body) throw new Error("stream unavailable");
          const streamed = await consumeAgentStream(response);
          if (streamed.structuredOutput) {
            applyDashboard(normalizeDashboard(streamed.structuredOutput, project));
            copilotMessage.textContent = streamed.text || "Jira agent finished.";
            setRunStatus("done", "Complete");
          } else {
            updateAgentProgress("No structured output", "The Jira agent stream completed without jira_project.dashboard.v1.", "error");
            const local = await fetch(appUrl("/api/copilotkit/jira-agent"), {
              method: "POST",
              headers: { "content-type": "application/json", accept: "application/json" },
              body: JSON.stringify({ project, dashboardKind: kind, question }),
            });
            const result = await local.json();
            applyDashboard(result.dashboard);
            copilotMessage.textContent = result.message;
            setRunStatus("error", "Agent output missing");
          }
        } catch (error) {
          updateAgentProgress("Jira agent stream unavailable", error instanceof Error ? error.message : "Stream unavailable", "error");
          const local = await fetch(appUrl("/api/copilotkit/jira-agent"), {
            method: "POST",
            headers: { "content-type": "application/json", accept: "application/json" },
            body: JSON.stringify({ project, dashboardKind: kind, question }),
          });
          const result = await local.json();
          applyDashboard(result.dashboard);
          copilotMessage.textContent = result.message;
          updateAgentProgress(
            "Agent structured output required",
            result.dashboard?.reason || result.dashboard?.summary || "Jira data requires the CAIPE Jira agent.",
            "error",
          );
          setRunStatus("error", "Agent unavailable");
        } finally {
          setRunButtonBusy(false);
        }
      }

      function applyDashboard(dashboard) {
        state.dashboard = normalizeDashboard(dashboard, jiraProjectInput.value);
        renderSummaryCards(state.dashboard);
        renderInsights(state.dashboard);
        renderActionCards(state.dashboard);
        persistRun(state.dashboard);
        publishAssistantContext("dashboard");
      }

      function normalizeDashboard(dashboard, fallbackProject) {
        return {
          ...dashboard,
          project: dashboard?.project || fallbackProject || "SRE",
          sprint: dashboard?.sprint || {},
          issues: dashboard?.issues || {},
          blockers: Array.isArray(dashboard?.blockers) ? dashboard.blockers : [],
          risks: Array.isArray(dashboard?.risks) ? dashboard.risks : [],
          recommendations: Array.isArray(dashboard?.recommendations) ? dashboard.recommendations : [],
          actionAsks: Array.isArray(dashboard?.actionAsks) ? dashboard.actionAsks : [],
        };
      }

      function renderSummaryCards(dashboard) {
        const project = dashboard.project || "PROJECT";
        const sprintName = dashboard.sprint.name || "Current sprint";
        const committed = Number(dashboard.sprint.committed ?? 0);
        const completed = Number(dashboard.sprint.completed ?? 0);
        const atRisk = Number(dashboard.sprint.atRisk ?? 0);
        const blockers = Number(dashboard.issues.blockers ?? 0);
        const overdue = Number(dashboard.issues.overdue ?? 0);
        const unassigned = Number(dashboard.issues.unassigned ?? 0);
        const openIssues = Number(dashboard.issues.open ?? 0);
        const confidence = dashboard.confidence || "unknown";

        const progressPct = committed > 0 ? Math.round((completed / committed) * 100) : 0;
        const completedAccent = progressPct >= 80 ? "good" : progressPct >= 50 ? "attention" : progressPct >= 25 ? "warn" : "danger";
        const riskAccent = atRisk >= 5 ? "danger" : atRisk > 0 ? "warn" : "good";
        const blockerAccent = blockers >= 3 ? "danger" : blockers > 0 ? "warn" : "good";

        document.getElementById("summaryCards").innerHTML = [
          kpiTile({
            label: "Project • Sprint",
            value: project,
            sub: sprintName + " • " + escapeHtml(confidence),
            accent: "attention",
            valueClass: "kpi-project",
          }),
          kpiTile({
            label: "Sprint progress",
            value: progressPct + "%",
            sub: formatCount(completed) + " of " + formatCount(committed) + " done",
            accent: completedAccent,
            bar: progressPct,
          }),
          kpiTile({
            label: "At risk",
            value: formatCount(atRisk),
            sub: atRisk ? "Stories may slip" : "Sprint on track",
            accent: riskAccent,
          }),
          kpiTile({
            label: "Blockers",
            value: formatCount(blockers),
            sub: blockers ? "Unblock to keep flow" : "No active blockers",
            accent: blockerAccent,
          }),
          kpiTile({
            label: "Overdue",
            value: formatCount(overdue),
            sub: overdue ? "Past due date" : "Nothing overdue",
            accent: overdue ? "warn" : "good",
          }),
          kpiTile({
            label: "Unassigned",
            value: formatCount(unassigned),
            sub: openIssues ? formatCount(openIssues) + " open issues" : "All assigned",
            accent: unassigned ? "attention" : "good",
          }),
        ].join("");

        const projectLabel = document.querySelector(".kpi-project");
        if (projectLabel) {
          projectLabel.style.fontSize = "1.05rem";
          projectLabel.style.overflow = "hidden";
          projectLabel.style.textOverflow = "ellipsis";
          projectLabel.style.whiteSpace = "nowrap";
        }
      }

      function renderInsights(dashboard) {
        const strip = document.getElementById("insightsStrip");
        const insights = [];
        const committed = Number(dashboard.sprint.committed ?? 0);
        const completed = Number(dashboard.sprint.completed ?? 0);
        const atRisk = Number(dashboard.sprint.atRisk ?? 0);
        const blockers = Number(dashboard.issues.blockers ?? 0);
        const overdue = Number(dashboard.issues.overdue ?? 0);
        const unassigned = Number(dashboard.issues.unassigned ?? 0);
        const progressPct = committed > 0 ? Math.round((completed / committed) * 100) : 0;

        if (blockers > 0) {
          insights.push({ icon: "🚧", title: formatCount(blockers) + " active blocker" + (blockers === 1 ? "" : "s"), sub: "Resolve to keep sprint on track" });
        }
        if (atRisk > 0 && committed > 0 && atRisk / committed >= 0.2) {
          insights.push({ icon: "⚠️", title: Math.round((atRisk / committed) * 100) + "% of scope at risk", sub: "Consider de-scoping or re-prioritizing" });
        }
        if (committed > 0 && progressPct < 40) {
          insights.push({ icon: "⏳", title: "Sprint progress only " + progressPct + "%", sub: "Velocity is behind plan" });
        }
        if (overdue > 0) {
          insights.push({ icon: "📅", title: formatCount(overdue) + " overdue issue" + (overdue === 1 ? "" : "s"), sub: "Review due dates" });
        }
        if (unassigned >= 5) {
          insights.push({ icon: "👤", title: formatCount(unassigned) + " unassigned", sub: "Owners needed before pickup" });
        }
        const firstBlocker = (dashboard.blockers || [])[0];
        if (firstBlocker?.title) {
          insights.push({ icon: "🛑", title: (firstBlocker.key ? firstBlocker.key + ": " : "") + firstBlocker.title, sub: "Owner: " + (firstBlocker.owner || "Unassigned") });
        }
        const topRisk = (dashboard.risks || [])[0];
        if (topRisk?.title && !insights.find((ins) => ins.title === topRisk.title)) {
          insights.push({ icon: topRisk.severity === "high" ? "⚠️" : "ℹ️", title: topRisk.title, sub: topRisk.rationale || "Top risk surfaced by agent" });
        }
        if (!insights.length && committed) {
          insights.push({ icon: "✅", title: "Sprint signals look healthy", sub: "No blockers, overdue, or major at-risk work" });
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
        const blockers = dashboard.blockers.map((blocker) => '<article class="action-card blocker-analysis"><div class="label">Blocker Analysis</div><strong>' + escapeHtml(blocker.key || "Jira issue") + ': ' + escapeHtml(blocker.title || "Blocked work") + '</strong><p>Owner: ' + escapeHtml(blocker.owner || "Unassigned") + '</p></article>');
        const risks = dashboard.risks.map((risk) => '<article class="action-card sprint-health-card"><div class="label severity-' + escapeAttribute(risk.severity || "medium") + '">' + escapeHtml(risk.severity || "risk") + '</div><strong>' + escapeHtml(risk.title || "Project risk") + '</strong><p>' + escapeHtml(risk.rationale || "") + '</p></article>');
        const asks = dashboard.actionAsks.map((ask) => '<article class="action-card"><div class="label">Action Ask</div><strong>' + escapeHtml(ask.title || "Action needed") + '</strong><p>' + escapeHtml(ask.detail || "") + '</p></article>');
        document.getElementById("actionCards").innerHTML = [...blockers, ...risks, ...asks].join("");
      }

      function card(label, value) {
        return '<article class="sprint-health-card"><div class="label">' + escapeHtml(label) + '</div><div class="value">' + escapeHtml(String(value)) + '</div></article>';
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
        document.getElementById("activitySummary").textContent = state.activityEventCount + " Jira agent events captured.";
      }

      function setRunStatus(status, label) {
        const runStatus = document.getElementById("runStatus");
        runStatus.className = "run-status " + status;
        runStatus.innerHTML = '<span class="status-dot"></span>' + escapeHtml(label);
      }

      function setRunButtonBusy(isBusy) {
        const button = document.getElementById("runAnalysis");
        button.disabled = isBusy;
        button.textContent = isBusy ? "Running Jira project analysis..." : "Run Jira project analysis";
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
        if (frame.event === "tool_start") updateAgentProgress("Tool started", payload.name || "Jira tool");
        if (frame.event === "tool_end") updateAgentProgress("Tool completed", payload.name || "Jira tool", "done");
        if (frame.event === "structured_output") {
          streamState.structuredOutput = payload.payload || null;
          appendActivityEvent("Received jira_project.dashboard.v1", payload.schema_id || "Schema id not provided.", "done");
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
          appId: "jira-project-dashboard",
          reason,
          context: state.dashboard,
          resourceRefs: [{ kind: "agent", id: "jira-agent" }, { kind: "schema", id: "jira_project.dashboard.v1" }],
          suggestedPrompts: ["What is blocking this Jira project?", "Which stories are at risk?"],
        }, "*");
      }

      function openAssistantChat() {
        publishAssistantContext("open-chat");
        if (!window.parent || window.parent === window) return;
        window.parent.postMessage({ type: "caipe.agenticApp.assistant.open.v1", appId: "jira-project-dashboard" }, "*");
      }

      function persistRun(dashboard) {
        const run = { id: String(Date.now()), updatedAt: new Date().toISOString(), dashboard };
        state.runs = [run, ...state.runs.filter((item) => item.dashboard?.project !== dashboard.project)].slice(0, 8);
        try { localStorage.setItem("jira-project-dashboard.runHistory", JSON.stringify(state.runs)); } catch {}
        renderRunHistory();
      }

      function renderRunHistory() {
        const runHistory = document.getElementById("runHistory");
        runHistory.innerHTML = '<option value="">Previous Jira runs</option>' + state.runs.map((run) => '<option value="' + escapeAttribute(run.id) + '">' + escapeHtml(run.dashboard?.project || "project") + " • " + new Date(run.updatedAt).toLocaleString() + '</option>').join("");
      }

      function loadRunHistory() {
        try {
          const parsed = JSON.parse(localStorage.getItem("jira-project-dashboard.runHistory") || "[]");
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

      function applyFontPreferences(preferences = readFontPreferences()) {
        const families = {
          inter: 'Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
          system: 'ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
          mono: '"SFMono-Regular", Consolas, "Liberation Mono", monospace',
          serif: 'Georgia, "Times New Roman", serif',
        };
        const scales = { small: "0.92", default: "1", large: "1.08", xl: "1.18" };
        const family = families[preferences.family] ? preferences.family : "inter";
        const scale = scales[preferences.scale] ? preferences.scale : "small";
        document.documentElement.style.setProperty("--app-font-family", families[family]);
        document.documentElement.style.setProperty("--app-font-scale", scales[scale]);
        fontFamilySelect.value = family;
        fontScaleSelect.value = scale;
      }

      function toggleFontSettings() {
        const nextOpen = fontCustomizer.hidden;
        fontCustomizer.hidden = !nextOpen;
        settingsToggle.setAttribute("aria-expanded", String(nextOpen));
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

function normalizeProjectKey(projectName) {
  return String(projectName || "SRE").trim().toUpperCase().replace(/[^A-Z0-9_-]/g, "") || "SRE";
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
