#!/usr/bin/env node

// assisted-by Codex Codex-sonnet-4-6
import { createServer } from "node:http";

import { createAgenticAppJwtVerifier } from "../../_lib/jwt-verify.mjs";

const port = Number(process.env.WEATHER_APP_PORT ?? "3020");
const basePath = normalizeBasePath(process.env.WEATHER_APP_BASE_PATH ?? "/apps/weather");
const defaultCity = "San Jose";
const defaultAgentId = process.env.WEATHER_AGENT_ID ?? "agent-weather-agent";
const verifier =
  process.env.AGENTIC_APP_WEATHER_JWT_DISABLED === "true"
    ? null
    : createAgenticAppJwtVerifier({ appId: "weather" });

const server = createServer(async (request, response) => {
  const url = new URL(request.url ?? "/", `http://${request.headers.host ?? "localhost"}`);

  if (url.pathname === "/healthz") {
    sendJson(response, 200, {
      ok: true,
      app: "weather",
      runtime: "separate-process",
      dataSource: "caipe-weather-agent",
      copilotKit: "embedded-caipe-agent-action-panel",
      agentId: defaultAgentId,
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

  if (url.pathname === "/api/copilotkit/weather-agent" && request.method === "POST") {
    try {
      const body = await readJsonBody(request);
      const city = normalizeCity(body?.city);
      const intent = normalizeIntent(body?.intent);
      const question = String(body?.question || "").trim();
      sendJson(response, 200, buildCopilotWeatherResponse(city, intent, question));
    } catch (error) {
      sendJson(response, 400, {
        error: "invalid_weather_agent_request",
        message: error instanceof Error ? error.message : "Could not run weather agent",
      });
    }
    return;
  }

  if (url.pathname === "/api/ag-ui/weather-layout") {
    const city = normalizeCity(url.searchParams.get("city"));
    sendJson(response, 200, buildAgUiWeatherEnvelope(buildAgentUnavailableWeatherDashboard(city), "forecast-summary"));
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
  console.log(`Weather Lab listening on http://localhost:${port}`);
  console.log(`Configure CAIPE with AGENTIC_APP_WEATHER_ORIGIN=http://localhost:${port}`);
});

function buildAgentUnavailableWeatherDashboard(city, reason = "No Weather structured output received from the CAIPE Weather agent") {
  return {
    source: "agent-unavailable",
    reason,
    city: normalizeCity(city),
    region: "",
    country: "",
    observedAt: new Date().toISOString(),
    current: {
      temperatureC: 0,
      apparentC: 0,
      humidity: 0,
      windKmh: 0,
      code: 0,
      condition: "Agent output pending",
    },
    daily: [],
    hourly: [],
    airQuality: {
      available: false,
      reason,
    },
    nationalWeatherAlerts: {
      available: false,
      reason,
      alerts: [],
    },
    dailyGuidance: {
      verdict: "Weather agent output pending",
      howIsMyDay: reason,
      riskSignals: ["Agent structured output required"],
    },
    recommendations: [
      "Verify the CAIPE Weather agent is reachable and has the structured response middleware enabled.",
      "Confirm the agent prompt requests weather.dashboard.v1 before the final answer.",
    ],
  };
}

function buildCopilotWeatherResponse(city, intent, question = "") {
  const forecast = buildAgentUnavailableWeatherDashboard(city);
  return {
    message: [
      forecast.dailyGuidance.howIsMyDay,
      question ? `Question: ${question}` : "",
      `Recommendation: ${forecast.recommendations[0]}`,
    ].filter(Boolean).join(" "),
    intent,
    forecast,
    agUi: buildAgUiWeatherEnvelope(forecast, intent),
    copilotKit: {
      pattern: "useCopilotAction",
      actionName: "renderWeatherInsight",
      status: "agent-unavailable",
    },
  };
}

function buildAgUiWeatherEnvelope(forecast, intent) {
  const runId = `weather-${Date.now()}`;
  return {
    protocol: "ag-ui",
    version: "1.0",
    runId,
    intent,
    generatedBy: {
      agentId: "weather-agent",
      copilotKitPrimitive: "useCopilotAction",
      actionName: "renderWeatherInsight",
    },
    events: [
      { type: "RUN_STARTED", runId },
      { type: "STATE_DELTA", path: "weather.current", value: forecast.current },
      {
        type: "UI_RENDER",
        component: "WeatherHeroCard",
        props: { city: forecast.city, region: forecast.region, current: forecast.current },
      },
      { type: "UI_RENDER", component: "DailyGuidanceCard", props: forecast.dailyGuidance },
      { type: "UI_RENDER", component: "AirQualityPanel", props: forecast.airQuality },
      { type: "UI_RENDER", component: "NationalWeatherAlerts", props: forecast.nationalWeatherAlerts },
      { type: "UI_RENDER", component: "TemperatureSparkline", props: forecast.hourly },
      { type: "UI_RENDER", component: "SevenDayForecast", props: forecast.daily },
      { type: "RUN_FINISHED", runId },
    ],
  };
}

function buildWeatherDashboardResponseFormat() {
  return {
    type: "json_schema",
    schema_id: "weather.dashboard.v1",
    schema: {
      type: "object",
      required: ["summary", "risks", "airQualitySummary", "alertSummary", "snowSummary", "recommendations", "bestWindow", "confidence"],
      properties: {
        summary: { type: "string" },
        risks: { type: "array" },
        airQualitySummary: { type: "string" },
        alertSummary: { type: "string" },
        snowSummary: { type: "string" },
        recommendations: { type: "array" },
        bestWindow: { type: "string" },
        confidence: { type: "string" },
      },
    },
  };
}

function renderDashboard({ compact }) {
  const city = escapeHtml(defaultCity);
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Weather Lab</title>
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
          radial-gradient(circle at 15% 15%, rgba(56, 189, 248, 0.22), transparent 28rem),
          radial-gradient(circle at 85% 20%, rgba(20, 184, 166, 0.16), transparent 26rem),
          radial-gradient(circle at 70% 95%, rgba(124, 58, 237, 0.14), transparent 32rem),
          #020617;
      }
      main { max-width: 1340px; margin: 0 auto; padding: ${compact ? "14px" : "18px 18px 24px"}; }
      .shell {
        display: grid;
        grid-template-columns: minmax(0, 1.35fr) minmax(280px, 0.65fr);
        gap: 12px;
        margin-top: 10px;
      }
      .hero, .panel, .copilot {
        border: 1px solid rgba(255,255,255,0.10);
        background: rgba(15, 23, 42, 0.62);
        box-shadow: 0 18px 50px rgba(8, 47, 73, 0.18);
        backdrop-filter: blur(14px);
      }
      .hero { border-radius: 14px; padding: 12px 16px; margin-bottom: 10px; position: relative; overflow: hidden; }
      .hero-row { display: flex; align-items: center; gap: 14px; flex-wrap: wrap; }
      .hero-title { display: flex; flex-direction: column; gap: 2px; flex: 1; min-width: 240px; }
      .eyebrow {
        margin: 0;
        color: #67e8f9;
        font-size: 0.64rem;
        font-weight: 800;
        letter-spacing: 0.22em;
        text-transform: uppercase;
        display: inline-flex;
        align-items: center;
        gap: 7px;
      }
      h1 { margin: 0; font-size: 1.28rem; line-height: 1.15; letter-spacing: -0.025em; font-weight: 800; }
      h2 { margin: 0 0 8px; font-size: 0.78rem; font-weight: 800; letter-spacing: 0.14em; text-transform: uppercase; color: #94a3b8; }
      .subtitle { color: #94a3b8; line-height: 1.4; font-size: 0.78rem; max-width: 720px; }
      .hero-status { display: inline-flex; }
      .dashboard-status {
        display: inline-flex;
        align-items: center;
        gap: 7px;
        max-width: min(360px, 42vw);
        border-radius: 999px;
        border: 1px solid rgba(56, 189, 248, 0.30);
        background: rgba(2, 6, 23, 0.72);
        color: #bae6fd;
        padding: 5px 10px;
        font-size: 0.72rem;
        font-weight: 800;
        cursor: help;
        backdrop-filter: blur(18px);
      }
      .status-dot {
        width: 8px;
        height: 8px;
        border-radius: 999px;
        background: currentColor;
        box-shadow: 0 0 0 6px rgba(56, 189, 248, 0.10);
      }
      .run-history {
        display: flex;
        align-items: center;
        gap: 8px;
        margin-top: 10px;
        max-width: 720px;
      }
      .run-history select { flex: 1; min-width: 220px; }
      .controls { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 0; align-items: center; }
      .font-customizer {
        display: flex;
        flex-wrap: wrap;
        gap: 8px;
        align-items: center;
        position: fixed;
        left: 18px;
        bottom: 74px;
        z-index: 30;
        max-width: calc(100vw - 36px);
        padding: 8px 10px;
        border: 1px solid rgba(255,255,255,0.12);
        border-radius: 18px;
        background: rgba(2, 6, 23, 0.88);
        box-shadow: 0 18px 50px rgba(2, 6, 23, 0.34);
        backdrop-filter: blur(18px);
        font-size: 0.78rem;
        line-height: 1;
      }
      .font-dock-title {
        color: #e2e8f0;
        font-size: 0.72rem;
        font-weight: 1000;
        letter-spacing: 0.1em;
        text-transform: uppercase;
      }
      .font-customizer label {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        color: #cbd5e1;
        font-size: 0.72rem;
        font-weight: 900;
        letter-spacing: 0.08em;
        text-transform: uppercase;
      }
      .font-customizer select { min-width: 82px; padding: 7px 10px; font-size: 0.86rem; line-height: 1; }
      input, button, select {
        border-radius: 8px;
        border: 1px solid rgba(255,255,255,0.14);
        background: rgba(2, 6, 23, 0.72);
        color: #e2e8f0;
        padding: 7px 10px;
        font-family: inherit;
        font-size: 0.78rem;
      }
      .controls input, .controls select, .controls button { padding: 6px 12px; font-size: 0.78rem; }
      .weather-question-input {
        display: block;
        width: 100%;
        min-height: 76px;
        margin-top: 8px;
        border-radius: 10px;
        border: 1px solid rgba(255,255,255,0.14);
        background: rgba(2, 6, 23, 0.72);
        color: #e2e8f0;
        padding: 8px 10px;
        font: inherit;
        font-size: 0.78rem;
        line-height: 1.45;
        resize: vertical;
        overflow: auto;
      }
      .weather-question-input::placeholder { color: #94a3b8; opacity: 0.85; }
      button { cursor: pointer; background: linear-gradient(135deg, #0284c7, #10b981); font-weight: 700; border: 0; }
      button.ghost { background: rgba(2, 6, 23, 0.72); border: 1px solid rgba(255,255,255,0.14); font-weight: 600; }
      .panel, .copilot { border-radius: 14px; padding: 12px 14px; }
      .panel + .panel { margin-top: 10px; }

      .kpi-strip { display: grid; grid-template-columns: 1.4fr repeat(5, minmax(0, 1fr)); gap: 8px; }
      .kpi {
        border-radius: 12px;
        background: linear-gradient(180deg, rgba(15, 23, 42, 0.72), rgba(2, 6, 23, 0.65));
        border: 1px solid rgba(255,255,255,0.08);
        padding: 10px 12px;
        position: relative;
        overflow: hidden;
        min-height: 80px;
        display: flex;
        flex-direction: column;
        justify-content: center;
        gap: 4px;
      }
      .kpi.accent-good { border-color: rgba(52, 211, 153, 0.30); }
      .kpi.accent-attention { border-color: rgba(56, 189, 248, 0.30); }
      .kpi.accent-warn { border-color: rgba(248, 191, 36, 0.32); }
      .kpi.accent-danger { border-color: rgba(248, 113, 113, 0.32); }
      .kpi .kpi-label { color: #94a3b8; font-size: 0.64rem; font-weight: 800; letter-spacing: 0.14em; text-transform: uppercase; display: flex; align-items: center; gap: 6px; }
      .kpi .kpi-value { color: #f8fafc; font-size: 1.42rem; font-weight: 800; letter-spacing: -0.025em; line-height: 1.05; display: flex; align-items: center; gap: 6px; }
      .kpi .kpi-icon { font-size: 1.14rem; }
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

      .metrics { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 8px; margin-top: 0; }
      .metric, .day, .message, .insight-card, .alert-row {
        border-radius: 10px;
        background: rgba(2, 6, 23, 0.48);
        border: 1px solid rgba(255,255,255,0.07);
        padding: 10px 12px;
      }
      .metric .icon { display: block; font-size: 0.92rem; margin-bottom: 4px; }
      .label { color: #94a3b8; font-size: 0.64rem; font-weight: 800; letter-spacing: 0.10em; text-transform: uppercase; }
      .value { margin-top: 4px; font-size: 1.28rem; font-weight: 800; color: white; letter-spacing: -0.025em; }
      .insight-card {
        border-color: rgba(125, 211, 252, 0.22);
        background: linear-gradient(135deg, rgba(14, 165, 233, 0.16), rgba(20, 184, 166, 0.08));
      }
      .insight-card strong { color: #f8fafc; font-size: 0.92rem; font-weight: 700; }
      .insight-card p { margin: 5px 0 0; color: #cbd5e1; line-height: 1.5; font-size: 0.78rem; }
      .risk-pills { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 6px; }
      .risk-pill {
        border-radius: 999px;
        border: 1px solid rgba(251, 191, 36, 0.3);
        background: rgba(120, 53, 15, 0.22);
        color: #fde68a;
        padding: 3px 8px;
        font-size: 0.72rem;
        font-weight: 800;
      }
      .chart { width: 100%; min-height: 160px; margin-top: 6px; }
      .days { display: grid; grid-template-columns: repeat(7, minmax(0, 1fr)); gap: 6px; }
      .day {
        cursor: pointer;
        min-height: 124px;
        display: grid;
        align-content: space-between;
        gap: 6px;
        padding: 8px 10px;
        transition: border-color 160ms ease, transform 160ms ease, background 160ms ease;
      }
      .day:hover {
        border-color: rgba(103, 232, 249, 0.42);
        background: linear-gradient(180deg, rgba(14, 165, 233, 0.14), rgba(2, 6, 23, 0.55));
        transform: translateY(-2px);
      }
      .day-header { display: flex; align-items: center; justify-content: space-between; gap: 6px; }
      .day strong { color: white; font-size: 0.86rem; letter-spacing: -0.01em; font-weight: 700; }
      .weather-icon { font-size: 1.28rem; line-height: 1; filter: drop-shadow(0 6px 12px rgba(56, 189, 248, 0.18)); }
      .condition { color: #cbd5e1; font-size: 0.72rem; font-weight: 600; line-height: 1.25; min-height: 28px; }
      .forecast-temps { color: white; font-size: 1.05rem; font-weight: 800; letter-spacing: -0.02em; line-height: 1.05; }
      .forecast-temps .low { color: #93c5fd; font-size: 0.78rem; font-weight: 600; }
      .forecast-meta { display: flex; flex-wrap: wrap; gap: 4px; }
      .forecast-chip {
        border-radius: 999px;
        border: 1px solid rgba(148, 163, 184, 0.18);
        background: rgba(15, 23, 42, 0.78);
        color: #cbd5e1;
        padding: 2px 6px;
        font-size: 0.64rem;
        font-weight: 700;
      }
      .air-grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 8px; }
      .alert-row { margin-top: 6px; border-color: rgba(251, 113, 133, 0.24); padding: 8px 10px; }
      .alert-row strong { color: #fecaca; font-size: 0.86rem; }
      .alert-row span { display: block; margin-top: 3px; color: #cbd5e1; font-size: 0.78rem; line-height: 1.45; }
      .copilot { position: sticky; top: 12px; align-self: start; }
      .copilot button { width: 100%; }
      .copilot button + button { margin-top: 6px; }
      .copilot input, .copilot select { width: 100%; }
      .message { margin-top: 8px; color: #cbd5e1; line-height: 1.5; font-size: 0.78rem; padding: 10px 12px; }
      .message strong { color: #bae6fd; }
      .markdown-report h1, .markdown-report h2, .markdown-report h3 { margin: 0.45rem 0 0.25rem; color: #e0f2fe; }
      .markdown-report p { margin: 0.35rem 0; }
      .markdown-report ul, .markdown-report ol { margin: 0.35rem 0 0.35rem 1.1rem; padding: 0; }
      .markdown-report li { margin: 0.2rem 0; }
      .markdown-report code {
        border-radius: 4px;
        padding: 1px 4px;
        background: rgba(15, 23, 42, 0.72);
        color: #bae6fd;
      }
      .markdown-report pre {
        overflow: auto;
        border-radius: 8px;
        padding: 8px;
        background: rgba(15, 23, 42, 0.72);
      }
      .timeline {
        display: grid;
        gap: 6px;
        margin: 0;
        padding: 0;
        list-style: none;
      }
      .timeline li {
        display: grid;
        grid-template-columns: auto minmax(0, 1fr);
        gap: 8px;
        align-items: start;
        border-radius: 10px;
        border: 1px solid rgba(255,255,255,0.08);
        background: rgba(2, 6, 23, 0.5);
        padding: 8px 10px;
        color: #cbd5e1;
        font-size: 0.78rem;
      }
      .timeline li.active {
        border-color: rgba(56, 189, 248, 0.65);
        color: #bae6fd;
        box-shadow: 0 0 28px rgba(14, 165, 233, 0.12);
      }
      .timeline li.done { border-color: rgba(52, 211, 153, 0.42); color: #bbf7d0; }
      .timeline li.error { border-color: rgba(248, 113, 113, 0.45); color: #fecaca; }
      .run-status {
        display: inline-flex;
        align-items: center;
        gap: 7px;
        border-radius: 999px;
        border: 1px solid rgba(255,255,255,0.12);
        background: rgba(2, 6, 23, 0.72);
        padding: 5px 10px;
        font-size: 0.78rem;
        font-weight: 800;
      }
      .run-status.active { border-color: rgba(56, 189, 248, 0.5); color: #bae6fd; }
      .run-status.done { border-color: rgba(52, 211, 153, 0.45); color: #bbf7d0; }
      .run-status.error { border-color: rgba(248, 113, 113, 0.45); color: #fecaca; }
      .run-status.active .status-dot { animation: statusPulse 1s ease-in-out infinite; }
      @keyframes statusPulse {
        0%, 100% { transform: scale(1); opacity: 0.75; }
        50% { transform: scale(1.35); opacity: 1; }
      }
      .activity-spinner {
        width: 14px;
        height: 14px;
        border-radius: 999px;
        border: 2px solid rgba(186, 230, 253, 0.25);
        border-top-color: #38bdf8;
        animation: spin 0.85s linear infinite;
      }
      @keyframes spin { to { transform: rotate(360deg); } }
      .activity-content { min-width: 0; }
      .activity-time {
        display: block;
        color: #64748b;
        font-size: 0.64rem;
        font-weight: 800;
        letter-spacing: 0.12em;
        text-transform: uppercase;
      }
      .activity-detail {
        display: block;
        margin-top: 3px;
        color: #94a3b8;
        font-size: 0.72rem;
      }
      .stream-content {
        max-height: 220px;
        overflow: auto;
        white-space: pre-wrap;
        background: rgba(8, 47, 73, 0.18);
      }
      .debug-events {
        grid-column: 1 / -1;
        border-top: 1px solid rgba(255,255,255,0.08);
        padding-top: 8px;
      }
      .debug-events summary {
        cursor: pointer;
        color: #94a3b8;
        font-size: 0.76rem;
        font-weight: 800;
        text-transform: uppercase;
        letter-spacing: 0.08em;
      }
      .activity-footer {
        position: sticky;
        bottom: 12px;
        z-index: 20;
        margin-top: 12px;
      }
      .activity-footer:has(details[open]) { position: relative; bottom: auto; }
      .activity-footer details {
        border-radius: 14px;
        border: 1px solid rgba(56, 189, 248, 0.24);
        background: rgba(2, 6, 23, 0.86);
        box-shadow: 0 18px 50px rgba(8, 47, 73, 0.22);
        backdrop-filter: blur(18px);
        overflow: hidden;
      }
      .activity-footer details[open] { background: rgba(2, 6, 23, 0.96); }
      .activity-footer details[open] summary { border-bottom: 1px solid rgba(255,255,255,0.08); }
      .activity-footer details[open] .activity-drawer-body { max-height: 320px; overflow: auto; }
      .activity-footer summary {
        display: flex;
        align-items: center;
        gap: 12px;
        padding: 10px 14px;
        cursor: pointer;
        list-style: none;
      }
      .activity-footer summary::-webkit-details-marker { display: none; }
      .activity-summary { min-width: 0; flex: 1; color: #cbd5e1; font-size: 0.78rem; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
      .activity-toggle-hint { color: #67e8f9; font-size: 0.78rem; font-weight: 800; text-transform: uppercase; }
      .activity-drawer-body {
        display: grid;
        grid-template-columns: minmax(0, 0.9fr) minmax(0, 1.1fr);
        gap: 12px;
        padding: 0 14px 14px;
      }
      .activity-drawer-body h2 { font-size: 0.78rem; }
      .pulse {
        display: inline-flex;
        width: 8px;
        height: 8px;
        border-radius: 999px;
        margin-right: 0;
        background: #34d399;
        box-shadow: 0 0 0 6px rgba(52,211,153,0.14);
      }
      @media (max-width: 1100px) {
        .kpi-strip { grid-template-columns: repeat(3, minmax(0, 1fr)); }
        .days { grid-template-columns: repeat(4, minmax(0, 1fr)); }
      }
      @media (max-width: 760px) {
        .shell { grid-template-columns: 1fr; }
        .kpi-strip { grid-template-columns: repeat(2, minmax(0, 1fr)); }
        .metrics, .air-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
        .days { grid-template-columns: repeat(3, minmax(0, 1fr)); }
        .activity-drawer-body { grid-template-columns: 1fr; }
        .copilot { position: static; }
        .hero-status { position: relative; inset: auto; }
        .dashboard-status { max-width: none; }
        .font-customizer { position: static; margin: 12px 0 0; }
      }
      @media (max-width: 480px) {
        .metrics, .air-grid { grid-template-columns: 1fr; }
        .days { grid-template-columns: repeat(2, minmax(0, 1fr)); }
      }
    </style>
  </head>
  <body>
    <main>
      <section class="hero">
        <div class="hero-row">
          <div class="hero-title">
            <p class="eyebrow"><span class="pulse"></span>Weather Lab • Open-Meteo • Embedded Agent</p>
            <h1 id="locationTitle">Loading ${city}</h1>
            <p class="subtitle">
              This external app renders real weather data from Open-Meteo and exposes an app-local
              weather action surface. It also publishes concise, non-sensitive context to CAIPE.
            </p>
          </div>
          <div class="controls">
            <input id="cityInput" value="${city}" aria-label="City" />
            <select id="unitToggle" aria-label="Temperature unit">
              <option value="fahrenheit" selected>Fahrenheit</option>
              <option value="celsius">Celsius</option>
            </select>
            <button id="loadWeather">Refresh with agent</button>
            <span class="hero-status">
              <span class="dashboard-status" id="dashboardStatus" title="No forecast loaded yet.">
                <span class="status-dot" aria-hidden="true"></span>
                Updated: loading
              </span>
            </span>
          </div>
        </div>
        <div class="run-history">
          <select id="runHistory" aria-label="Previous Weather Agent runs">
            <option value="">No previous runs loaded yet</option>
          </select>
          <button class="ghost" id="loadSelectedRun" type="button">Load run</button>
        </div>
      </section>

      <div class="font-customizer font-dock" id="fontCustomizer" aria-label="Font customization">
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

      <div class="panel">
        <h2>Current conditions</h2>
        <div class="kpi-strip" id="kpiStrip"></div>
        <div class="insights-strip" id="insightsStrip" hidden></div>
      </div>

      <div class="shell">
        <section>
          <div class="panel">
            <h2>How is my day?</h2>
            <div class="insight-card" id="howIsMyDay">
              <strong>Loading daily guidance...</strong>
              <p>Forecast, air quality, and alert context will appear here.</p>
            </div>
          </div>
          <div class="panel">
            <h2>Live conditions detail</h2>
            <div class="metrics" id="metrics"></div>
          </div>
          <div class="panel">
            <h2>24 hour temperature arc</h2>
            <svg class="chart" id="tempChart" viewBox="0 0 720 200" role="img" aria-label="24 hour temperature chart"></svg>
          </div>
          <div class="panel">
            <h2>Air quality</h2>
            <div id="aqiPanel" class="air-grid"></div>
          </div>
          <div class="panel">
            <h2>7 day outlook</h2>
            <div class="days" id="days"></div>
          </div>
          <div class="panel">
            <h2>National weather alerts</h2>
            <div id="alertRows" class="message">Checking national weather alerts...</div>
          </div>
        </section>

        <aside class="copilot">
          <p class="eyebrow">Weather Intelligence</p>
          <h2>Weather Agent</h2>
          <p class="subtitle">Ask the embedded weather panel to call your CAIPE Weather Agent and turn the forecast into an operational dashboard recommendation.</p>
          <input id="agentId" aria-label="Weather agent id" value="${escapeHtml(defaultAgentId)}" style="margin: 8px 0;" />
          <select id="intent">
            <option value="forecast-summary">Forecast summary</option>
            <option value="travel-planning">Travel planning</option>
            <option value="deploy-window">Outdoor deploy window</option>
            <option value="snow-conditions">Snow conditions</option>
            <option value="weather-alert-explanation">Risk explanation</option>
          </select>
          <textarea
            id="questionInput"
            class="weather-question-input"
            aria-label="Weather question"
            rows="3"
            placeholder="Ask a question, e.g. What are the snow conditions in Denver?"
          ></textarea>
          <button id="askCopilot" style="margin-top: 8px;">Run Weather Agent</button>
          <button id="openAssistantChat" class="ghost" type="button">Open Ask Weather Chat</button>
          <div class="message" id="copilotMessage">Load a forecast, then ask for an insight.</div>
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
              Weather Agent activity appears here during a live run.
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
                    <span>Ready to run live Weather Agent analysis</span>
                  </span>
                </li>
              </ol>
            </section>
            <section>
              <h2>Streamed Weather Report</h2>
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
      const state = {
        forecast: null,
        lastAgentMessage: "",
        runs: [],
        activityEventCount: 0,
        debugEventCount: 0,
        unit: "fahrenheit",
      };
      const fontStorageKey = "agentic-app.fontPreferences";

      const cityInput = document.getElementById("cityInput");
      const locationTitle = document.getElementById("locationTitle");
      const metrics = document.getElementById("metrics");
      const days = document.getElementById("days");
      const tempChart = document.getElementById("tempChart");
      const copilotMessage = document.getElementById("copilotMessage");
      const howIsMyDay = document.getElementById("howIsMyDay");
      const aqiPanel = document.getElementById("aqiPanel");
      const alertRows = document.getElementById("alertRows");
      const dashboardStatus = document.getElementById("dashboardStatus");
      const unitToggle = document.getElementById("unitToggle");
      const questionInput = document.getElementById("questionInput");
      const fontFamilySelect = document.getElementById("fontFamilySelect");
      const fontScaleSelect = document.getElementById("fontScaleSelect");
      const kpiStrip = document.getElementById("kpiStrip");
      const insightsStrip = document.getElementById("insightsStrip");

      document.getElementById("loadWeather").addEventListener("click", runWeatherAgent);
      document.getElementById("askCopilot").addEventListener("click", runWeatherAgent);
      document.getElementById("openAssistantChat").addEventListener("click", openAssistantChat);
      document.getElementById("loadSelectedRun").addEventListener("click", loadSelectedRun);
      document.getElementById("runHistory").addEventListener("change", loadSelectedRun);
      fontFamilySelect.addEventListener("change", () => writeFontPreferences());
      fontScaleSelect.addEventListener("change", () => writeFontPreferences());
      unitToggle.addEventListener("change", () => {
        state.unit = unitToggle.value === "celsius" ? "celsius" : "fahrenheit";
        if (state.forecast) renderForecast(state.forecast);
      });
      cityInput.addEventListener("keydown", (event) => {
        if (event.key === "Enter") runWeatherAgent();
      });

      applyFontPreferences();
      loadCachedWeather().then((loaded) => {
        if (!loaded) loadWeather(cityInput.value);
      });

      async function loadWeather(city) {
        copilotMessage.textContent = "Waiting for Weather Agent structured output.";
        setDashboardStatus("loading", "Waiting for Weather Agent...", "The embedded app does not call weather providers directly.");
        const response = await fetch(appUrl("/api/copilotkit/weather-agent"), {
          method: "POST",
          headers: { "content-type": "application/json", accept: "application/json" },
          body: JSON.stringify({ city, intent: "forecast-summary" }),
        });
        if (!response.ok) {
          copilotMessage.textContent = "Weather Agent placeholder failed: " + response.status;
          setDashboardStatus("error", "Weather Agent unavailable", "The Weather app could not prepare an agent-only dashboard.");
          return;
        }
        const result = await response.json();
        state.forecast = normalizeForecast(result.forecast || {}, city);
        renderForecast(state.forecast);
        publishAssistantContext(state.forecast);
        setDashboardStatus("ready", "Agent output pending", dashboardStatusDetail(state.forecast));
        copilotMessage.textContent = "Run the Weather Agent to fetch provider data and emit weather.dashboard.v1.";
      }

      async function loadCachedWeather() {
        try {
          const response = await fetch("/api/agentic-apps/weather-cache", {
            headers: { accept: "application/json" },
          });
          if (!response.ok) return false;
          const result = await response.json();
          const cached = result.data?.item;
          state.runs = Array.isArray(result.data?.items) ? result.data.items : cached ? [cached] : [];
          renderRunHistory();
          if (!cached?.payload) return false;
          applyRun(cached);
          copilotMessage.textContent =
            "Loaded latest successful Weather Agent run from " + new Date(cached.updatedAt).toLocaleString() + ".";
          setDashboardStatus("done", "Updated " + new Date(cached.updatedAt).toLocaleTimeString(), dashboardStatusDetail(state.forecast));
          return true;
        } catch {
          return false;
        }
      }

      async function saveCachedWeather(agentId, city, intent, unit, forecast, content) {
        try {
          const response = await fetch("/api/agentic-apps/weather-cache", {
            method: "POST",
            headers: { "content-type": "application/json", accept: "application/json" },
            body: JSON.stringify({
              agentId,
              city,
              intent,
              unit,
              payload: forecast,
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
          // Persistence failure should not block the live weather dashboard.
        }
      }

      function applyRun(run) {
        if (!run?.payload) return;
        state.forecast = normalizeForecast(run.payload, run.city || cityInput.value);
        state.lastAgentMessage = run.lastAgentMessage || JSON.stringify(run.payload, null, 2);
        state.unit = run.unit === "celsius" ? "celsius" : "fahrenheit";
        unitToggle.value = state.unit;
        cityInput.value = state.forecast.city || run.city || cityInput.value;
        renderForecast(state.forecast);
        renderMarkdownReport(document.getElementById("streamedContent"), state.lastAgentMessage);
        publishAssistantContext(state.forecast);
        setDashboardStatus(
          "done",
          "Updated " + new Date(run.updatedAt || run.createdAt || Date.now()).toLocaleTimeString(),
          dashboardStatusDetail(state.forecast),
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
          const cityLabel = payload.city || run.city || "Weather";
          const condition = payload.current?.condition || "forecast";
          const label = [
            index === 0 ? "Latest" : "Previous",
            new Date(run.updatedAt || run.createdAt).toLocaleString(),
            cityLabel,
            run.intent || "forecast-summary",
            condition,
          ].join(" • ");
          return '<option value="' + escapeAttribute(run.runId || String(index)) + '">' + escapeHtml(label) + '</option>';
        }).join("");
      }

      function loadSelectedRun() {
        const runId = document.getElementById("runHistory").value;
        const run = state.runs.find((item) => String(item.runId) === String(runId)) || state.runs[0];
        if (!run) return;
        applyRun(run);
        copilotMessage.textContent =
          "Loaded saved Weather Agent run from " + new Date(run.updatedAt || run.createdAt).toLocaleString() + ".";
      }

      async function runWeatherAgent() {
        const agentId = document.getElementById("agentId").value.trim() || ${JSON.stringify(defaultAgentId)};
        const userQuestion = questionInput.value.trim();
        const requestedCity = extractCityFromQuestion(userQuestion);
        const city = requestedCity || cityInput.value || ${JSON.stringify(defaultCity)};
        cityInput.value = city;
        const intent = inferIntent(userQuestion, document.getElementById("intent").value);
        initializeActivityFeed();
        setRunButtonBusy(true);
        setDashboardStatus("active", "Updating...", "Agent: " + agentId + "\\nCity: " + city + "\\nIntent: " + intent);
        copilotMessage.textContent = "Calling CAIPE dynamic agent " + agentId + "...";
        const prompt = [
          "Answer this weather question for " + city + ": " + (userQuestion || "Build a weather dashboard insight with intent " + intent) + ".",
          "Use the configured weather tools to fetch current provider data for the requested location.",
          "Include forecast, air pollution, national weather alerts, selected temperature unit " + state.unit + ", and a practical 'How is my day?' recommendation.",
          "If the user asks about snow conditions, focus on snow signal, freezing temperature risk, precipitation probability, wind, travel risk, and whether fresh snow is likely.",
          "Use submit_structured_response with the requested weather.dashboard.v1 schema before the final explanation.",
          "Return a short explanation after submitting structured output.",
          "Do not invent weather values."
        ].join(" ");

        let result;
        try {
          updateAgentProgress("agent", "Running CAIPE structured invoke", "Agent: " + agentId);
          const response = await fetch("/api/v1/chat/invoke", {
            method: "POST",
            headers: { "content-type": "application/json", accept: "application/json" },
            body: JSON.stringify({
              agent_id: agentId,
              message: prompt,
              conversation_id: "weather-dashboard-" + (crypto.randomUUID ? crypto.randomUUID() : Date.now()),
              client_context: {
                source: "agentic-app",
                appId: "weather",
                dashboardKind: intent,
                city,
                userQuestion,
                unit: state.unit,
                response_format: ${JSON.stringify(buildWeatherDashboardResponseFormat())},
              },
            }),
          });
          if (!response.ok) {
            throw new Error(await response.text().catch(() => "Weather Agent invoke failed."));
          }
          const invokeResult = await response.json();
          if (invokeResult.success === false) {
            throw new Error(invokeResult.error || "Weather Agent invoke failed.");
          }
          updateAgentProgress("shape", "Shaping weather dashboard output", invokeResult.structured_output ? "Structured weather output received from invoke." : "No weather.dashboard.v1 structured output received.");
          appendStreamContent(invokeResult.content || "");
          result = {
            content: invokeResult.content || "",
            structured_output: invokeResult.structured_output || null,
          };
          if (!result.structured_output) {
            throw new Error("No Weather structured output received from the CAIPE Weather agent");
          }
        } catch (error) {
          updateAgentProgress("error", "Weather Agent structured output unavailable", error instanceof Error ? error.message : "Stream unavailable.");
          const local = await fetch(appUrl("/api/copilotkit/weather-agent"), {
            method: "POST",
            headers: { "content-type": "application/json", accept: "application/json" },
            body: JSON.stringify({ city, intent, question: userQuestion }),
          });
          result = await local.json();
          if (!local.ok) {
            copilotMessage.textContent = result.message || "Weather Agent failed.";
            updateAgentProgress("error", "Weather Agent failed", result.message || "Local fallback failed.");
            setDashboardStatus("error", "Weather Agent failed", result.message || "Local fallback failed.");
            setRunButtonBusy(false);
            return;
          }
          appendStreamContent(result.message || JSON.stringify(result, null, 2));
          updateAgentProgress("error", "Agent structured output required", result.forecast?.reason || "Weather data requires the CAIPE Weather agent.");
          setDashboardStatus("error", "Agent output pending", result.forecast?.reason || "Weather data requires the CAIPE Weather agent.");
        }

        const content = result.structured_output
          ? JSON.stringify(result.structured_output, null, 2)
          : result.content || result.message || JSON.stringify(result, null, 2);
        const insight = result.structured_output || result.forecast || extractFirstJsonObject(content);
        state.forecast = normalizeForecast(insight, city);
        state.lastAgentMessage = content;
        renderForecast(state.forecast);
        if (result.structured_output) {
          updateAgentProgress("save", "Saving run history", "Captured " + state.forecast.daily.length + " daily rows, " + state.forecast.hourly.length + " hourly points, and " + (state.forecast.nationalWeatherAlerts?.alerts?.length || 0) + " alerts.");
          await saveCachedWeather(agentId, city, intent, state.unit, state.forecast, content);
          updateAgentProgress("done", "Run complete", "Dashboard updated from structured Weather Agent invoke.");
          setDashboardStatus("done", "Updated " + new Date().toLocaleTimeString(), dashboardStatusDetail(state.forecast));
        }
        const message = insight?.summary || content;
        copilotMessage.innerHTML = "<strong>Weather Agent:</strong> " + escapeHtml(message);
        if (insight?.recommendations?.length) {
          copilotMessage.innerHTML += "<br><br>" + insight.recommendations.map((item) => "• " + escapeHtml(item)).join("<br>");
        }
        window.parent?.postMessage({
          type: "caipe.agenticApp.context.v1",
          version: "1.0",
          appId: "weather",
          context: {
            route: basePath,
            title: "Weather Agent Insight",
            summary: message,
            selection: JSON.stringify({ forecast: compactForecast(state.forecast), agentOutput: content, userQuestion }).slice(0, 3000),
            resourceRefs: [
              { kind: "datasource", id: "open-meteo" },
              { kind: "agent", id: agentId },
            ],
            suggestedPrompts: [
              "Explain this forecast risk in plain language.",
              "Find the best travel window from this weather context.",
              "Summarize how this forecast affects outdoor work.",
            ],
          },
        }, "*");
        setRunButtonBusy(false);
      }

      function initializeActivityFeed() {
        document.getElementById("activityDrawer").open = true;
        document.getElementById("agentProgress").innerHTML = "";
        document.getElementById("debugProgress").innerHTML = "";
        document.getElementById("debugEventCount").textContent = "0";
        renderMarkdownReport(document.getElementById("streamedContent"), "");
        state.activityEventCount = 0;
        state.debugEventCount = 0;
        updateActivitySummary("Starting live Weather Agent run...");
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
        } else if (step === "fallback") {
          setRunStatus("active", "Fallback");
        } else {
          setRunStatus("active", "Streaming");
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

      function updateActivitySummary(text) {
        document.getElementById("activitySummary").textContent = text;
      }

      function buildActivitySummary(status) {
        const visible = state.activityEventCount + " event" + (state.activityEventCount === 1 ? "" : "s");
        const debug = state.debugEventCount ? " • " + state.debugEventCount + " debug" : "";
        if (status === "error") return "Needs attention • " + visible + debug;
        if (status === "done") return "Last Weather Agent run • " + visible + debug;
        return "Streaming Weather Agent activity • " + visible + debug;
      }

      function setRunButtonBusy(isBusy) {
        const buttons = [document.getElementById("loadWeather"), document.getElementById("askCopilot")].filter(Boolean);
        for (const button of buttons) {
          if (!button.dataset.defaultLabel) {
            button.dataset.defaultLabel = button.textContent || "Run Weather Agent";
          }
          button.disabled = isBusy;
          button.textContent = isBusy ? "Running live weather analysis..." : button.dataset.defaultLabel;
        }
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
              if (frame) handleStreamEvent(frame, streamState);
            }
          }
          if (buffer.trim()) {
            const frame = parseSseFrame(buffer);
            if (frame) handleStreamEvent(frame, streamState);
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
          const toolName = payload.tool_name || "weather tool";
          const toolCallId = payload.tool_call_id || "";
          const debug = isDebugTool(toolName);
          if (toolCallId) {
            streamState.toolNames[toolCallId] = toolName;
            streamState.debugTools[toolCallId] = debug;
          }
          if (!debug) {
            setRunStatus("active", "Using tool");
          }
          appendActivityEvent("tool-start", "Calling " + toolName, summarizeToolArgs(payload.args), "active", { debug });
          return;
        }
        if (frame.event === "tool_end") {
          const toolCallId = payload.tool_call_id || "";
          const debug = Boolean(streamState.debugTools[toolCallId]);
          const toolName = streamState.toolNames[toolCallId] || "weather tool";
          setRunStatus("active", "Streaming");
          appendActivityEvent(
            "tool-end",
            payload.error ? toolName + " failed" : toolName + " completed",
            payload.error || "CAIPE returned the tool result to the Weather Agent.",
            payload.error ? "error" : "done",
            { debug },
          );
          return;
        }
        if (frame.event === "structured_output") {
          streamState.structuredOutput = payload.payload || null;
          streamState.structuredOutputSchemaId = payload.schema_id || "";
          setRunStatus("active", "Rendering");
          appendActivityEvent("structured-output", "Received structured weather output", payload.schema_id || "Schema id not provided.", "done");
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
          return;
        }
        if (frame.event === "done") {
          setRunStatus("active", "Rendering");
          appendActivityEvent("stream-done", "Stream finished", "Rendering Weather Agent report.", "done");
        }
      }

      function isDebugTool(toolName) {
        return new Set(["glob", "grep", "ls", "read", "read_file", "task"]).has(String(toolName || "").toLowerCase());
      }

      function summarizeToolArgs(args) {
        if (!args || typeof args !== "object") return "";
        try {
          return JSON.stringify(args).slice(0, 220);
        } catch {
          return "";
        }
      }

      function parseJson(value, fallback) {
        try {
          return JSON.parse(value);
        } catch {
          return fallback;
        }
      }

      function extractCityFromQuestion(question) {
        const text = String(question || "").trim();
        const match = text.match(/\\b(?:in|near|around|for)\\s+([A-Za-z][A-Za-z .'-]{1,60})(?:[?.!,]|$)/i);
        if (!match) return "";
        return match[1].trim().replace(/\\s+/g, " ");
      }

      function inferIntent(question, selectedIntent) {
        const text = String(question || "").toLowerCase();
        if (text.includes("snow") || text.includes("ski") || text.includes("powder")) {
          return "snow-conditions";
        }
        return selectedIntent || "forecast-summary";
      }

      function appUrl(path) {
        const normalizedPath = String(path || "/").startsWith("/") ? String(path || "/") : "/" + String(path || "/");
        const normalizedBase = basePath.replace(/\\/+$/, "");
        const currentPath = window.location.pathname.replace(/\\/+$/, "") || "/";
        const underProxy = normalizedBase !== "/" && (currentPath === normalizedBase || currentPath.startsWith(normalizedBase + "/"));
        return underProxy ? normalizedBase + normalizedPath : normalizedPath;
      }

      function normalizeForecast(value, fallbackCity) {
        const forecast = value && typeof value === "object" ? value : {};
        const current = forecast.current && typeof forecast.current === "object" ? forecast.current : {};
        return {
          ...forecast,
          city: forecast.city || fallbackCity || ${JSON.stringify(defaultCity)},
          region: forecast.region || "",
          country: forecast.country || "",
          observedAt: forecast.observedAt || new Date().toISOString(),
          current: {
            temperatureC: Number(current.temperatureC ?? current.tempC ?? 0),
            apparentC: Number(current.apparentC ?? current.feelsLikeC ?? current.temperatureC ?? 0),
            humidity: Number(current.humidity ?? 0),
            windKmh: Number(current.windKmh ?? current.windSpeedKmh ?? 0),
            code: Number(current.code ?? 0),
            condition: current.condition || "Agent output pending",
          },
          daily: Array.isArray(forecast.daily) ? forecast.daily : [],
          hourly: Array.isArray(forecast.hourly) ? forecast.hourly : [],
          airQuality: forecast.airQuality || { available: false, reason: forecast.reason || "Air quality requires Weather Agent output." },
          nationalWeatherAlerts: forecast.nationalWeatherAlerts || { available: false, reason: forecast.reason || "Alerts require Weather Agent output.", alerts: [] },
          dailyGuidance: forecast.dailyGuidance || {
            verdict: "Weather agent output pending",
            howIsMyDay: forecast.reason || "Run the Weather Agent to populate this dashboard.",
            riskSignals: ["Agent structured output required"],
          },
          recommendations: Array.isArray(forecast.recommendations) ? forecast.recommendations : [],
        };
      }

      function extractFirstJsonObject(content) {
        const start = String(content).indexOf("{");
        const end = String(content).lastIndexOf("}");
        if (start < 0 || end <= start) return null;
        try {
          return JSON.parse(String(content).slice(start, end + 1));
        } catch {
          return null;
        }
      }

      function renderForecast(forecast) {
        locationTitle.textContent = forecast.city + (forecast.region ? ", " + forecast.region : "");
        renderKpiStrip(forecast);
        renderInsights(forecast);
        renderDailyGuidance(forecast);
        metrics.replaceChildren(
          metric("Temperature", formatTemperature(forecast.current.temperatureC), "Temp"),
          metric("Feels Like", formatTemperature(forecast.current.apparentC), "Feel"),
          metric("Wind", forecast.current.windKmh + " km/h", "Wind"),
          metric("Humidity", forecast.current.humidity + "%", "Hum"),
        );
        days.replaceChildren(...forecast.daily.map((day) => {
          const node = document.createElement("div");
          node.className = "day";
          node.tabIndex = 0;
          node.setAttribute("role", "button");
          node.setAttribute("aria-label", "Share " + day.label + " forecast with CAIPE");
          node.addEventListener("click", () => publishAssistantContext(forecast, day));
          node.addEventListener("keydown", (event) => {
            if (event.key === "Enter" || event.key === " ") publishAssistantContext(forecast, day);
          });
          node.innerHTML =
            '<div class="day-header">' +
              "<strong>" + escapeHtml(day.label) + "</strong>" +
              '<span class="weather-icon" aria-hidden="true">' + escapeHtml(weatherCodeToIcon(day.code)) + "</span>" +
            "</div>" +
            '<div class="condition">' + escapeHtml(day.condition) + "</div>" +
            '<div class="forecast-temps">' +
              formatTemperature(day.highC) +
              ' <span class="low">/ ' + formatTemperature(day.lowC) + "</span>" +
            "</div>" +
            '<div class="forecast-meta">' +
              '<span class="forecast-chip">Rain ' + day.rainChance + "%</span>" +
              '<span class="forecast-chip">Wind ' + day.windKmh + " km/h</span>" +
            "</div>";
          return node;
        }));
        renderChart(forecast.hourly);
        renderAirQuality(forecast.airQuality);
        renderNationalWeatherAlerts(forecast.nationalWeatherAlerts);
      }

      function renderKpiStrip(forecast) {
        if (!kpiStrip) return;
        const current = forecast.current || {};
        const city = forecast.city || "Unknown";
        const region = forecast.region || "";
        const condition = current.condition || "Loading...";
        const icon = weatherCodeToIcon(current.code);
        const today = (forecast.daily && forecast.daily[0]) || null;
        const aq = forecast.airQuality || {};
        const alertCount = (forecast.nationalWeatherAlerts?.alerts || []).length;
        const rainChance = today ? Number(today.rainChance || 0) : 0;
        const aqValue = aq.available ? (aq.usAqi != null ? Math.round(aq.usAqi) : "—") : "—";
        const aqCategory = aq.available ? (aq.category || "") : (aq.reason ? "Unavailable" : "");
        const tempStr = formatTemperature(current.temperatureC);
        const feelsStr = formatTemperature(current.apparentC);
        const windStr = (current.windKmh != null ? current.windKmh : 0) + " km/h";

        const tempAccent = "attention";
        const aqAccent = !aq.available ? "attention" : aqValue >= 151 ? "danger" : aqValue >= 101 ? "warn" : aqValue >= 51 ? "attention" : "good";
        const alertAccent = alertCount > 0 ? "danger" : "good";
        const rainAccent = rainChance >= 70 ? "warn" : rainChance >= 40 ? "attention" : "good";
        const windAccent = (current.windKmh || 0) >= 50 ? "warn" : (current.windKmh || 0) >= 25 ? "attention" : "good";

        kpiStrip.innerHTML = [
          weatherKpi({
            label: "Location",
            value: city,
            sub: [region, condition].filter(Boolean).join(" • "),
            icon: icon,
            accent: "attention",
            valueClass: "kpi-location",
          }),
          weatherKpi({
            label: "Now",
            value: tempStr,
            sub: "Feels " + feelsStr,
            accent: tempAccent,
          }),
          weatherKpi({
            label: "Wind",
            value: windStr,
            sub: (current.humidity != null ? current.humidity + "% humidity" : ""),
            accent: windAccent,
          }),
          weatherKpi({
            label: "Rain (today)",
            value: rainChance + "%",
            sub: today ? "High " + formatTemperature(today.highC) + " / " + formatTemperature(today.lowC) : "—",
            accent: rainAccent,
          }),
          weatherKpi({
            label: "Air quality",
            value: String(aqValue),
            sub: aqCategory || "US AQI",
            accent: aqAccent,
          }),
          weatherKpi({
            label: "Active alerts",
            value: String(alertCount),
            sub: alertCount === 0 ? "No NWS alerts" : "NWS alerts active",
            accent: alertAccent,
          }),
        ].join("");

        const locationLabel = document.querySelector(".kpi-location");
        if (locationLabel) {
          locationLabel.style.fontSize = "1.05rem";
          locationLabel.style.overflow = "hidden";
          locationLabel.style.textOverflow = "ellipsis";
          locationLabel.style.whiteSpace = "nowrap";
        }
      }

      function renderInsights(forecast) {
        if (!insightsStrip) return;
        const insights = [];
        const current = forecast.current || {};
        const today = (forecast.daily && forecast.daily[0]) || null;
        const aq = forecast.airQuality || {};
        const alerts = forecast.nationalWeatherAlerts?.alerts || [];
        const guidance = forecast.dailyGuidance || {};
        const rainChance = today ? Number(today.rainChance || 0) : 0;
        const aqValue = aq.available && aq.usAqi != null ? Number(aq.usAqi) : null;

        if (alerts.length > 0) {
          const top = alerts[0];
          insights.push({ icon: "⚠️", title: alerts.length + " active NWS alert" + (alerts.length === 1 ? "" : "s"), sub: top.event || top.headline || "Check national weather alerts" });
        }
        if (aqValue != null && aqValue >= 101) {
          insights.push({ icon: "🌫️", title: "Air quality " + (aq.category || "is poor") + " (AQI " + Math.round(aqValue) + ")", sub: "Sensitive groups should limit outdoor exposure" });
        }
        if (rainChance >= 60) {
          insights.push({ icon: "🌧️", title: rainChance + "% rain chance today", sub: "Plan indoor or covered windows" });
        }
        if ((current.windKmh || 0) >= 40) {
          insights.push({ icon: "💨", title: "High winds (" + current.windKmh + " km/h)", sub: "Outdoor deploys may be affected" });
        }
        if (guidance.bestWindow) {
          const bw = guidance.bestWindow;
          const label = typeof bw === "string" ? bw : (bw.label || "");
          if (label) insights.push({ icon: "🌤️", title: "Best window: " + label, sub: "Optimal outdoor conditions" });
        }
        const firstRisk = Array.isArray(guidance.riskSignals) ? guidance.riskSignals[0] : null;
        if (firstRisk && !insights.find((ins) => ins.title === firstRisk)) {
          insights.push({ icon: "🚩", title: firstRisk, sub: "Agent flagged risk" });
        }
        if (!insights.length && current.condition) {
          insights.push({ icon: "✅", title: "No major weather, air, or alert risks", sub: current.condition });
        }

        if (!insights.length) {
          insightsStrip.hidden = true;
          insightsStrip.innerHTML = "";
          return;
        }
        insightsStrip.hidden = false;
        insightsStrip.innerHTML = insights.slice(0, 4).map((ins) =>
          '<div class="insight">' +
            '<span class="insight-icon" aria-hidden="true">' + escapeHtml(ins.icon) + '</span>' +
            '<div class="insight-text">' +
              '<strong>' + escapeHtml(ins.title) + '</strong>' +
              (ins.sub ? '<small>' + escapeHtml(ins.sub) + '</small>' : '') +
            '</div>' +
          '</div>'
        ).join("");
      }

      function weatherKpi({ label, value, sub, icon, accent = "attention", valueClass = "" }) {
        return (
          '<div class="kpi accent-' + escapeHtml(accent) + '">' +
            '<div class="kpi-label">' + escapeHtml(label) + '</div>' +
            '<div class="kpi-value ' + escapeHtml(valueClass || "") + '">' +
              (icon ? '<span class="kpi-icon" aria-hidden="true">' + escapeHtml(icon) + '</span>' : '') +
              '<span>' + escapeHtml(String(value)) + '</span>' +
            '</div>' +
            (sub ? '<div class="kpi-sub">' + escapeHtml(sub) + '</div>' : '') +
          '</div>'
        );
      }

      function renderDailyGuidance(forecast) {
        const guidance = forecast.dailyGuidance;
        if (!guidance) {
          howIsMyDay.innerHTML = "<strong>No daily guidance yet.</strong><p>Load a forecast to generate guidance.</p>";
          return;
        }
        howIsMyDay.innerHTML =
          "<strong>" + escapeHtml(guidance.verdict) + "</strong>" +
          "<p>" + escapeHtml(displayDailyGuidance(forecast)) + "</p>" +
          '<div class="risk-pills">' +
          (guidance.riskSignals?.length
            ? guidance.riskSignals.map((risk) => '<span class="risk-pill">' + escapeHtml(risk) + '</span>').join("")
            : '<span class="risk-pill">No major risks detected</span>') +
          "</div>";
      }

      function displayDailyGuidance(forecast) {
        const guidance = forecast.dailyGuidance || {};
        const bestWindow = guidance.bestWindow
          ? " Best outdoor window looks like " + guidance.bestWindow.label + "."
          : " No clear best outdoor window in the next 24 hours.";
        const risks = guidance.riskSignals?.length
          ? " Watch: " + guidance.riskSignals.join(", ") + "."
          : " No major weather, air, or alert risks are visible right now.";
        return forecast.city + ": " + forecast.current.condition.toLowerCase() + ", " + formatTemperature(forecast.current.temperatureC) + " now." + bestWindow + risks;
      }

      function renderAirQuality(airQuality) {
        if (!airQuality?.available) {
          aqiPanel.innerHTML = '<div class="message">Air quality is unavailable: ' + escapeHtml(airQuality?.reason || "no data") + '</div>';
          return;
        }
        aqiPanel.replaceChildren(
          metric("US AQI", airQuality.usAqi ?? "N/A", airQuality.category || "AQI"),
          metric("PM2.5", airQuality.pm25 ?? "N/A", "ug/m3"),
          metric("Ozone", airQuality.ozone ?? "N/A", "ug/m3"),
        );
      }

      function renderNationalWeatherAlerts(nationalWeatherAlerts) {
        const alerts = nationalWeatherAlerts?.alerts ?? [];
        if (!nationalWeatherAlerts?.available) {
          alertRows.innerHTML = "<strong>Alert feed unavailable</strong><br>" + escapeHtml(nationalWeatherAlerts?.reason || "No alert provider response.");
          return;
        }
        if (!alerts.length) {
          alertRows.innerHTML = "<strong>No active national weather alerts</strong><br>National Weather Service has no active alerts for this point.";
          return;
        }
        alertRows.replaceChildren(...alerts.map((alert) => {
          const node = document.createElement("div");
          node.className = "alert-row";
          node.innerHTML =
            "<strong>" + escapeHtml(alert.event) + " - " + escapeHtml(alert.severity) + "</strong>" +
            "<span>" + escapeHtml(alert.headline) + "</span>" +
            (alert.instruction ? "<span>" + escapeHtml(alert.instruction) + "</span>" : "");
          return node;
        }));
      }

      function renderChart(hourly) {
        const points = hourly.slice(0, 24);
        if (!points.length) {
          tempChart.replaceChildren();
          return;
        }
        const temps = points.map((point) => displayTemperatureValue(point.tempC));
        const min = Math.min(...temps);
        const max = Math.max(...temps);
        const spread = Math.max(1, max - min);
        const path = points.map((point, index) => {
          const x = 28 + index * (664 / Math.max(1, points.length - 1));
          const y = 160 - ((displayTemperatureValue(point.tempC) - min) / spread) * 120;
          return (index === 0 ? "M" : "L") + x.toFixed(1) + " " + y.toFixed(1);
        }).join(" ");
        tempChart.innerHTML =
          '<defs><linearGradient id="tempGlow" x1="0" x2="1"><stop offset="0%" stop-color="#38bdf8"/><stop offset="55%" stop-color="#34d399"/><stop offset="100%" stop-color="#facc15"/></linearGradient></defs>' +
          '<path d="' + path + '" fill="none" stroke="url(#tempGlow)" stroke-width="4" stroke-linecap="round"/>' +
          points.filter((_, index) => index % 4 === 0).map((point, index) => {
            const x = 28 + (index * 4) * (664 / Math.max(1, points.length - 1));
            return '<text x="' + x.toFixed(1) + '" y="192" fill="#94a3b8" font-size="11" text-anchor="middle">' + escapeHtml(point.label) + '</text>';
          }).join("") +
          '<text x="20" y="26" fill="#bae6fd" font-size="11" font-weight="700">' + max + temperatureSuffix() + ' high</text>' +
          '<text x="20" y="172" fill="#bae6fd" font-size="11" font-weight="700">' + min + temperatureSuffix() + ' low</text>';
      }

      function displayTemperatureValue(valueC) {
        return state.unit === "celsius" ? Math.round(Number(valueC)) : cToF(valueC);
      }

      function formatTemperature(valueC) {
        return displayTemperatureValue(valueC) + temperatureSuffix();
      }

      function cToF(valueC) {
        return Math.round((Number(valueC) * 9) / 5 + 32);
      }

      function temperatureSuffix() {
        return state.unit === "celsius" ? "C" : "F";
      }

      function applyFontPreferences(preferences = readFontPreferences()) {
        const families = {
          inter: 'Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
          system: 'ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
          mono: '"SFMono-Regular", Consolas, "Liberation Mono", monospace',
          serif: 'Georgia, "Times New Roman", serif',
        };
        const scales = { small: "0.8", default: "1", large: "1.15", xl: "1.3" };
        const family = families[preferences.family] ? preferences.family : "inter";
        const scale = scales[preferences.scale] ? preferences.scale : "small";
        document.documentElement.style.setProperty("--app-font-family", families[family]);
        document.documentElement.style.setProperty("--app-font-scale", scales[scale]);
        fontFamilySelect.value = family;
        fontScaleSelect.value = scale;
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

      function weatherCodeToIcon(code) {
        if (code === 0) return "☀️";
        if ([1, 2].includes(code)) return "🌤️";
        if (code === 3) return "☁️";
        if ([45, 48].includes(code)) return "🌫️";
        if ([51, 53, 55, 56, 57].includes(code)) return "🌦️";
        if ([61, 63, 65, 66, 67, 80, 81, 82].includes(code)) return "🌧️";
        if ([71, 73, 75, 77, 85, 86].includes(code)) return "❄️";
        if ([95, 96, 99].includes(code)) return "⛈️";
        return "🌡️";
      }

      function metric(label, value, icon) {
        const node = document.createElement("div");
        node.className = "metric";
        node.innerHTML =
          '<span class="icon" aria-hidden="true">' + escapeHtml(icon || "") + '</span>' +
          '<div class="label">' + escapeHtml(label) + '</div><div class="value">' + escapeHtml(value) + '</div>';
        return node;
      }

      function publishAssistantContext(forecast, selectedDay) {
        window.parent?.postMessage({
          type: "caipe.agenticApp.context.v1",
          version: "1.0",
          appId: "weather",
          context: {
            route: basePath,
            title: "Live weather for " + forecast.city,
            summary: forecast.dailyGuidance?.howIsMyDay || forecast.current.condition + ", " + forecast.current.temperatureC + "C",
            selection: JSON.stringify({ ...compactForecast(forecast), selectedDay }).slice(0, 5000),
            resourceRefs: [
              { kind: "agent", id: "weather-agent" },
              { kind: "schema", id: "weather.dashboard.v1" },
            ],
            suggestedPrompts: [
              "How is my day based on this weather, AQI, and alert context?",
              "Explain active weather and air quality risks in plain language.",
              "Find the best outdoor or travel window.",
            ],
          },
        }, "*");
      }

      function openAssistantChat() {
        if (state.forecast) publishAssistantContext(state.forecast);
        window.parent?.postMessage({
          type: "caipe.agenticApp.assistant.open.v1",
          version: "1.0",
          appId: "weather",
          prompt: "How is my day based on the current forecast, air pollution, and national weather alerts?",
        }, "*");
      }

      function compactForecast(forecast) {
        return {
          city: forecast.city,
          region: forecast.region,
          country: forecast.country,
          observedAt: forecast.observedAt,
          unit: state.unit,
          current: forecast.current,
          daily: forecast.daily.slice(0, 7),
          hourly: forecast.hourly.slice(0, 12),
          airQuality: forecast.airQuality,
          nationalWeatherAlerts: forecast.nationalWeatherAlerts,
          dailyGuidance: forecast.dailyGuidance,
          source: forecast.source,
        };
      }

      function setDashboardStatus(status, label, detail) {
        dashboardStatus.className = "dashboard-status " + status;
        dashboardStatus.title = detail || label;
        dashboardStatus.innerHTML = '<span class="status-dot" aria-hidden="true"></span>' + escapeHtml(label);
      }

      function dashboardStatusDetail(forecast) {
        const alertCount = forecast.nationalWeatherAlerts?.alerts?.length ?? 0;
        const aqi = forecast.airQuality?.usAqi ?? "N/A";
        return [
          "Forecast: " + forecast.current.condition + ", " + forecast.current.temperatureC + "C",
          "AQI: " + aqi,
          "Alerts: " + alertCount,
          "Guidance: " + (forecast.dailyGuidance?.verdict || "Unavailable"),
        ].join(" | ");
      }

      function formatShortTime(value) {
        try {
          return new Date(value).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
        } catch {
          return "just now";
        }
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

function buildWeatherRecommendations(forecast) {
  const today = forecast.daily[0];
  const rainiest = forecast.daily.reduce((best, day) =>
    day.rainChance > best.rainChance ? day : best,
  today);
  const recommendations = [];

  if (today?.rainChance >= 50) {
    recommendations.push(`Carry rain gear today; Open-Meteo shows ${today.rainChance}% precipitation risk.`);
  } else {
    recommendations.push("Good window for outdoor plans today; precipitation risk is currently low.");
  }
  if (rainiest && rainiest.rainChance >= 40) {
    recommendations.push(`${rainiest.label} is the watch day with ${rainiest.rainChance}% precipitation risk.`);
  }
  if (forecast.current.windKmh >= 25) {
    recommendations.push("Wind is elevated; review outdoor setup and travel assumptions.");
  }

  return recommendations;
}

function buildDailyGuidance(forecast) {
  const today = forecast.daily[0];
  const current = forecast.current;
  const aqi = forecast.airQuality?.usAqi;
  const alerts = forecast.nationalWeatherAlerts?.alerts ?? [];
  const bestWindow = findBestWeatherWindow(forecast.hourly);
  const riskSignals = [];

  if (alerts.length > 0) {
    riskSignals.push(`${alerts.length} active national weather alert${alerts.length === 1 ? "" : "s"}`);
  }
  if (today?.rainChance >= 50) {
    riskSignals.push(`rain risk ${today.rainChance}%`);
  }
  if (current.windKmh >= 25) {
    riskSignals.push(`wind ${current.windKmh} km/h`);
  }
  if (Number.isFinite(Number(aqi)) && Number(aqi) >= 101) {
    riskSignals.push(`AQI ${aqi} (${aqiCategory(aqi)})`);
  }

  const verdict = riskSignals.length
    ? "Plan with caution"
    : "Good day for normal outdoor plans";
  const summary = [
    `${forecast.city}: ${current.condition.toLowerCase()}, ${current.temperatureC}C now.`,
    bestWindow
      ? `Best outdoor window looks like ${bestWindow.label}.`
      : "No clear best outdoor window in the next 24 hours.",
    riskSignals.length ? `Watch: ${riskSignals.join(", ")}.` : "No major weather, air, or alert risks are visible right now.",
  ].join(" ");

  return {
    verdict,
    summary,
    bestWindow,
    riskSignals,
    howIsMyDay: summary,
  };
}

function findBestWeatherWindow(hourly) {
  const candidates = hourly
    .slice(0, 24)
    .map((hour) => {
      const comfort = Math.max(0, 30 - Math.abs(Number(hour.tempC) - 21) * 2);
      const rainPenalty = Number(hour.rainChance || 0) * 0.55;
      const score = comfort - rainPenalty;
      return { ...hour, score };
    })
    .sort((a, b) => b.score - a.score);
  const best = candidates[0];
  if (!best) return null;
  return {
    label: best.label,
    tempC: best.tempC,
    rainChance: best.rainChance,
    condition: best.condition,
    score: Math.round(best.score),
  };
}

function aqiCategory(value) {
  const aqi = Number(value);
  if (!Number.isFinite(aqi)) return "Unavailable";
  if (aqi <= 50) return "Good";
  if (aqi <= 100) return "Moderate";
  if (aqi <= 150) return "Unhealthy for sensitive groups";
  if (aqi <= 200) return "Unhealthy";
  if (aqi <= 300) return "Very unhealthy";
  return "Hazardous";
}

async function readJsonBody(request) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > 64 * 1024) throw new Error("request_body_too_large");
    chunks.push(chunk);
  }
  if (!chunks.length) return {};
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

function sendJson(response, status, body) {
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
  });
  response.end(JSON.stringify(body));
}

function normalizeCity(value) {
  const city = String(value || defaultCity).trim().slice(0, 80);
  return city || defaultCity;
}

function normalizeIntent(value) {
  const intent = String(value || "forecast-summary").trim();
  const allowed = new Set([
    "forecast-summary",
    "travel-planning",
    "deploy-window",
    "snow-conditions",
    "weather-alert-explanation",
  ]);
  return allowed.has(intent) ? intent : "forecast-summary";
}

function normalizeBasePath(value) {
  const trimmed = String(value || "").trim();
  if (!trimmed || trimmed === "/") return "/";
  return trimmed.startsWith("/") ? trimmed.replace(/\/+$/, "") : `/${trimmed.replace(/\/+$/, "")}`;
}

function weatherCodeToLabel(code) {
  if (code === 0) return "Clear sky";
  if ([1, 2].includes(code)) return "Partly cloudy";
  if (code === 3) return "Overcast";
  if ([45, 48].includes(code)) return "Fog";
  if ([51, 53, 55, 56, 57].includes(code)) return "Drizzle";
  if ([61, 63, 65, 66, 67, 80, 81, 82].includes(code)) return "Rain";
  if ([71, 73, 75, 77, 85, 86].includes(code)) return "Snow";
  if ([95, 96, 99].includes(code)) return "Thunderstorm";
  return "Mixed conditions";
}

function formatWeekday(date) {
  return new Date(`${date}T00:00:00`).toLocaleDateString("en-US", { weekday: "short" });
}

function round(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? Math.round(numeric) : 0;
}

function numberOrNull(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? Math.round(numeric) : null;
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}
