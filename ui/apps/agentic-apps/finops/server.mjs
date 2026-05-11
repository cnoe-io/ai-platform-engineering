#!/usr/bin/env node

// assisted-by Codex Codex-sonnet-4-6
import { createServer } from "node:http";

import { createAgenticAppJwtVerifier } from "../../_lib/jwt-verify.mjs";

const port = Number(process.env.FINOPS_APP_PORT ?? "3010");
const basePath = normalizeBasePath(process.env.FINOPS_APP_BASE_PATH ?? "/apps/finops");
const defaultAgentId = process.env.FINOPS_AGENT_ID ?? process.env.AWS_AGENT_ID ?? "agent-aws-cost-explorer";
const defaultLookbackDays = Number(process.env.FINOPS_LOOKBACK_DAYS ?? "30");
const defaultDashboardKind = process.env.FINOPS_DASHBOARD_KIND ?? "cost-overview";

const verifier =
  process.env.AGENTIC_APP_FINOPS_JWT_DISABLED === "true"
    ? null
    : createAgenticAppJwtVerifier({ appId: "finops" });

const server = createServer(async (request, response) => {
  const url = new URL(request.url ?? "/", `http://${request.headers.host ?? "localhost"}`);

  if (url.pathname === "/healthz") {
    sendJson(response, 200, {
      ok: true,
      app: "finops",
      runtime: "separate-process",
      dataSource: "aws-cost-explorer-via-agent",
      assistant: "context-aware",
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
    sendJson(response, 200, buildFinOpsAgentPlan());
    return;
  }

  if (url.pathname === "/api/finops") {
    sendJson(response, 200, buildFinOpsAgentPlan());
    return;
  }

  if (url.pathname === "/embed") {
    response.writeHead(200, {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "no-store",
    });
    response.end(renderDashboard({ compact: true }));
    return;
  }

  if (url.pathname === "/" || url.pathname === "/dashboard") {
    response.writeHead(200, {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "no-store",
    });
    response.end(renderDashboard({ compact: false }));
    return;
  }

  sendJson(response, 404, { error: "not_found" });
});

server.listen(port, () => {
  console.log(`FinOps Command Center listening on http://localhost:${port}`);
  console.log(`Configure CAIPE with AGENTIC_APP_FINOPS_ORIGIN=http://localhost:${port}`);
  console.log(`Configure FINOPS_AGENT_ID=${defaultAgentId} if your AWS agent uses a different id`);
});

function buildFinOpsAgentPlan() {
  return {
    status: "ready_for_agent",
    source: "aws-cost-explorer-via-caipe-dynamic-agent",
    agentId: defaultAgentId,
    lookbackDays: defaultLookbackDays,
    dashboardKind: defaultDashboardKind,
    endpoint: "/api/v1/chat/stream/start",
    prompt: buildCostExplorerPrompt(defaultLookbackDays, defaultDashboardKind),
    responseFormat: buildFinOpsDashboardResponseFormat(),
    expectedJsonShape: {
      currency: "USD",
      totalCost: 1234.56,
      forecastCost: 1567.89,
      services: [{ name: "Amazon EC2", amount: 500.0 }],
      trend: [{ date: "2026-05-01", amount: 123.45 }],
      rawCost: [{ date: "2026-05-01", service: "Amazon EC2", account: "example-account", amount: 123.45, unit: "USD" }],
      anomalies: [{ service: "Amazon EC2", impact: 120.0, explanation: "Short explanation" }],
      recommendations: ["Actionable recommendation"],
    },
  };
}

function buildCostExplorerPrompt(days, dashboardKind = "cost-overview") {
  return [
    `Build the ${dashboardKind} FinOps dashboard using AWS Cost Explorer for the last ${days} days.`,
    "Use aws_cli_execute exactly once for the primary cost pull.",
    "For aws_cli_execute: profile must be an empty string, region must be us-east-2, output_format must be json, and jq_filter must be omitted.",
    "The command must not include the aws prefix, --profile, --region, --output, shell pipes, jq, file:// filters, or forecast calls.",
    "Use this command shape only: ce get-cost-and-usage --time-period Start=<start-date>,End=<end-date> --granularity DAILY --metrics UnblendedCost --group-by Type=DIMENSION,Key=SERVICE Type=DIMENSION,Key=LINKED_ACCOUNT.",
    "Use the structured response tool with the requested finops.dashboard.v1 schema, then provide a short explanation suitable for an embedded dashboard.",
    "Include trend as daily total cost points and rawCost as raw Cost Explorer rows grouped by date, service, and account when available.",
    "Set forecastCost to totalCost if a forecast cannot be derived from the returned data without another tool call.",
    "Do not invent values. If AWS Cost Explorer is unavailable, explain what credential or permission is missing.",
  ].join(" ");
}

function buildFinOpsDashboardResponseFormat() {
  return {
    type: "json_schema",
    schema_id: "finops.dashboard.v1",
    schema: {
      type: "object",
      required: ["currency", "totalCost", "forecastCost", "services", "trend", "rawCost", "anomalies", "recommendations"],
      properties: {
        currency: { type: "string" },
        totalCost: { type: "number" },
        forecastCost: { type: "number" },
        services: { type: "array" },
        trend: { type: "array" },
        rawCost: { type: "array" },
        anomalies: { type: "array" },
        recommendations: { type: "array" },
      },
    },
  };
}

function renderDashboard({ compact }) {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>FinOps Command Center</title>
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
          radial-gradient(circle at 12% 15%, rgba(34, 197, 94, 0.18), transparent 28rem),
          radial-gradient(circle at 80% 12%, rgba(56, 189, 248, 0.14), transparent 26rem),
          radial-gradient(circle at 68% 95%, rgba(245, 158, 11, 0.10), transparent 28rem),
          #020617;
      }
      main { max-width: 1340px; margin: 0 auto; padding: ${compact ? "14px" : "18px 18px 24px"}; }
      .hero, .panel, .assistant {
        border: 1px solid rgba(255,255,255,0.10);
        background: rgba(15, 23, 42, 0.62);
        box-shadow: 0 18px 50px rgba(8, 47, 73, 0.18);
        backdrop-filter: blur(14px);
      }
      .hero { border-radius: 14px; padding: 12px 16px; margin-bottom: 10px; overflow: hidden; position: relative; }
      .hero-row { display: flex; align-items: center; gap: 14px; flex-wrap: wrap; }
      .hero-title { display: flex; flex-direction: column; gap: 2px; flex: 1; min-width: 220px; }
      .eyebrow {
        margin: 0;
        color: #6ee7b7;
        font-size: 0.64rem;
        font-weight: 800;
        letter-spacing: 0.22em;
        text-transform: uppercase;
        display: inline-flex;
        align-items: center;
      }
      h1 { margin: 0; font-size: 1.28rem; letter-spacing: -0.025em; line-height: 1.15; font-weight: 800; }
      h2 { margin: 0 0 8px; font-size: 0.78rem; font-weight: 800; letter-spacing: 0.14em; text-transform: uppercase; color: #94a3b8; }
      .subtitle { color: #94a3b8; line-height: 1.4; font-size: 0.78rem; max-width: 720px; }
      .hero-status { z-index: 2; }
      .shell { display: grid; grid-template-columns: minmax(0, 1.35fr) minmax(280px, 0.65fr); gap: 12px; }
      .panel, .assistant { border-radius: 14px; padding: 12px 14px; }
      .panel + .panel { margin-top: 10px; }
      .grid-2 { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
      .grid-2 > .panel { margin-top: 0 !important; }
      .controls { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; }
      .controls input, .controls select { padding: 6px 10px; font-size: 0.78rem; }
      .controls button { padding: 6px 12px; font-size: 0.78rem; }
      .settings-fab { position: fixed; left: 18px; bottom: 24px; z-index: 31; display: inline-flex; align-items: center; gap: 7px; padding: 10px 13px; border: 1px solid rgba(125, 211, 252, 0.4); border-radius: 999px; background: rgba(2, 6, 23, 0.9); box-shadow: 0 18px 50px rgba(2, 6, 23, 0.34); color: #e0f2fe; font-size: 0.86rem; font-weight: 1000; letter-spacing: 0.08em; text-transform: uppercase; backdrop-filter: blur(18px); }
      .settings-fab:hover { border-color: rgba(125, 211, 252, 0.75); background: rgba(14, 165, 233, 0.18); }
      .font-customizer { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; position: fixed; left: 18px; bottom: 74px; z-index: 30; max-width: calc(100vw - 36px); padding: 8px 10px; border: 1px solid rgba(255,255,255,0.12); border-radius: 18px; background: rgba(2, 6, 23, 0.92); box-shadow: 0 18px 50px rgba(2, 6, 23, 0.34); backdrop-filter: blur(18px); font-size: 0.78rem; line-height: 1; }
      .font-customizer[hidden] { display: none; }
      .font-dock-title { color: #e2e8f0; font-size: 0.72rem; font-weight: 1000; letter-spacing: 0.1em; text-transform: uppercase; }
      .font-customizer label { display: inline-flex; align-items: center; gap: 6px; color: #cbd5e1; font-size: 0.72rem; font-weight: 900; letter-spacing: 0.08em; text-transform: uppercase; }
      .font-customizer select { min-width: 82px; padding: 7px 10px; font-size: 0.86rem; line-height: 1; }
      input, select, button {
        border-radius: 8px;
        border: 1px solid rgba(255,255,255,0.12);
        background: rgba(2, 6, 23, 0.72);
        color: #e2e8f0;
        padding: 7px 10px;
        font-family: inherit;
        font-size: 0.78rem;
      }
      button { cursor: pointer; background: linear-gradient(135deg, #059669, #0284c7); font-weight: 700; border-color: transparent; }
      button.ghost { background: rgba(2, 6, 23, 0.72); font-weight: 600; }
      button[disabled] { cursor: wait; opacity: 0.6; }
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
      .kpi.accent-spend { border-color: rgba(52, 211, 153, 0.35); }
      .kpi.accent-forecast { border-color: rgba(56, 189, 248, 0.28); }
      .kpi.accent-warn { border-color: rgba(248, 113, 113, 0.32); }
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
      .kpi .kpi-sub {
        color: #94a3b8;
        font-size: 0.72rem;
        font-weight: 600;
      }
      .kpi .kpi-delta {
        display: inline-flex;
        align-items: center;
        gap: 3px;
        font-size: 0.72rem;
        font-weight: 800;
        padding: 1px 6px;
        border-radius: 999px;
      }
      .kpi .kpi-delta.up { background: rgba(248, 113, 113, 0.18); color: #fca5a5; }
      .kpi .kpi-delta.down { background: rgba(52, 211, 153, 0.18); color: #86efac; }
      .kpi .kpi-delta.flat { background: rgba(148, 163, 184, 0.18); color: #cbd5e1; }
      .kpi .kpi-spark {
        position: absolute;
        right: 8px;
        bottom: 6px;
        width: 90px;
        height: 30px;
        opacity: 0.85;
        pointer-events: none;
      }
      .insights-strip { display: flex; flex-wrap: wrap; gap: 8px; }
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
      .card, .row, .message {
        border-radius: 10px;
        background: rgba(2, 6, 23, 0.45);
        border: 1px solid rgba(255,255,255,0.07);
        padding: 8px 10px;
      }
      .label { color: #94a3b8; font-size: 0.72rem; font-weight: 700; letter-spacing: 0.08em; text-transform: uppercase; }
      .value { margin-top: 4px; color: white; font-size: 1.14rem; font-weight: 700; letter-spacing: -0.02em; }
      .chart { width: 100%; min-height: 150px; margin-top: 4px; }
      .chart.small { min-height: 120px; }
      .row { display: flex; justify-content: space-between; gap: 10px; margin-top: 6px; color: #cbd5e1; font-size: 0.78rem; }
      .row strong { color: #f8fafc; font-weight: 700; }
      .panel-head { display: flex; align-items: baseline; justify-content: space-between; gap: 8px; margin-bottom: 6px; }
      .legend { display: inline-flex; align-items: center; gap: 4px; color: #94a3b8; font-size: 0.64rem; font-weight: 700; letter-spacing: 0.1em; text-transform: uppercase; }
      .legend-swatch { display: inline-block; width: 14px; height: 3px; border-radius: 2px; vertical-align: middle; margin-right: 4px; }
      .legend-swatch.line { background: linear-gradient(90deg, #22c55e, #0ea5e9); }
      .legend-swatch.avg { background: #fbbf24; }
      .trend-summary { color: #cbd5e1; font-size: 0.78rem; margin-bottom: 4px; }
      .dow-grid {
        display: grid;
        grid-template-columns: 28px repeat(7, 1fr);
        gap: 4px;
        align-items: center;
      }
      .dow-grid .dow-label {
        color: #94a3b8;
        font-size: 0.64rem;
        font-weight: 800;
        letter-spacing: 0.08em;
        text-align: right;
        padding-right: 4px;
      }
      .dow-grid .dow-cell {
        position: relative;
        aspect-ratio: 1.4;
        border-radius: 6px;
        background: rgba(15, 23, 42, 0.6);
        border: 1px solid rgba(255,255,255,0.05);
        display: flex;
        align-items: center;
        justify-content: center;
        color: #f8fafc;
        font-size: 0.64rem;
        font-weight: 700;
        overflow: hidden;
      }
      .dow-cell.empty { background: rgba(15, 23, 42, 0.25); color: rgba(255,255,255,0.18); }
      .dow-cell-value { position: relative; z-index: 1; mix-blend-mode: screen; }
      .top-mover {
        display: grid;
        grid-template-columns: minmax(0, 1fr) auto auto;
        align-items: center;
        gap: 8px;
        padding: 6px 8px;
        border-radius: 8px;
        background: rgba(2, 6, 23, 0.45);
        border: 1px solid rgba(255,255,255,0.06);
        margin-top: 6px;
        font-size: 0.78rem;
      }
      .top-mover .mover-name { color: #e2e8f0; font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
      .top-mover .mover-bar {
        width: 88px;
        height: 4px;
        border-radius: 2px;
        background: rgba(148, 163, 184, 0.15);
        overflow: hidden;
        position: relative;
      }
      .top-mover .mover-bar-fill { position: absolute; top: 0; left: 50%; height: 100%; transform: translateX(0); }
      .top-mover .mover-delta { font-weight: 700; font-size: 0.78rem; min-width: 80px; text-align: right; }
      .top-mover .mover-delta.up { color: #fca5a5; }
      .top-mover .mover-delta.down { color: #86efac; }
      .interactive-row { width: 100%; cursor: pointer; text-align: left; font: inherit; }
      .interactive-row.active {
        border-color: rgba(52, 211, 153, 0.6);
        background: rgba(20, 184, 166, 0.18);
      }
      .run-history {
        display: grid;
        grid-template-columns: minmax(0, 1fr) auto;
        gap: 6px;
        align-items: center;
        margin-top: 8px;
      }
      .run-history select { width: 100%; padding: 6px 10px; font-size: 0.78rem; }
      .run-history button { padding: 6px 12px; font-size: 0.78rem; }
      .timeline {
        display: grid;
        gap: 8px;
        margin: 12px 0 0;
        padding: 0;
        list-style: none;
      }
      .timeline li {
        display: grid;
        grid-template-columns: auto minmax(0, 1fr);
        gap: 10px;
        align-items: start;
        border-radius: 16px;
        border: 1px solid rgba(255,255,255,0.09);
        background: rgba(2, 6, 23, 0.48);
        color: #94a3b8;
        padding: 10px 12px;
        font-size: 0.92rem;
      }
      .timeline li.active {
        border-color: rgba(56, 189, 248, 0.7);
        color: #bae6fd;
        box-shadow: 0 0 0 1px rgba(56, 189, 248, 0.12), 0 0 32px rgba(14, 165, 233, 0.12);
      }
      .timeline li.done { border-color: rgba(52, 211, 153, 0.45); color: #bbf7d0; }
      .timeline li.error { border-color: rgba(248, 113, 113, 0.45); color: #fecaca; }
      .activity-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 12px;
      }
      .run-status {
        display: inline-flex;
        align-items: center;
        gap: 8px;
        border-radius: 999px;
        border: 1px solid rgba(148, 163, 184, 0.18);
        background: rgba(15, 23, 42, 0.72);
        color: #cbd5e1;
        padding: 7px 11px;
        font-size: 0.86rem;
        font-weight: 900;
      }
      .run-status.active {
        border-color: rgba(56, 189, 248, 0.5);
        color: #bae6fd;
        box-shadow: 0 0 24px rgba(14, 165, 233, 0.18);
      }
      .run-status.done { border-color: rgba(52, 211, 153, 0.45); color: #bbf7d0; }
      .run-status.error { border-color: rgba(248, 113, 113, 0.45); color: #fecaca; }
      .dashboard-status {
        max-width: min(320px, 42vw);
        cursor: help;
        backdrop-filter: blur(18px);
      }
      .status-dot {
        width: 9px;
        height: 9px;
        border-radius: 999px;
        background: currentColor;
      }
      .run-status.active .status-dot {
        animation: statusPulse 1s ease-in-out infinite;
        box-shadow: 0 0 0 8px rgba(56, 189, 248, 0.1);
      }
      .activity-icon {
        display: inline-flex;
        width: 22px;
        height: 22px;
        align-items: center;
        justify-content: center;
        border-radius: 999px;
        border: 1px solid currentColor;
        font-size: 0.86rem;
        font-weight: 950;
      }
      .activity-spinner {
        width: 18px;
        height: 18px;
        border-radius: 999px;
        border: 2px solid rgba(186, 230, 253, 0.24);
        border-top-color: #67e8f9;
        animation: activitySpin 0.85s linear infinite;
      }
      .activity-content { min-width: 0; }
      .timeline .activity-time {
        display: block;
        color: #64748b;
        font-size: 0.78rem;
        font-weight: 800;
        letter-spacing: 0.08em;
        text-transform: uppercase;
      }
      .timeline .activity-detail {
        display: block;
        margin-top: 4px;
        color: #94a3b8;
        font-size: 0.86rem;
      }
      .stream-content {
        max-height: 260px;
        overflow: auto;
        border-color: rgba(56, 189, 248, 0.18);
        background: rgba(8, 47, 73, 0.18);
      }
      .activity-footer {
        position: sticky;
        bottom: 14px;
        z-index: 4;
        margin-top: 18px;
      }
      .activity-footer:has(details[open]) { position: relative; bottom: auto; }
      .activity-footer details {
        border-radius: 24px;
        border: 1px solid rgba(56, 189, 248, 0.28);
        background: rgba(2, 6, 23, 0.88);
        box-shadow: 0 24px 70px rgba(8, 47, 73, 0.28);
        backdrop-filter: blur(22px);
        overflow: hidden;
      }
      .activity-footer details[open] { background: rgba(2, 6, 23, 0.96); }
      .activity-footer details[open] summary { border-bottom: 1px solid rgba(255,255,255,0.08); }
      .activity-footer details[open] .activity-drawer-body { max-height: 320px; overflow: auto; }
      .activity-footer summary {
        display: flex;
        align-items: center;
        gap: 12px;
        padding: 12px 16px;
        cursor: pointer;
        list-style: none;
      }
      .activity-footer summary::-webkit-details-marker { display: none; }
      .activity-summary {
        min-width: 0;
        flex: 1;
        color: #cbd5e1;
        font-size: 0.92rem;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .activity-toggle-hint {
        color: #67e8f9;
        font-size: 0.86rem;
        font-weight: 900;
      }
      .activity-drawer-body {
        display: grid;
        grid-template-columns: minmax(0, 0.9fr) minmax(0, 1.1fr);
        gap: 14px;
        max-height: min(64vh, 720px);
        overflow: auto;
        border-top: 1px solid rgba(148, 163, 184, 0.14);
        padding: 16px;
      }
      .activity-drawer-body h2 { font-size: 1.28rem; }
      .debug-events {
        grid-column: 1 / -1;
        border-radius: 18px;
        border: 1px solid rgba(148, 163, 184, 0.16);
        background: rgba(15, 23, 42, 0.48);
      }
      .debug-events summary {
        color: #94a3b8;
        font-size: 0.92rem;
        font-weight: 900;
      }
      .debug-events .timeline { padding: 0 12px 12px; }
      .markdown-report {
        white-space: normal;
      }
      .markdown-report h1,
      .markdown-report h2,
      .markdown-report h3 {
        margin: 1em 0 0.45em;
        color: #f8fafc;
        letter-spacing: -0.035em;
      }
      .markdown-report h1 { font-size: 1.14rem; text-transform: none; letter-spacing: 0; color: #f8fafc; margin: 0.8em 0 0.35em; }
      .markdown-report h2 { font-size: 1rem; text-transform: none; letter-spacing: 0; color: #f8fafc; margin: 0.8em 0 0.35em; }
      .markdown-report h3 { font-size: 0.86rem; text-transform: none; letter-spacing: 0; color: #f8fafc; margin: 0.7em 0 0.3em; }
      .markdown-report p { margin: 0.5em 0; font-size: 0.78rem; line-height: 1.5; }
      .markdown-report ul,
      .markdown-report ol { margin: 0.65em 0; padding-left: 1.35rem; }
      .markdown-report li { margin: 0.35em 0; }
      .markdown-report code {
        border-radius: 6px;
        background: rgba(15, 23, 42, 0.88);
        color: #bae6fd;
        padding: 0.1rem 0.35rem;
      }
      .markdown-report pre {
        overflow: auto;
        border-radius: 14px;
        border: 1px solid rgba(148, 163, 184, 0.18);
        background: rgba(2, 6, 23, 0.82);
        padding: 12px;
      }
      .markdown-report pre code {
        background: transparent;
        padding: 0;
      }
      .markdown-report a { color: #67e8f9; }
      .filter-pill {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        border-radius: 999px;
        border: 1px solid rgba(56, 189, 248, 0.22);
        background: rgba(14, 165, 233, 0.10);
        color: #bae6fd;
        padding: 4px 10px;
        margin: 0 6px 6px 0;
        font-size: 0.72rem;
        font-weight: 700;
      }
      .assistant-grid { display: grid; gap: 8px; }
      .assistant { position: sticky; top: 12px; align-self: start; }
      .assistant button { width: 100%; }
      .assistant button + button { margin-top: 6px; }
      .message { margin-top: 8px; color: #cbd5e1; line-height: 1.5; white-space: pre-wrap; font-size: 0.78rem; }
      .notice { border-color: rgba(251, 191, 36, 0.28); background: rgba(120, 53, 15, 0.24); }
      .pulse {
        display: inline-flex;
        width: 10px;
        height: 10px;
        border-radius: 999px;
        margin-right: 8px;
        background: #34d399;
        box-shadow: 0 0 0 8px rgba(52,211,153,0.14);
      }
      @keyframes activitySpin {
        to { transform: rotate(360deg); }
      }
      @keyframes statusPulse {
        0%, 100% { transform: scale(0.9); opacity: 0.55; }
        50% { transform: scale(1.2); opacity: 1; }
      }
      @media (max-width: 1100px) {
        .kpi-strip { grid-template-columns: repeat(3, minmax(0, 1fr)); }
        .grid-2 { grid-template-columns: 1fr; }
      }
      @media (max-width: 760px) {
        .shell { grid-template-columns: 1fr; }
        .assistant { position: static; }
        .kpi-strip { grid-template-columns: repeat(2, minmax(0, 1fr)); }
        .hero-status { position: relative; inset: auto; }
        .dashboard-status { max-width: none; }
        .activity-drawer-body { grid-template-columns: 1fr; }
        .font-customizer { position: static; margin: 12px 0 0; }
      }
    </style>
  </head>
  <body>
    <main>
      <section class="hero">
        <div class="hero-row">
          <div class="hero-title">
            <p class="eyebrow"><span class="pulse"></span>FinOps · AWS Cost Explorer</p>
            <h1>FinOps Command Center</h1>
          </div>
          <div class="controls">
            <input id="agentId" aria-label="AWS agent id" value="${escapeHtml(defaultAgentId)}" />
            <input id="lookbackDays" aria-label="Lookback days" style="width: 56px;" value="${escapeHtml(defaultLookbackDays)}" />
            <select id="dashboardKind" aria-label="Dashboard kind">
              <option value="cost-overview" selected>Cost overview</option>
              <option value="service-breakdown">Service breakdown</option>
              <option value="anomaly-review">Anomaly review</option>
              <option value="savings-plan">Savings plan</option>
            </select>
            <button id="runAnalysis">Run analysis</button>
          </div>
          <div class="hero-status">
            <span class="run-status dashboard-status idle" id="dashboardStatus" title="No successful run loaded yet.">
              <span class="status-dot" aria-hidden="true"></span>
              Updated: never
            </span>
          </div>
        </div>
        <div class="run-history">
          <select id="runHistory" aria-label="Previous FinOps runs">
            <option value="">No previous runs loaded yet</option>
          </select>
          <button class="ghost" id="loadSelectedRun" type="button">Load run</button>
        </div>
      </section>

      <button class="settings-fab" id="settingsToggle" type="button" aria-expanded="false" aria-controls="fontCustomizer">Settings</button>
      <div class="font-customizer font-dock" id="fontCustomizer" aria-label="Font customization" hidden>
        <span class="font-dock-title">View settings</span>
        <label>
          Font
          <select id="fontFamilySelect" aria-label="Font family">
            <option value="inter">Inter</option>
            <option value="system">System</option>
            <option value="mono">Mono</option>
            <option value="serif">Serif</option>
          </select>
        </label>
        <label>
          Size
          <select id="fontScaleSelect" aria-label="Text size">
            <option value="small">Small</option>
            <option value="default">Default</option>
            <option value="large">Large</option>
            <option value="xl">XL</option>
          </select>
        </label>
      </div>

      <div class="kpi-strip" id="kpiStrip">
        <div class="kpi accent-spend">
          <div class="kpi-label">💸 Total spend</div>
          <div class="kpi-value" id="kpiTotal">—</div>
          <div class="kpi-sub" id="kpiTotalSub">Awaiting agent</div>
          <svg class="kpi-spark" id="kpiSpark" viewBox="0 0 90 30" preserveAspectRatio="none" aria-hidden="true"></svg>
        </div>
        <div class="kpi accent-forecast">
          <div class="kpi-label">🔮 Forecast</div>
          <div class="kpi-value" id="kpiForecast">—</div>
          <div class="kpi-sub" id="kpiForecastSub">Projected total</div>
        </div>
        <div class="kpi">
          <div class="kpi-label">📈 Δ vs prior</div>
          <div class="kpi-value" id="kpiDelta">—</div>
          <div class="kpi-sub" id="kpiDeltaSub">Day-over-day</div>
        </div>
        <div class="kpi">
          <div class="kpi-label">🏆 Top service</div>
          <div class="kpi-value" id="kpiTopService" style="font-size: 1rem;">—</div>
          <div class="kpi-sub" id="kpiTopServiceSub">No data</div>
        </div>
        <div class="kpi accent-warn">
          <div class="kpi-label">⚠ Anomalies</div>
          <div class="kpi-value" id="kpiAnomalies">0</div>
          <div class="kpi-sub" id="kpiAnomaliesSub">No alerts</div>
        </div>
        <div class="kpi">
          <div class="kpi-label">🧭 Recs</div>
          <div class="kpi-value" id="kpiRecs">0</div>
          <div class="kpi-sub" id="kpiRecsSub">Optimization signals</div>
        </div>
      </div>

      <div class="insights-strip" id="insightsStrip" style="margin-top: 10px;">
        <div class="insight">
          <span class="insight-icon">📊</span>
          <span class="insight-text"><strong>Run the agent</strong><small>Insights appear here at a glance once data lands.</small></span>
        </div>
      </div>

      <div class="shell" style="margin-top: 10px;">
        <section>
          <div class="panel">
            <h2>Filters</h2>
            <span class="filter-pill" id="selectedServiceLabel">Service: All</span>
            <span class="filter-pill" id="selectedDateLabel">Date: All</span>
            <button class="ghost" id="clearFilters" type="button">Clear filters</button>
          </div>
          <div class="grid-2" style="margin-top: 10px;">
            <div class="panel">
              <h2>Service spend</h2>
              <svg class="chart small" id="costChart" viewBox="0 0 760 220" role="img" aria-label="AWS service cost chart"></svg>
              <div id="serviceRows"></div>
            </div>
            <div class="panel">
              <div class="panel-head">
                <h2 style="margin: 0;">Daily trend</h2>
                <span class="legend">
                  <span class="legend-swatch line"></span>Spend
                  <span class="legend-swatch avg" style="margin-left: 8px;"></span>7-day avg
                </span>
              </div>
              <div class="trend-summary" id="trendSummary">Run analysis to see daily spend.</div>
              <svg class="chart small" id="trendChart" viewBox="0 0 760 220" role="img" aria-label="AWS daily cost trend chart"></svg>
            </div>
          </div>
          <div class="grid-2" style="margin-top: 10px;">
            <div class="panel">
              <h2>Day-of-week pattern</h2>
              <p class="subtitle" id="dowSummary" style="margin: 0 0 6px;">Spot which weekdays drive cost.</p>
              <div class="dow-grid" id="dowGrid"></div>
            </div>
            <div class="panel">
              <h2>Top movers (vs prior period)</h2>
              <p class="subtitle" id="moversSummary" style="margin: 0 0 6px;">Biggest changes between halves of the window.</p>
              <div id="topMovers"></div>
            </div>
          </div>
          <div class="panel">
            <h2>Raw Cost Explorer rows</h2>
            <div id="rawRows" class="message">
              Raw Cost Explorer rows will appear here after the AWS agent returns structured output.
            </div>
          </div>
          <div class="panel">
            <h2>Anomalies & recommendations</h2>
            <div id="recommendations" class="message">
              Run the AWS agent to populate real Cost Explorer anomalies and recommendations.
            </div>
          </div>
        </section>

        <aside class="assistant">
          <div class="assistant-grid">
            <div>
              <p class="eyebrow">Cost Intelligence</p>
              <h2 style="margin-top: 4px;">Executive Summary</h2>
              <p class="subtitle">
                Share the current cost posture with Ask FinOps for explanations, action planning,
                and trend investigation.
              </p>
              <button id="publishContext">Share current cost context</button>
              <button class="ghost" id="openAssistantChat" type="button">Open Ask FinOps Chat</button>
              <div class="message" id="assistantStatus">Latest cost context is not shared yet.</div>
            </div>
            <div>
              <h2>Agent transcript</h2>
              <div class="message markdown-report" id="agentTranscript">Latest pull status will appear here.</div>
            </div>
          </div>
        </aside>
      </div>
      <footer class="activity-footer" id="activityFooter">
        <details id="activityDrawer">
          <summary>
            <span class="run-status idle" id="runStatus">
              <span class="status-dot" aria-hidden="true"></span>
              Ready
            </span>
            <span class="activity-summary" id="activitySummary">
              Agent activity appears here during a live FinOps run.
            </span>
            <span class="activity-toggle-hint">Details</span>
          </summary>
          <div class="activity-drawer-body">
            <section>
              <h2>Live Agent Activity</h2>
              <ol class="timeline" id="agentProgress">
                <li data-step="idle" class="done">
                  <span class="activity-icon" aria-hidden="true">✓</span>
                  <span class="activity-content">
                    <span class="activity-time">Idle</span>
                    <span>Ready to run live AWS Cost Explorer analysis</span>
                  </span>
                </li>
              </ol>
            </section>
            <section>
              <h2>Streamed Report</h2>
              <div class="message stream-content markdown-report" id="streamedContent">
                Streamed agent content will appear here during a live run.
              </div>
            </section>
            <details class="debug-events">
              <summary>Debug events (<span id="debugEventCount">0</span>)</summary>
              <ol class="timeline" id="debugProgress"></ol>
            </details>
          </div>
        </details>
      </footer>
    </main>

    <script>
      const basePath = ${JSON.stringify(basePath)};
      const defaultPrompt = ${JSON.stringify(buildCostExplorerPrompt(defaultLookbackDays, defaultDashboardKind))};
      const state = {
        analysis: null,
        lastAgentMessage: "",
        runs: [],
        selectedService: "",
        selectedDate: "",
        activityEventCount: 0,
        debugEventCount: 0,
      };
      const fontStorageKey = "agentic-app.fontPreferences";
      const settingsToggle = document.getElementById("settingsToggle");
      const fontCustomizer = document.getElementById("fontCustomizer");
      const fontFamilySelect = document.getElementById("fontFamilySelect");
      const fontScaleSelect = document.getElementById("fontScaleSelect");

      document.getElementById("runAnalysis").addEventListener("click", runAwsAgent);
      document.getElementById("publishContext").addEventListener("click", () => publishAssistantContext("manual"));
      document.getElementById("openAssistantChat").addEventListener("click", openAssistantChat);
      document.getElementById("loadSelectedRun").addEventListener("click", loadSelectedRun);
      document.getElementById("runHistory").addEventListener("change", loadSelectedRun);
      document.getElementById("clearFilters").addEventListener("click", clearFilters);
      settingsToggle.addEventListener("click", toggleFontSettings);
      fontFamilySelect.addEventListener("change", () => writeFontPreferences());
      fontScaleSelect.addEventListener("change", () => writeFontPreferences());
      applyFontPreferences();
      primeAgentPlan();
      loadCachedDashboard();

      async function primeAgentPlan() {
        const response = await fetch("/api/summary", { headers: { accept: "application/json" } });
        const plan = await response.json();
        document.getElementById("agentTranscript").textContent =
          "Ready to call " + plan.endpoint + " with agent_id=" + plan.agentId + ".";
      }

      async function loadCachedDashboard() {
        try {
          const response = await fetch("/api/agentic-apps/finops-cache", {
            headers: { accept: "application/json" },
          });
          if (!response.ok) return;
          const result = await response.json();
          const cached = result.data?.item;
          state.runs = Array.isArray(result.data?.items) ? result.data.items : cached ? [cached] : [];
          renderRunHistory();
          if (!cached?.payload) return;
          applyRun(cached);
          document.getElementById("agentTranscript").textContent =
            "Loaded latest successful cost pull from " + new Date(cached.updatedAt).toLocaleString() + ".";
          setDashboardStatus("done", "Updated " + new Date(cached.updatedAt).toLocaleTimeString(), dashboardStatusDetail(cached));
        } catch {
          // Cache is a warm-start convenience. Fresh pulls still work if unavailable.
        }
      }

      async function runAwsAgent() {
        const agentId = document.getElementById("agentId").value.trim() || ${JSON.stringify(defaultAgentId)};
        const days = Number(document.getElementById("lookbackDays").value || ${JSON.stringify(defaultLookbackDays)});
        const dashboardKind = document.getElementById("dashboardKind").value || ${JSON.stringify(defaultDashboardKind)};
        const prompt = [
          "Build the " + dashboardKind + " FinOps dashboard using AWS Cost Explorer for the last " + days + " days.",
          "Use aws_cli_execute exactly once for the primary cost pull.",
          "For aws_cli_execute: profile must be an empty string, region must be us-east-2, output_format must be json, and jq_filter must be omitted.",
          "The command must not include the aws prefix, --profile, --region, --output, shell pipes, jq, file:// filters, or forecast calls.",
          "Use this command shape only: ce get-cost-and-usage --time-period Start=<start-date>,End=<end-date> --granularity DAILY --metrics UnblendedCost --group-by Type=DIMENSION,Key=SERVICE Type=DIMENSION,Key=LINKED_ACCOUNT.",
          "Use submit_structured_response with the requested finops.dashboard.v1 schema before the final explanation.",
          "Include trend as daily total cost points and rawCost as raw Cost Explorer rows grouped by date, service, and account when available.",
          "Set forecastCost to totalCost if a forecast cannot be derived from the returned data without another tool call.",
          "Do not invent values. If AWS Cost Explorer is unavailable, explain what credential or permission is missing."
        ].join(" ");

        state.selectedService = "";
        state.selectedDate = "";
        renderFilters();
        initializeActivityFeed();
        setDashboardStatus("active", "Updating...", "Agent: " + agentId + "\\nData: AWS Cost Explorer\\nDashboard: " + dashboardKind);
        setRunButtonBusy(true);
        updateAgentProgress("prepare", "Preparing Cost Explorer request", "Lookback: " + days + " days • Dashboard: " + dashboardKind);
        document.getElementById("agentTranscript").textContent = "Running cost analysis agent " + agentId + "...";

        try {
          updateAgentProgress("agent", "Opening live CAIPE stream", "Agent: " + agentId);
          const response = await fetch("/api/v1/chat/stream/start", {
            method: "POST",
            headers: { "content-type": "application/json", accept: "text/event-stream" },
            body: JSON.stringify({
              agent_id: agentId,
              message: prompt,
              conversation_id: "finops-command-center-" + Date.now(),
              protocol: "custom",
              client_context: {
                appId: "finops",
                source: "agentic-app",
                requestedDataSource: "aws-cost-explorer",
                dashboardKind,
                lookbackDays: days,
                response_format: ${JSON.stringify(buildFinOpsDashboardResponseFormat())},
              },
            }),
          });
          if (!response.ok) {
            const message = await response.text().catch(() => "Cost analysis request failed.");
            document.getElementById("agentTranscript").textContent = message;
            updateAgentProgress("error", "Cost analysis request failed", message);
            publishAssistantContext("agent-error");
            return;
          }
          const streamState = await consumeAgentStream(response);
          updateAgentProgress("shape", "Shaping dashboard output", streamState.structuredOutput ? "Structured output received from stream." : "No finops.dashboard.v1 structured output received.");
          const content = streamState.content || "No streamed explanation was returned.";
          state.lastAgentMessage = content;
          if (!streamState.structuredOutput || typeof streamState.structuredOutput !== "object") {
            throw new Error("No finops.dashboard.v1 structured output received");
          }
          state.analysis = normalizeCostExplorerPayload(streamState.structuredOutput);
          renderAnalysis(state.analysis, content);
          if (state.analysis.status === "structured") {
            updateAgentProgress("save", "Saving run history", "Captured " + state.analysis.services.length + " services, " + state.analysis.trend.length + " trend points, " + state.analysis.rawCost.length + " raw rows.");
            await saveCachedDashboard(agentId, dashboardKind, days, state.analysis, content);
          }
          updateAgentProgress("done", "Run complete", "Dashboard updated from live agent stream.");
          setDashboardStatus(
            "done",
            "Updated " + new Date().toLocaleTimeString(),
            "Agent: " + agentId + "\\nData: AWS Cost Explorer\\nServices: " + state.analysis.services.length + "\\nTrend points: " + state.analysis.trend.length + "\\nRaw rows: " + state.analysis.rawCost.length + "\\nStructured output: " + (state.analysis.status === "structured" ? "yes" : "no"),
          );
          publishAssistantContext("agent-analysis");
        } catch (error) {
          const message = error instanceof Error ? error.message : "Failed to call AWS agent";
          document.getElementById("agentTranscript").textContent =
            "The cost analysis service is not reachable from this session yet. " + message;
          updateAgentProgress("error", "Live run failed", message);
          setDashboardStatus("error", "Update failed", message);
          publishAssistantContext("agent-unavailable");
        } finally {
          setRunButtonBusy(false);
        }
      }

      async function saveCachedDashboard(agentId, dashboardKind, lookbackDays, analysis, content) {
        try {
          const response = await fetch("/api/agentic-apps/finops-cache", {
            method: "POST",
            headers: { "content-type": "application/json", accept: "application/json" },
            body: JSON.stringify({
              agentId,
              dashboardKind,
              lookbackDays,
              payload: analysis,
              lastAgentMessage: content,
            }),
          });
          if (response.ok) {
            const result = await response.json();
            state.runs = Array.isArray(result.data?.items)
              ? result.data.items
              : result.data?.item
                ? [result.data.item]
                : state.runs;
            renderRunHistory();
          }
        } catch {
          // Persistence failure should not block the live dashboard.
        }
      }

      function applyRun(run) {
        if (!run?.payload) return;
        state.analysis = normalizeCostExplorerPayload(run.payload);
        state.lastAgentMessage = run.lastAgentMessage || JSON.stringify(run.payload, null, 2);
        state.selectedService = "";
        state.selectedDate = "";
        renderFilters();
        renderAnalysis(state.analysis, state.lastAgentMessage);
        setDashboardStatus(
          "done",
          "Updated " + new Date(run.updatedAt || run.createdAt || Date.now()).toLocaleTimeString(),
          dashboardStatusDetail(run),
        );
      }

      function renderRunHistory() {
        const selector = document.getElementById("runHistory");
        if (!state.runs.length) {
          selector.innerHTML = '<option value="">No previous runs loaded yet</option>';
          return;
        }
        selector.innerHTML = state.runs.map((run, index) => {
          const payload = run.payload || {};
          const label = [
            index === 0 ? "Latest" : "Previous",
            new Date(run.updatedAt || run.createdAt).toLocaleString(),
            run.dashboardKind || "cost-overview",
            formatMoney(payload.totalCost, payload.currency || "USD"),
            (payload.rawCost || []).length + " rows",
          ].join(" • ");
          return '<option value="' + escapeAttribute(run.runId || String(index)) + '">' + escapeHtml(label) + '</option>';
        }).join("");
      }

      function loadSelectedRun() {
        const runId = document.getElementById("runHistory").value;
        const run = state.runs.find((item) => String(item.runId) === String(runId)) || state.runs[0];
        if (!run) return;
        applyRun(run);
        document.getElementById("agentTranscript").textContent =
          "Loaded saved run from " + new Date(run.updatedAt || run.createdAt).toLocaleString() + ".";
        publishAssistantContext("history-run");
      }

      function initializeActivityFeed() {
        document.getElementById("agentProgress").innerHTML = "";
        document.getElementById("debugProgress").innerHTML = "";
        document.getElementById("debugEventCount").textContent = "0";
        state.activityEventCount = 0;
        state.debugEventCount = 0;
        updateActivitySummary("Starting live FinOps run...");
        renderMarkdownReport(document.getElementById("streamedContent"), "");
        setRunStatus("active", "Starting");
      }

      function updateAgentProgress(step, label, detail = "") {
        const status = step === "done" ? "done" : step === "error" ? "error" : "active";
        if (status === "done") {
          setRunStatus("done", "Complete");
        } else if (status === "error") {
          setRunStatus("error", "Needs attention");
        } else if (step === "tool-start") {
          setRunStatus("active", "Using tool");
        } else if (step === "stream-done") {
          setRunStatus("active", "Rendering");
        } else {
          setRunStatus("active", "Running");
        }
        appendActivityEvent(step, label || step, detail, status);
      }

      function appendActivityEvent(step, label, detail = "", status = "active", options = {}) {
        const isDebug = options.debug === true;
        const list = document.getElementById(isDebug ? "debugProgress" : "agentProgress");
        const item = document.createElement("li");
        item.dataset.step = step;
        item.className = status === "error" ? "error" : status === "done" ? "done" : "active";
        const icon = document.createElement("span");
        icon.className = "activity-icon";
        icon.setAttribute("aria-hidden", "true");
        if (status === "active") {
          const spinner = document.createElement("span");
          spinner.className = "activity-spinner";
          icon.replaceChildren(spinner);
        } else {
          icon.textContent = status === "done" ? "✓" : "!";
        }
        const content = document.createElement("span");
        content.className = "activity-content";
        const time = document.createElement("span");
        time.className = "activity-time";
        time.textContent = new Date().toLocaleTimeString();
        const text = document.createElement("span");
        text.textContent = label;
        content.append(time, text);
        if (detail) {
          const detailNode = document.createElement("span");
          detailNode.className = "activity-detail";
          detailNode.textContent = detail;
          content.append(detailNode);
        }
        item.append(icon, content);
        list.prepend(item);
        if (isDebug) {
          state.debugEventCount += 1;
          document.getElementById("debugEventCount").textContent = String(state.debugEventCount);
        } else {
          state.activityEventCount += 1;
        }
        updateActivitySummary(buildActivitySummary(status));
      }

      function setRunStatus(status, label) {
        const node = document.getElementById("runStatus");
        node.className = "run-status " + status;
        const dot = document.createElement("span");
        dot.className = "status-dot";
        dot.setAttribute("aria-hidden", "true");
        node.replaceChildren(dot, document.createTextNode(label));
      }

      function setDashboardStatus(status, label, detail = "") {
        const node = document.getElementById("dashboardStatus");
        node.className = "run-status dashboard-status " + status;
        node.title = detail || label;
        const dot = document.createElement("span");
        dot.className = "status-dot";
        dot.setAttribute("aria-hidden", "true");
        node.replaceChildren(dot, document.createTextNode(label));
      }

      function updateActivitySummary(text) {
        document.getElementById("activitySummary").textContent = text;
      }

      function buildActivitySummary(status) {
        const visible = state.activityEventCount + " event" + (state.activityEventCount === 1 ? "" : "s");
        const debug = state.debugEventCount ? " • " + state.debugEventCount + " debug" : "";
        if (status === "error") return "Needs attention • " + visible + debug;
        if (status === "done") return "Last run activity • " + visible + debug;
        return "Streaming live activity • " + visible + debug;
      }

      function setRunButtonBusy(isBusy) {
        const button = document.getElementById("runAnalysis");
        if (!button.dataset.defaultLabel) {
          button.dataset.defaultLabel = button.textContent || "Run AWS Cost Explorer analysis";
        }
        button.disabled = isBusy;
        button.textContent = isBusy ? "Running live analysis..." : button.dataset.defaultLabel;
      }

      function applyFontPreferences(preferences = readFontPreferences()) {
        const families = {
          inter: 'Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
          system: 'ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
          mono: '"SFMono-Regular", Consolas, "Liberation Mono", monospace',
          serif: 'Georgia, "Times New Roman", serif',
        };
        const scales = { small: "0.8", default: "0.92", large: "1.05", xl: "1.2" };
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
        try {
          return JSON.parse(localStorage.getItem(fontStorageKey) || "{}");
        } catch {
          return {};
        }
      }

      function writeFontPreferences() {
        const preferences = {
          family: fontFamilySelect.value,
          scale: fontScaleSelect.value,
        };
        try {
          localStorage.setItem(fontStorageKey, JSON.stringify(preferences));
        } catch {}
        applyFontPreferences(preferences);
      }

      function appendStreamContent(chunk) {
        if (!chunk) return;
        setRunStatus("active", "Streaming");
        const target = document.getElementById("streamedContent");
        const nextContent = (target.dataset.markdown || "") + chunk;
        renderMarkdownReport(target, nextContent);
        target.scrollTop = target.scrollHeight;
      }

      async function consumeAgentStream(response) {
        if (!response.body) {
          throw new Error("The CAIPE stream response did not include a readable body.");
        }
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        const streamState = {
          content: "",
          structuredOutput: null,
          structuredOutputSchemaId: "",
          toolNames: {},
          debugTools: {},
        };
        let buffer = "";

        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            buffer += decoder.decode(value, { stream: true });
            const frames = buffer.split("\\n\\n");
            buffer = frames.pop() || "";
            for (const frameText of frames) {
              const frame = parseSseFrame(frameText);
              if (frame) {
                handleStreamEvent(frame, streamState);
              }
            }
          }
          if (buffer.trim()) {
            const frame = parseSseFrame(buffer);
            if (frame) {
              handleStreamEvent(frame, streamState);
            }
          }
        } finally {
          reader.releaseLock();
        }

        return streamState;
      }

      function parseSseFrame(frameText) {
        if (!frameText.trim()) return null;
        let event = "message";
        const data = [];
        for (const line of frameText.split("\\n")) {
          if (line.startsWith("event: ")) {
            event = line.slice(7).trim();
          } else if (line.startsWith("data: ")) {
            data.push(line.slice(6));
          } else if (line.startsWith("data:")) {
            data.push(line.slice(5));
          }
        }
        return { event, data: data.join("\\n") };
      }

      function handleStreamEvent(frame, streamState) {
        const payload = parseJson(frame.data, {});
        if (frame.event === "content") {
          const text = payload.text || "";
          streamState.content += text;
          appendStreamContent(text);
          return;
        }
        if (frame.event === "tool_start") {
          const toolName = payload.tool_name || "tool";
          const toolCallId = payload.tool_call_id || "";
          const debug = isDebugTool(toolName);
          if (toolCallId) {
            streamState.toolNames[toolCallId] = toolName;
            streamState.debugTools[toolCallId] = debug;
          }
          const detail = toolName === "aws_cli_execute"
            ? "Reading AWS Cost Explorer rows."
            : summarizeToolArgs(payload.args);
          if (!debug) {
            setRunStatus("active", "Using tool");
          }
          appendActivityEvent("tool-start", "Calling " + toolName, detail, "active", { debug });
          return;
        }
        if (frame.event === "tool_end") {
          const toolCallId = payload.tool_call_id || "";
          const debug = Boolean(streamState.debugTools[toolCallId]);
          const toolName = streamState.toolNames[toolCallId] || "tool";
          setRunStatus("active", "Streaming");
          appendActivityEvent(
            "tool-end",
            payload.error ? toolName + " failed" : toolName + " completed",
            payload.error || "CAIPE returned the tool result to the agent.",
            payload.error ? "error" : "done",
            { debug },
          );
          return;
        }
        if (frame.event === "structured_output") {
          streamState.structuredOutput = payload.payload || null;
          streamState.structuredOutputSchemaId = payload.schema_id || "";
          setRunStatus("active", "Rendering");
          appendActivityEvent(
            "structured-output",
            "Received structured dashboard output",
            payload.schema_id || "Schema id not provided.",
            "done",
          );
          return;
        }
        if (frame.event === "warning") {
          setRunStatus("error", "Warning");
          appendActivityEvent("warning", "Agent warning", payload.message || "Non-fatal stream warning.", "error");
          return;
        }
        if (frame.event === "error") {
          setRunStatus("error", "Failed");
          appendActivityEvent("error", "Agent stream failed", payload.error || "Unknown stream error.", "error");
          throw new Error(payload.error || "Agent stream failed.");
        }
        if (frame.event === "done") {
          setRunStatus("active", "Rendering");
          appendActivityEvent("stream-done", "Agent stream finished", "Waiting for dashboard render.", "done");
        }
      }

      function parseJson(value, fallback) {
        try {
          return JSON.parse(value);
        } catch {
          return fallback;
        }
      }

      function summarizeToolArgs(args) {
        if (!args || typeof args !== "object") return "";
        const command = args.command || args.cli_command || "";
        const region = args.region ? "region=" + args.region : "";
        return [command, region].filter(Boolean).join(" • ").slice(0, 220);
      }

      function isDebugTool(toolName) {
        return new Set(["glob", "grep", "ls", "read", "read_file", "task"]).has(String(toolName || "").toLowerCase());
      }

      function dashboardStatusDetail(run) {
        const payload = run?.payload || {};
        return [
          "Agent: " + (run?.agentId || document.getElementById("agentId").value.trim() || ${JSON.stringify(defaultAgentId)}),
          "Data: AWS Cost Explorer",
          "Dashboard: " + (run?.dashboardKind || document.getElementById("dashboardKind").value || ${JSON.stringify(defaultDashboardKind)}),
          "Services: " + ((payload.services || []).length || 0),
          "Trend points: " + ((payload.trend || []).length || 0),
          "Raw rows: " + ((payload.rawCost || []).length || 0),
          "Structured output: " + (payload.status === "structured" || payload.totalCost !== undefined ? "yes" : "unknown"),
        ].join("\\n");
      }

      function clearFilters() {
        state.selectedService = "";
        state.selectedDate = "";
        renderFilters();
        if (state.analysis) {
          renderServiceRows(state.analysis.services, state.analysis.currency);
          renderRawCostRows(state.analysis.rawCost, state.analysis.currency);
        }
      }

      function renderFilters() {
        document.getElementById("selectedServiceLabel").textContent = "Service: " + (state.selectedService || "All");
        document.getElementById("selectedDateLabel").textContent = "Date: " + (state.selectedDate || "All");
      }

      function selectService(serviceName) {
        state.selectedService = state.selectedService === serviceName ? "" : serviceName;
        renderFilters();
        if (state.analysis) {
          renderServiceRows(state.analysis.services, state.analysis.currency);
          renderRawCostRows(state.analysis.rawCost, state.analysis.currency);
          publishAssistantContext("service-filter");
        }
      }

      function selectTrendDate(date) {
        state.selectedDate = state.selectedDate === date ? "" : date;
        renderFilters();
        if (state.analysis) {
          renderRawCostRows(state.analysis.rawCost, state.analysis.currency);
          publishAssistantContext("trend-filter");
        }
      }

      function normalizeCostExplorerPayload(json) {
        return {
          status: "structured",
          currency: String(json.currency || "USD"),
          totalCost: numberOrNull(json.totalCost),
          forecastCost: numberOrNull(json.forecastCost),
          services: Array.isArray(json.services)
            ? json.services.map((item) => ({
                name: String(item.name || "Unknown service"),
                amount: numberOrNull(item.amount) ?? 0,
              })).filter((item) => item.amount > 0)
            : [],
          trend: Array.isArray(json.trend)
            ? json.trend.map((item) => ({
                date: String(item.date || ""),
                amount: numberOrNull(item.amount) ?? 0,
              })).filter((item) => item.date && item.amount >= 0)
            : [],
          rawCost: Array.isArray(json.rawCost)
            ? json.rawCost.map((item) => ({
                date: String(item.date || ""),
                service: String(item.service || "Unknown service"),
                account: String(item.account || ""),
                amount: numberOrNull(item.amount) ?? 0,
                unit: String(item.unit || json.currency || "USD"),
              })).filter((item) => item.date && item.amount >= 0)
            : [],
          anomalies: Array.isArray(json.anomalies) ? json.anomalies : [],
          recommendations: Array.isArray(json.recommendations) ? json.recommendations.map(String) : [],
        };
      }

      function renderAnalysis(analysis, content) {
        renderKpiStrip(analysis);
        renderInsightsStrip(analysis);

        renderMarkdownReport(document.getElementById("agentTranscript"), content);
        renderFilters();
        renderCostChart(analysis.services, analysis.currency);
        renderServiceRows(analysis.services, analysis.currency);
        renderTrendChart(analysis.trend, analysis.currency);
        renderDayOfWeekHeatmap(analysis.trend, analysis.currency);
        renderTopMovers(analysis.trend, analysis.services, analysis.currency);
        renderRawCostRows(analysis.rawCost, analysis.currency);

        const recommendations = document.getElementById("recommendations");
        const recs = analysis.recommendations.length
          ? analysis.recommendations
          : ["No recommendations returned in the latest cost pull."];
        const anomalies = analysis.anomalies.map((item) =>
          "Anomaly: " + (item.service || "unknown") + " " + formatMoney(item.impact, analysis.currency) + " — " + (item.explanation || "No explanation provided."),
        );
        recommendations.textContent = [...anomalies, ...recs].join("\\n\\n");
      }

      function renderKpiStrip(analysis) {
        const currency = analysis.currency;
        const trend = Array.isArray(analysis.trend) ? analysis.trend : [];

        document.getElementById("kpiTotal").textContent = formatMoney(analysis.totalCost, currency);
        document.getElementById("kpiTotalSub").textContent =
          analysis.services.length + " services · " + analysis.rawCost.length + " rows";

        document.getElementById("kpiForecast").textContent = formatMoney(analysis.forecastCost, currency);
        const forecastDelta = numberOrNull(analysis.forecastCost) !== null && numberOrNull(analysis.totalCost) !== null
          ? Number(analysis.forecastCost) - Number(analysis.totalCost)
          : null;
        document.getElementById("kpiForecastSub").textContent = forecastDelta === null
          ? "Projected total"
          : (forecastDelta >= 0 ? "+" : "") + formatMoney(forecastDelta, currency) + " projected change";

        const deltaEl = document.getElementById("kpiDelta");
        const deltaSubEl = document.getElementById("kpiDeltaSub");
        if (trend.length >= 2) {
          const last = trend[trend.length - 1].amount;
          const prev = trend[trend.length - 2].amount;
          const diff = last - prev;
          const pct = prev > 0 ? (diff / prev) * 100 : 0;
          const dir = diff > 0 ? "up" : diff < 0 ? "down" : "flat";
          const arrow = diff > 0 ? "▲" : diff < 0 ? "▼" : "•";
          deltaEl.innerHTML = '<span class="kpi-delta ' + dir + '">' + arrow + " " + Math.abs(pct).toFixed(1) + "%</span>";
          deltaSubEl.textContent = formatMoney(diff, currency) + " vs prior day";
        } else {
          deltaEl.textContent = "—";
          deltaSubEl.textContent = "Needs ≥2 trend points";
        }

        const top = analysis.services[0];
        document.getElementById("kpiTopService").textContent = top ? top.name : "—";
        document.getElementById("kpiTopServiceSub").textContent = top
          ? formatMoney(top.amount, currency) + (analysis.totalCost ? " · " + Math.round((top.amount / analysis.totalCost) * 100) + "% of total" : "")
          : "No data";

        const anomalyCount = analysis.anomalies.length;
        document.getElementById("kpiAnomalies").textContent = String(anomalyCount);
        document.getElementById("kpiAnomaliesSub").textContent = anomalyCount === 0
          ? "No alerts"
          : (anomalyCount === 1 ? "1 alert" : anomalyCount + " alerts") + " to review";

        const recCount = analysis.recommendations.length;
        document.getElementById("kpiRecs").textContent = String(recCount);
        document.getElementById("kpiRecsSub").textContent = recCount === 0
          ? "No recommendations"
          : (recCount === 1 ? "1 signal" : recCount + " signals");

        renderSparkline(document.getElementById("kpiSpark"), trend.map((p) => Number(p.amount) || 0));
      }

      function renderSparkline(svg, values) {
        if (!svg) return;
        svg.replaceChildren();
        if (!values || values.length < 2) return;
        const w = 90;
        const h = 30;
        const min = Math.min(...values);
        const max = Math.max(...values);
        const spread = Math.max(1, max - min);
        const step = w / (values.length - 1);
        const points = values.map((v, i) => i * step + "," + (h - ((v - min) / spread) * (h - 4) - 2).toFixed(1));
        const last = values[values.length - 1];
        const first = values[0];
        const rising = last >= first;
        const stroke = rising ? "#fca5a5" : "#86efac";
        svg.innerHTML =
          '<polyline fill="none" stroke="' + stroke + '" stroke-width="1.5" stroke-linejoin="round" stroke-linecap="round" points="' + points.join(" ") + '"/>' +
          '<polyline fill="' + stroke + '" fill-opacity="0.12" stroke="none" points="0,' + h + ' ' + points.join(" ") + ' ' + w + ',' + h + '"/>';
      }

      function renderInsightsStrip(analysis) {
        const strip = document.getElementById("insightsStrip");
        if (!strip) return;
        const currency = analysis.currency;
        const insights = [];

        const trend = analysis.trend || [];
        if (trend.length >= 2) {
          let biggest = { delta: 0, date: "", from: 0, to: 0 };
          for (let i = 1; i < trend.length; i += 1) {
            const diff = trend[i].amount - trend[i - 1].amount;
            if (Math.abs(diff) > Math.abs(biggest.delta)) {
              biggest = { delta: diff, date: trend[i].date, from: trend[i - 1].amount, to: trend[i].amount };
            }
          }
          if (biggest.date) {
            const arrow = biggest.delta > 0 ? "▲" : "▼";
            const dir = biggest.delta > 0 ? "spike" : "drop";
            insights.push({
              icon: biggest.delta > 0 ? "🚨" : "✅",
              text: "<strong>" + arrow + " " + formatMoney(Math.abs(biggest.delta), currency) + " " + dir + "</strong>",
              sub: "on " + biggest.date,
            });
          }
        }

        if (analysis.services.length >= 2) {
          const top = analysis.services[0];
          const second = analysis.services[1];
          const share = analysis.totalCost ? Math.round((top.amount / analysis.totalCost) * 100) : 0;
          insights.push({
            icon: "🏆",
            text: "<strong>" + escapeHtml(top.name) + "</strong> leads at " + share + "%",
            sub: "Next: " + escapeHtml(second.name) + " · " + formatMoney(second.amount, currency),
          });
        }

        const topAnomaly = analysis.anomalies.find((a) => a && (a.service || a.explanation));
        if (topAnomaly) {
          insights.push({
            icon: "⚠️",
            text: "<strong>" + escapeHtml(topAnomaly.service || "Anomaly") + "</strong> " + (Number.isFinite(Number(topAnomaly.impact)) ? formatMoney(topAnomaly.impact, currency) : ""),
            sub: (topAnomaly.explanation || "Review with Ask FinOps").slice(0, 80),
          });
        }

        if (analysis.recommendations.length) {
          insights.push({
            icon: "💡",
            text: "<strong>" + analysis.recommendations.length + " optimization " + (analysis.recommendations.length === 1 ? "signal" : "signals") + "</strong>",
            sub: String(analysis.recommendations[0]).slice(0, 80),
          });
        }

        if (!insights.length) {
          strip.innerHTML = '<div class="insight"><span class="insight-icon">📊</span><span class="insight-text"><strong>Run the agent</strong><small>Insights appear here at a glance once data lands.</small></span></div>';
          return;
        }

        strip.innerHTML = insights.map((i) =>
          '<div class="insight"><span class="insight-icon">' + i.icon + '</span><span class="insight-text">' + i.text + '<small>' + escapeHtml(i.sub || "") + '</small></span></div>'
        ).join("");
      }

      function renderCostChart(services, currency) {
        const chart = document.getElementById("costChart");
        chart.replaceChildren();
        if (!services.length) {
          chart.innerHTML = '<text x="20" y="108" fill="#64748b" font-size="13">Run a cost pull to populate service spend.</text>';
          return;
        }
        const max = Math.max(...services.map((service) => service.amount), 1);
        chart.innerHTML = services.slice(0, 6).map((service, index) => {
          const y = 12 + index * 32;
          const width = Math.max(6, (service.amount / max) * 480);
          return '<g data-service="' + escapeAttribute(service.name) + '" style="cursor:pointer;">' +
            '<rect x="200" y="' + y + '" width="' + width.toFixed(1) + '" height="20" rx="6" fill="url(#finopsGlow)"></rect>' +
            '<text x="14" y="' + (y + 14) + '" fill="#cbd5e1" font-size="13">' + escapeHtml(service.name.slice(0, 22)) + '</text>' +
            '<text x="' + (210 + width).toFixed(1) + '" y="' + (y + 14) + '" fill="#86efac" font-size="13" font-weight="700">' + escapeHtml(formatMoney(service.amount, currency)) + '</text>' +
            '</g>';
        }).join("") + '<defs><linearGradient id="finopsGlow" x1="0" x2="1"><stop offset="0%" stop-color="#34d399"/><stop offset="100%" stop-color="#38bdf8"/></linearGradient></defs>';
        chart.querySelectorAll("[data-service]").forEach((node) => {
          node.addEventListener("click", () => selectService(node.getAttribute("data-service") || ""));
        });
      }

      function renderTrendChart(trend, currency) {
        const chart = document.getElementById("trendChart");
        chart.replaceChildren();
        const summary = document.getElementById("trendSummary");
        if (!trend.length) {
          chart.innerHTML = '<text x="20" y="108" fill="#64748b" font-size="13">Run a cost pull to populate daily trend.</text>';
          if (summary) summary.textContent = "Run analysis to see daily spend.";
          return;
        }
        const amounts = trend.map((point) => Number(point.amount) || 0);
        // Auto-zoom: anchor to actual data range with a small headroom so flat lines aren't squashed.
        const dataMin = Math.min(...amounts);
        const dataMax = Math.max(...amounts);
        const range = Math.max(1, dataMax - dataMin);
        const pad = range * 0.15;
        const yMin = Math.max(0, dataMin - pad);
        const yMax = dataMax + pad;
        const spread = Math.max(1, yMax - yMin);
        const innerW = 700;
        const offsetX = 30;
        const top = 22;
        const innerH = 168;
        const xStep = innerW / Math.max(1, trend.length - 1);

        // Rolling 7-day average (centered when possible).
        const avg = amounts.map((_, i) => {
          const start = Math.max(0, i - 6);
          const slice = amounts.slice(start, i + 1);
          return slice.reduce((a, b) => a + b, 0) / slice.length;
        });

        const pts = trend.map((point, index) => {
          const x = offsetX + index * xStep;
          const y = top + innerH - ((amounts[index] - yMin) / spread) * innerH;
          const ay = top + innerH - ((avg[index] - yMin) / spread) * innerH;
          return { x, y, ay, point };
        });
        const linePath = pts.map((p, index) => (index === 0 ? "M" : "L") + p.x.toFixed(1) + " " + p.y.toFixed(1)).join(" ");
        const avgPath = pts.map((p, index) => (index === 0 ? "M" : "L") + p.x.toFixed(1) + " " + p.ay.toFixed(1)).join(" ");
        const areaPath = linePath + " L" + pts[pts.length - 1].x.toFixed(1) + " " + (top + innerH) + " L" + offsetX + " " + (top + innerH) + " Z";

        // Y-axis gridlines (4 ticks).
        const ticks = 4;
        const gridLines = [];
        for (let i = 0; i <= ticks; i += 1) {
          const t = yMin + (spread * i) / ticks;
          const y = top + innerH - ((t - yMin) / spread) * innerH;
          gridLines.push(
            '<line x1="' + offsetX + '" x2="' + (offsetX + innerW) + '" y1="' + y.toFixed(1) + '" y2="' + y.toFixed(1) + '" stroke="rgba(148,163,184,0.10)" stroke-dasharray="2,3"/>' +
            '<text x="' + (offsetX + innerW + 4) + '" y="' + (y + 3).toFixed(1) + '" fill="#475569" font-size="9">' + escapeHtml(formatMoney(t, currency)) + '</text>'
          );
        }

        chart.innerHTML =
          '<defs>' +
          '<linearGradient id="trendGlow" x1="0" x2="1"><stop offset="0%" stop-color="#22c55e"/><stop offset="100%" stop-color="#0ea5e9"/></linearGradient>' +
          '<linearGradient id="trendFill" x1="0" x2="0" y1="0" y2="1"><stop offset="0%" stop-color="#22c55e" stop-opacity="0.20"/><stop offset="100%" stop-color="#0ea5e9" stop-opacity="0"/></linearGradient>' +
          '</defs>' +
          gridLines.join("") +
          '<path d="' + areaPath + '" fill="url(#trendFill)" stroke="none"/>' +
          '<path d="' + avgPath + '" fill="none" stroke="#fbbf24" stroke-width="1.4" stroke-dasharray="4,3" stroke-linecap="round"/>' +
          '<path d="' + linePath + '" fill="none" stroke="url(#trendGlow)" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>' +
          pts.map((p) => '<circle data-date="' + escapeAttribute(p.point.date) + '" cx="' + p.x.toFixed(1) + '" cy="' + p.y.toFixed(1) + '" r="3" fill="#bbf7d0" style="cursor:pointer;"><title>' + escapeHtml(p.point.date + ": " + formatMoney(amounts[pts.indexOf(p)], currency)) + '</title></circle>').join("");

        chart.querySelectorAll("[data-date]").forEach((node) => {
          node.addEventListener("click", () => selectTrendDate(node.getAttribute("data-date") || ""));
        });

        if (summary) {
          const total = amounts.reduce((a, b) => a + b, 0);
          const mean = total / amounts.length;
          summary.innerHTML =
            "<strong>" + escapeHtml(formatMoney(total, currency)) + "</strong> across " + amounts.length + " days · " +
            "avg <strong>" + escapeHtml(formatMoney(mean, currency)) + "</strong>/day · " +
            "range " + escapeHtml(formatMoney(dataMin, currency)) + " – " + escapeHtml(formatMoney(dataMax, currency));
        }
      }

      function renderDayOfWeekHeatmap(trend, currency) {
        const grid = document.getElementById("dowGrid");
        const summary = document.getElementById("dowSummary");
        if (!grid) return;
        if (!trend || !trend.length) {
          grid.innerHTML = '<div class="row" style="grid-column: 1 / -1;">No trend data yet.</div>';
          if (summary) summary.textContent = "Spot which weekdays drive cost.";
          return;
        }
        const parsed = trend
          .map((p) => {
            const d = new Date(p.date + "T00:00:00Z");
            if (Number.isNaN(d.getTime())) return null;
            return { date: p.date, amount: Number(p.amount) || 0, day: d.getUTCDay(), iso: d };
          })
          .filter(Boolean);
        if (!parsed.length) {
          grid.innerHTML = '<div class="row" style="grid-column: 1 / -1;">Trend dates could not be parsed.</div>';
          return;
        }
        // Bucket into ISO weeks for rows.
        function weekKey(d) {
          const monday = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
          const day = (monday.getUTCDay() + 6) % 7;
          monday.setUTCDate(monday.getUTCDate() - day);
          return monday.toISOString().slice(0, 10);
        }
        const weeks = new Map();
        for (const p of parsed) {
          const wk = weekKey(p.iso);
          if (!weeks.has(wk)) weeks.set(wk, new Map());
          weeks.get(wk).set(p.day, p);
        }
        const orderedWeeks = [...weeks.keys()].sort();
        const max = Math.max(...parsed.map((p) => p.amount), 1);
        const min = Math.min(...parsed.map((p) => p.amount), 0);
        const spread = Math.max(1, max - min);
        const labels = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
        const dayIdx = [1, 2, 3, 4, 5, 6, 0];

        const cells = [];
        // Header row.
        cells.push('<div class="dow-label"></div>');
        labels.forEach((l) => cells.push('<div class="dow-label" style="text-align:center;">' + l + '</div>'));
        // Body rows.
        orderedWeeks.slice(-6).forEach((wk) => {
          const wkDate = new Date(wk + "T00:00:00Z");
          const label = (wkDate.getUTCMonth() + 1) + "/" + wkDate.getUTCDate();
          cells.push('<div class="dow-label">' + label + '</div>');
          dayIdx.forEach((d) => {
            const point = weeks.get(wk).get(d);
            if (!point) {
              cells.push('<div class="dow-cell empty">·</div>');
              return;
            }
            const intensity = (point.amount - min) / spread;
            const r = Math.round(34 + intensity * 200);
            const g = Math.round(197 - intensity * 90);
            const b = Math.round(94 + intensity * 30);
            const bg = "rgba(" + r + "," + g + "," + b + "," + (0.15 + intensity * 0.55).toFixed(2) + ")";
            cells.push(
              '<div class="dow-cell" style="background:' + bg + ';" title="' + escapeAttribute(point.date + ": " + formatMoney(point.amount, currency)) + '">' +
                '<span class="dow-cell-value">' + escapeHtml(formatMoneyShort(point.amount, currency)) + '</span>' +
              '</div>'
            );
          });
        });
        grid.innerHTML = cells.join("");

        // Day-of-week aggregation summary.
        const dayTotals = new Map();
        for (const p of parsed) {
          const cur = dayTotals.get(p.day) || { total: 0, count: 0 };
          cur.total += p.amount;
          cur.count += 1;
          dayTotals.set(p.day, cur);
        }
        let topDay = null;
        let topAvg = -Infinity;
        for (const [day, { total, count }] of dayTotals) {
          const avg = total / count;
          if (avg > topAvg) {
            topAvg = avg;
            topDay = day;
          }
        }
        const dayNames = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
        if (summary && topDay !== null) {
          summary.innerHTML = "<strong>" + dayNames[topDay] + "s</strong> average <strong>" + escapeHtml(formatMoney(topAvg, currency)) + "</strong>/day — your priciest weekday.";
        }
      }

      function renderTopMovers(trend, services, currency) {
        const container = document.getElementById("topMovers");
        const summary = document.getElementById("moversSummary");
        if (!container) return;
        // Compare first half vs second half of trend to compute period delta.
        if (!trend || trend.length < 2) {
          // Fall back to top services as bare absolute amounts.
          if (services && services.length) {
            container.innerHTML = services.slice(0, 5).map((s, i) =>
              '<div class="top-mover"><span class="mover-name">' + escapeHtml(s.name) + '</span>' +
              '<span class="mover-bar"><span class="mover-bar-fill" style="background:#86efac; left: 0; width: ' + Math.min(100, ((s.amount / services[0].amount) * 100)) + '%; transform: none;"></span></span>' +
              '<span class="mover-delta">' + escapeHtml(formatMoney(s.amount, currency)) + '</span></div>'
            ).join("");
            if (summary) summary.textContent = "Need ≥2 trend points for period delta — showing absolute spend.";
          } else {
            container.innerHTML = '<div class="row">No mover data yet.</div>';
          }
          return;
        }
        const half = Math.floor(trend.length / 2);
        const first = trend.slice(0, half);
        const second = trend.slice(half);
        const sumFirst = first.reduce((a, b) => a + (Number(b.amount) || 0), 0);
        const sumSecond = second.reduce((a, b) => a + (Number(b.amount) || 0), 0);
        const totalDelta = sumSecond - sumFirst;
        const totalPct = sumFirst > 0 ? (totalDelta / sumFirst) * 100 : 0;

        // Without per-service daily data we can only show overall mover + top services proportionally.
        const items = [];
        items.push({
          name: "Total spend (period over period)",
          delta: totalDelta,
          pct: totalPct,
          baseline: sumFirst,
        });
        // Approximate per-service movers by sharing total delta proportional to current service mix.
        if (services && services.length) {
          const totalCur = services.reduce((a, b) => a + (Number(b.amount) || 0), 0) || 1;
          services.slice(0, 4).forEach((s) => {
            const share = s.amount / totalCur;
            const sDelta = totalDelta * share;
            const sBaseline = Math.max(1, sumFirst * share);
            items.push({
              name: s.name,
              delta: sDelta,
              pct: (sDelta / sBaseline) * 100,
              baseline: sBaseline,
            });
          });
        }
        // Sort by absolute delta.
        items.sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta));
        const maxAbs = Math.max(...items.map((i) => Math.abs(i.delta)), 1);
        container.innerHTML = items.slice(0, 5).map((m) => {
          const dir = m.delta > 0 ? "up" : "down";
          const arrow = m.delta > 0 ? "▲" : m.delta < 0 ? "▼" : "•";
          const w = (Math.abs(m.delta) / maxAbs) * 50;
          const color = m.delta > 0 ? "#f87171" : "#34d399";
          const offset = m.delta > 0 ? "left:50%;" : "left:" + (50 - w) + "%;";
          return '<div class="top-mover">' +
            '<span class="mover-name">' + escapeHtml(m.name) + '</span>' +
            '<span class="mover-bar"><span class="mover-bar-fill" style="background:' + color + ';' + offset + 'width:' + w.toFixed(1) + '%;"></span></span>' +
            '<span class="mover-delta ' + dir + '">' + arrow + ' ' + escapeHtml(formatMoney(Math.abs(m.delta), currency)) + ' <small style="opacity:0.75;">(' + (m.pct >= 0 ? "+" : "") + m.pct.toFixed(1) + '%)</small></span>' +
          '</div>';
        }).join("");
        if (summary) {
          const dirTxt = totalDelta > 0 ? "up" : totalDelta < 0 ? "down" : "flat";
          summary.innerHTML = "Second half is <strong>" + dirTxt + "</strong> " +
            escapeHtml(formatMoney(Math.abs(totalDelta), currency)) +
            " (" + (totalPct >= 0 ? "+" : "") + totalPct.toFixed(1) + "%) vs first half.";
        }
      }

      function formatMoneyShort(value, currency) {
        const n = Number(value);
        if (!Number.isFinite(n)) return "—";
        const abs = Math.abs(n);
        if (abs >= 1e6) return (n / 1e6).toFixed(1) + "M";
        if (abs >= 1e3) return Math.round(n / 1e3) + "k";
        return Math.round(n).toString();
      }

      function renderServiceRows(services, currency) {
        const rows = document.getElementById("serviceRows");
        rows.replaceChildren(...services.slice(0, 8).map((service) => {
          const node = document.createElement("button");
          node.type = "button";
          node.className = "row interactive-row" + (state.selectedService === service.name ? " active" : "");
          node.innerHTML = "<span>" + escapeHtml(service.name) + "</span><strong>" + escapeHtml(formatMoney(service.amount, currency)) + "</strong>";
          node.addEventListener("click", () => selectService(service.name));
          return node;
        }));
      }

      function renderRawCostRows(rawCost, currency) {
        const rows = document.getElementById("rawRows");
        const filtered = rawCost.filter((item) =>
          (!state.selectedService || item.service === state.selectedService) &&
          (!state.selectedDate || item.date === state.selectedDate)
        );
        if (!filtered.length) {
          rows.textContent = "Run a cost pull to populate raw Cost Explorer rows.";
          return;
        }
        rows.replaceChildren(...filtered.slice(0, 12).map((item) => {
          const node = document.createElement("div");
          node.className = "row";
          const account = item.account ? " • " + item.account : "";
          node.innerHTML = "<span>" + escapeHtml(item.date + " • " + item.service + account) + "</span><strong>" + escapeHtml(formatMoney(item.amount, item.unit || currency)) + "</strong>";
          return node;
        }));
      }

      function publishAssistantContext(source) {
        const analysis = state.analysis;
        const summary = analysis
          ? "FinOps Cost Explorer analysis: " + formatMoney(analysis.totalCost, analysis.currency) + " total, " + analysis.services.length + " service rows, " + analysis.trend.length + " trend points, " + analysis.rawCost.length + " raw rows."
          : "FinOps dashboard is ready to pull AWS Cost Explorer data.";
        const filteredContext = [
          state.selectedService ? "Selected service: " + state.selectedService : "",
          state.selectedDate ? "Selected date: " + state.selectedDate : "",
        ].filter(Boolean).join("\\n");
        window.parent?.postMessage({
          type: "caipe.agenticApp.context.v1",
          version: "1.0",
          appId: "finops",
          context: {
            route: basePath,
            title: "FinOps Command Center",
            summary,
            selection: (filteredContext + "\\n\\n" + state.lastAgentMessage).trim().slice(0, 3000),
            resourceRefs: [
              { kind: "agent", id: document.getElementById("agentId").value.trim() || ${JSON.stringify(defaultAgentId)} },
              { kind: "datasource", id: "aws-cost-explorer" },
            ],
            suggestedPrompts: [
              "Explain the biggest AWS cost drivers in this FinOps context.",
              "Draft optimization tasks for the top three savings opportunities.",
              "Which anomaly should a platform engineer investigate first?",
            ],
          },
        }, "*");
        document.getElementById("assistantStatus").textContent =
          "Shared current cost context from " + source + ".";
      }

      function openAssistantChat() {
        publishAssistantContext("chat-open");
        window.parent?.postMessage({
          type: "caipe.agenticApp.assistant.open.v1",
          version: "1.0",
          appId: "finops",
        }, "*");
        document.getElementById("assistantStatus").textContent =
          "Opened Ask FinOps with the current dashboard context.";
      }

      function card(label, value) {
        const node = document.createElement("div");
        node.className = "card";
        node.innerHTML = '<div class="label">' + escapeHtml(label) + '</div><div class="value">' + escapeHtml(value) + '</div>';
        return node;
      }

      function formatMoney(value, currency) {
        if (!Number.isFinite(Number(value))) return "Needs agent";
        return new Intl.NumberFormat("en-US", {
          style: "currency",
          currency: currency || "USD",
          maximumFractionDigits: 0,
        }).format(Number(value));
      }

      function numberOrNull(value) {
        const numeric = Number(value);
        return Number.isFinite(numeric) ? numeric : null;
      }

      function renderMarkdownReport(target, markdown) {
        const source = String(markdown || "");
        target.dataset.markdown = source;
        target.innerHTML = markdownToSafeHtml(source);
      }

      function markdownToSafeHtml(markdown) {
        const codeFence = String.fromCharCode(96, 96, 96);
        const lines = String(markdown).replaceAll("\\r\\n", "\\n").split("\\n");
        const html = [];
        let paragraph = [];
        let listType = "";
        let inCode = false;
        let codeLines = [];

        function flushParagraph() {
          if (!paragraph.length) return;
          html.push("<p>" + renderInlineMarkdown(paragraph.join(" ")) + "</p>");
          paragraph = [];
        }

        function flushList() {
          if (!listType) return;
          html.push("</" + listType + ">");
          listType = "";
        }

        for (const line of lines) {
          if (line.startsWith(codeFence)) {
            if (inCode) {
              html.push("<pre><code>" + escapeHtml(codeLines.join("\\n")) + "</code></pre>");
              codeLines = [];
              inCode = false;
            } else {
              flushParagraph();
              flushList();
              inCode = true;
            }
            continue;
          }

          if (inCode) {
            codeLines.push(line);
            continue;
          }

          const trimmed = line.trim();
          if (!trimmed) {
            flushParagraph();
            flushList();
            continue;
          }

          if (trimmed.startsWith("### ")) {
            flushParagraph();
            flushList();
            html.push("<h3>" + renderInlineMarkdown(trimmed.slice(4)) + "</h3>");
            continue;
          }

          if (trimmed.startsWith("## ")) {
            flushParagraph();
            flushList();
            html.push("<h2>" + renderInlineMarkdown(trimmed.slice(3)) + "</h2>");
            continue;
          }

          if (trimmed.startsWith("# ")) {
            flushParagraph();
            flushList();
            html.push("<h1>" + renderInlineMarkdown(trimmed.slice(2)) + "</h1>");
            continue;
          }

          if (trimmed.startsWith("- ") || trimmed.startsWith("* ")) {
            flushParagraph();
            if (listType !== "ul") {
              flushList();
              html.push("<ul>");
              listType = "ul";
            }
            html.push("<li>" + renderInlineMarkdown(trimmed.slice(2)) + "</li>");
            continue;
          }

          const orderedMatch = trimmed.match(/^\\d+\\.\\s+(.+)$/);
          if (orderedMatch) {
            flushParagraph();
            if (listType !== "ol") {
              flushList();
              html.push("<ol>");
              listType = "ol";
            }
            html.push("<li>" + renderInlineMarkdown(orderedMatch[1]) + "</li>");
            continue;
          }

          paragraph.push(trimmed);
        }

        if (inCode) {
          html.push("<pre><code>" + escapeHtml(codeLines.join("\\n")) + "</code></pre>");
        }
        flushParagraph();
        flushList();
        return html.join("") || '<p class="activity-detail">No report content yet.</p>';
      }

      function renderInlineMarkdown(value) {
        const codeTick = String.fromCharCode(96);
        const inlineCodePattern = new RegExp(codeTick + "([^" + codeTick + "]+)" + codeTick, "g");
        return escapeHtml(value)
          .replace(/\\[([^\\]]+)\\]\\((https?:\\/\\/[^\\s)]+)\\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>')
          .replace(/\\*\\*([^*]+)\\*\\*/g, "<strong>$1</strong>")
          .replace(inlineCodePattern, "<code>$1</code>");
      }

      function escapeHtml(value) {
        return String(value)
          .replaceAll("&", "&amp;")
          .replaceAll("<", "&lt;")
          .replaceAll(">", "&gt;")
          .replaceAll('"', "&quot;");
      }

      function escapeAttribute(value) {
        return escapeHtml(value).replaceAll("'", "&#39;");
      }
    </script>
  </body>
</html>`;
}

function sendJson(response, status, body) {
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
  });
  response.end(JSON.stringify(body));
}

function normalizeBasePath(value) {
  const trimmed = String(value || "").trim();
  if (!trimmed || trimmed === "/") return "/";
  return trimmed.startsWith("/") ? trimmed.replace(/\/+$/, "") : `/${trimmed.replace(/\/+$/, "")}`;
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}
