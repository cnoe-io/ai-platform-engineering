#!/usr/bin/env node

// assisted-by Codex Codex-sonnet-4-6
import { createServer } from "node:http";

import { createAgenticAppJwtVerifier } from "../../_lib/jwt-verify.mjs";

const port = Number(process.env.FINOPS_APP_PORT ?? "3010");
const basePath = normalizeBasePath(process.env.FINOPS_APP_BASE_PATH ?? "/apps/finops");
const defaultAwsAgentId = process.env.FINOPS_AWS_AGENT_ID ?? process.env.AWS_AGENT_ID ?? "agent-aws-cost-explorer";
const defaultLiteLlmAgentId =
  process.env.FINOPS_LITELLM_AGENT_ID ?? process.env.LITELLM_FINOPS_AGENT_ID ?? "agent-litellm-finops";
const defaultDataSource = normalizeDataSource(process.env.FINOPS_DATA_SOURCE ?? "aws-cost-explorer");
const defaultAgentId = process.env.FINOPS_AGENT_ID ?? agentIdForDataSource(defaultDataSource);
const defaultLookbackDays = Number(process.env.FINOPS_LOOKBACK_DAYS ?? "30");
const defaultDashboardKind =
  process.env.FINOPS_DASHBOARD_KIND ?? (defaultDataSource === "litellm" ? "llm-usage-by-user" : "cost-overview");
const litellmApiUrl = (process.env.LITELLM_API_URL ?? "").replace(/\/+$/, "");
const litellmApiToken = process.env.LITELLM_API_KEY ?? process.env.LITELLM_TOKEN ?? process.env.LITELLM_API_TOKEN ?? "";
const litellmApiTimeoutMs = Math.max(5_000, Number(process.env.LITELLM_API_TIMEOUT ?? "30") * 1000);

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
      dataSource: "aws-cost-explorer-and-litellm-via-agent",
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

  if (url.pathname === "/api/litellm-dashboard") {
    if (request.method !== "POST") {
      sendJson(response, 405, { success: false, error: "method_not_allowed" });
      return;
    }

    try {
      const body = await readJsonBody(request);
      const payload = await buildLiteLlmDashboardPayload(body);
      sendJson(response, 200, { success: true, data: payload });
    } catch (error) {
      const message = error instanceof Error ? error.message : "LiteLLM dashboard pull failed.";
      sendJson(response, 502, { success: false, error: message });
    }
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
    source: "finops-data-via-caipe-dynamic-agent",
    agentId: defaultAgentId,
    dataSource: defaultDataSource,
    dataSources: {
      "aws-cost-explorer": {
        label: "AWS Cost Explorer",
        agentId: defaultAwsAgentId,
        dashboardKinds: ["cost-overview", "service-breakdown", "anomaly-review", "savings-plan"],
      },
      litellm: {
        label: "LiteLLM",
        agentId: defaultLiteLlmAgentId,
        dashboardKinds: ["llm-usage-by-user", "llm-spend-by-model", "llm-token-usage", "llm-top-models"],
      },
    },
    lookbackDays: defaultLookbackDays,
    dashboardKind: defaultDashboardKind,
    endpoint: defaultDataSource === "litellm" ? "/api/litellm-dashboard" : "/api/v1/chat/invoke",
    prompt: buildDashboardPrompt(defaultDataSource, defaultLookbackDays, defaultDashboardKind),
    responseFormat: buildFinOpsDashboardResponseFormat(),
    expectedJsonShape: {
      dataSource: "aws-cost-explorer",
      currency: "USD",
      totalCost: 1234.56,
      forecastCost: 1567.89,
      totalTokens: 123456789,
      totalRequests: 12345,
      services: [{ name: "Amazon EC2", amount: 500.0 }],
      trend: [{ date: "2026-05-01", amount: 123.45 }],
      rawCost: [{ date: "2026-05-01", service: "Amazon EC2", account: "example-account", amount: 123.45, unit: "USD" }],
      anomalies: [{ service: "Amazon EC2", impact: 120.0, explanation: "Short explanation" }],
      recommendations: ["Actionable recommendation"],
    },
  };
}

function buildDashboardPrompt(dataSource, days, dashboardKind = "cost-overview") {
  if (normalizeDataSource(dataSource) === "litellm") {
    return buildLiteLlmPrompt(days, dashboardKind);
  }
  return buildCostExplorerPrompt(days, dashboardKind);
}

function buildCostExplorerPrompt(days, dashboardKind = "cost-overview") {
  return [
    `Build the ${dashboardKind} FinOps dashboard using AWS Cost Explorer for the last ${days} days.`,
    "Do not call request_user_input or ask follow-up questions; this embedded dashboard request already includes the required parameters.",
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

function buildLiteLlmPrompt(days, dashboardKind = "llm-usage-by-user") {
  const end = new Date();
  const start = new Date(end);
  start.setUTCDate(start.getUTCDate() - Math.max(1, Number(days) || defaultLookbackDays) + 1);
  const startDate = start.toISOString().slice(0, 10);
  const endDate = end.toISOString().slice(0, 10);
  const toolByKind = {
    "llm-usage-by-user": "get_llm_usage_and_spend_by_user_report",
    "llm-spend-by-model": "get_llm_spend_by_model_report",
    "llm-token-usage": "get_llm_token_usage_report",
    "llm-top-models": "get_llm_top_models_report",
  };
  const toolName = toolByKind[dashboardKind] || "get_llm_usage_and_spend_by_user_report";
  return [
    `Build the ${dashboardKind} FinOps dashboard using LiteLLM usage data from ${startDate} through ${endDate}.`,
    "Do not call request_user_input or ask follow-up questions; this embedded dashboard request already includes the report type, date range, output shape, and target dashboard.",
    `Use the LiteLLM MCP curated report tool ${toolName} with start_date=${startDate}, end_date=${endDate}, limit=20, and report_format=html_csv.`,
    "Do not call raw spend log pagination tools unless the curated report tool fails.",
    "Use submit_structured_response with schema finops.dashboard.v1 before the final explanation.",
    "Set dataSource to litellm.",
    "Map LiteLLM totals.spend to totalCost, totals.total_tokens to totalTokens, and totals.requests to totalRequests.",
    "Set currency to USD and forecastCost to totalCost because LiteLLM reports are historical.",
    "Map the main ranked LiteLLM rows into services where name is the user/model label and amount is spend. If spend is zero, use total_tokens as amount and include total_tokens in rawCost rows.",
    `Map chart_data or report tables into rawCost rows with date=${startDate}, service=user/model label, amount=spend, unit=USD, and optional totalTokens and requests when available.`,
    "Trend may be an empty array if the curated LiteLLM report does not include daily trend points. Do not invent trend values.",
    "Keep the final explanation short and dashboard-focused.",
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
        dataSource: { type: "string" },
        currency: { type: "string" },
        totalCost: { type: "number" },
        forecastCost: { type: "number" },
        totalTokens: { type: "number" },
        totalRequests: { type: "number" },
        services: { type: "array" },
        trend: { type: "array" },
        rawCost: { type: "array" },
        anomalies: { type: "array" },
        recommendations: { type: "array" },
      },
    },
  };
}

async function buildLiteLlmDashboardPayload(options = {}) {
  if (!litellmApiUrl || !litellmApiToken) {
    throw new Error("LiteLLM dashboard direct mode requires LITELLM_API_URL and LITELLM_API_KEY/LITELLM_TOKEN.");
  }

  const dashboardKind = normalizeLiteLlmDashboardKind(options.dashboardKind);
  const range = liteLlmDateRangeFromOptions(options);
  const rollup = await fetchLiteLlmActivityRollup(range.startDate, range.endDate);
  const analysis = liteLlmRollupToDashboard(rollup, {
    dashboardKind,
    lookbackDays: range.lookbackDays,
    periodLabel: range.label,
    startDate: range.startDate,
    endDate: range.endDate,
  });
  return {
    dashboardKind,
    lookbackDays: range.lookbackDays,
    periodLabel: range.label,
    periodPreset: range.preset,
    startDate: range.startDate,
    endDate: range.endDate,
    analysis,
    content: renderLiteLlmDashboardMarkdown(analysis, dashboardKind, range.startDate, range.endDate),
  };
}

function liteLlmDateRangeFromOptions(options = {}) {
  const startDate = normalizeIsoDate(options.startDate ?? options.start_date);
  const endDate = normalizeIsoDate(options.endDate ?? options.end_date);
  if (startDate && endDate && parseIsoDate(startDate) <= parseIsoDate(endDate)) {
    return {
      startDate,
      endDate,
      lookbackDays: daysBetweenInclusive(startDate, endDate),
      label: String(options.periodLabel || `${startDate} to ${endDate}`),
      preset: String(options.periodPreset || "custom-range"),
    };
  }

  const preset = String(options.periodPreset || options.period || "").toLowerCase();
  const fiscalRanges = {
    fy26q1: { startDate: "2025-08-01", endDate: "2025-10-31", label: "FY26Q1" },
    fy26q2: { startDate: "2025-11-01", endDate: "2026-01-31", label: "FY26Q2" },
    fy26q3: { startDate: "2026-02-01", endDate: "2026-04-30", label: "FY26Q3" },
    fy26q4: { startDate: "2026-05-01", endDate: "2026-07-31", label: "FY26Q4" },
  };
  if (fiscalRanges[preset]) {
    const range = fiscalRanges[preset];
    return {
      ...range,
      lookbackDays: daysBetweenInclusive(range.startDate, range.endDate),
      preset,
    };
  }

  const lookbackDays = clampNumber(options.lookbackDays ?? options.days ?? defaultLookbackDays, 1, 120);
  const range = dateRangeForLookback(lookbackDays);
  return {
    ...range,
    lookbackDays,
    label: `Last ${lookbackDays} days`,
    preset: `last-${lookbackDays}-days`,
  };
}

async function fetchLiteLlmActivityRollup(startDate, endDate) {
  const rollup = newLiteLlmRollup();
  const ranges = monthRanges(startDate, endDate);

  for (const range of ranges) {
    const data = await fetchLiteLlmJson("/user/daily/activity/aggregated", {
      start_date: range.startDate,
      end_date: range.endDate,
    });
    mergeLiteLlmActivityResponse(rollup, data);
    rollup.rangesScanned.push(range);
  }

  return rollup;
}

async function fetchLiteLlmJson(path, params) {
  const url = new URL(`${litellmApiUrl}${path}`);
  Object.entries(params || {}).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== "") {
      url.searchParams.set(key, String(value));
    }
  });

  const response = await fetch(url, {
    method: "GET",
    headers: {
      accept: "application/json",
      authorization: `Bearer ${litellmApiToken}`,
    },
    signal: AbortSignal.timeout(litellmApiTimeoutMs),
  });

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(`LiteLLM API request failed: ${response.status}${text ? ` - ${text.slice(0, 240)}` : ""}`);
  }

  return response.json();
}

function mergeLiteLlmActivityResponse(rollup, response) {
  const results = Array.isArray(response?.results) ? response.results : [];
  rollup.days += results.length;

  for (const day of results) {
    if (!day || typeof day !== "object") continue;

    const dayMetrics = liteLlmMetricsFrom(day.metrics);
    addLiteLlmMetrics(rollup.totals, dayMetrics);
    rollup.trend.push({
      date: String(day.date || day.start_date || day.day || ""),
      amount: dayMetrics.spend,
      totalTokens: dayMetrics.total_tokens,
      requests: dayMetrics.requests,
    });

    const models = day.breakdown?.models && typeof day.breakdown.models === "object" ? day.breakdown.models : {};
    for (const [modelName, modelPayload] of Object.entries(models)) {
      if (!modelPayload || typeof modelPayload !== "object") continue;

      const modelMetrics = liteLlmMetricsFrom(modelPayload.metrics);
      const modelRow = rollup.models.get(modelName) || { model: modelName, ...emptyLiteLlmMetrics() };
      addLiteLlmMetrics(modelRow, modelMetrics);
      rollup.models.set(modelName, modelRow);

      const apiKeys =
        modelPayload.api_key_breakdown && typeof modelPayload.api_key_breakdown === "object"
          ? modelPayload.api_key_breakdown
          : {};
      for (const [apiKeyHash, apiKeyPayload] of Object.entries(apiKeys)) {
        if (!apiKeyPayload || typeof apiKeyPayload !== "object") continue;

        const { userId, displayName } = liteLlmUserIdentity(apiKeyHash, apiKeyPayload);
        const userMetrics = liteLlmMetricsFrom(apiKeyPayload.metrics);
        const userRow =
          rollup.users.get(userId) || {
            user_id: userId,
            display_name: displayName,
            ...emptyLiteLlmMetrics(),
            models: new Map(),
            apiKeyHashes: new Set(),
          };
        userRow.apiKeyHashes.add(String(apiKeyHash));
        addLiteLlmMetrics(userRow, userMetrics);

        const userModel = userRow.models.get(modelName) || { model: modelName, ...emptyLiteLlmMetrics() };
        addLiteLlmMetrics(userModel, userMetrics);
        userRow.models.set(modelName, userModel);
        rollup.users.set(userId, userRow);
      }
    }
  }
}

function liteLlmRollupToDashboard(rollup, { dashboardKind, lookbackDays, periodLabel, startDate, endDate }) {
  const modelRows = finalizeLiteLlmRows([...rollup.models.values()], rankForLiteLlmDashboard(dashboardKind), 20);
  const userRows = finalizeLiteLlmUserRows([...rollup.users.values()], rankForLiteLlmDashboard(dashboardKind), 20);
  const primaryRows =
    dashboardKind === "llm-usage-by-user" ? userRows : modelRows;
  const services = primaryRows.map((row) => {
    const name = row.display_name || row.user_id || row.model || "Unknown LiteLLM row";
    return {
      name,
      amount: toNumber(row.spend),
      totalTokens: toNumber(row.total_tokens),
      requests: toNumber(row.requests),
    };
  });
  const rawCost = primaryRows.map((row) => ({
    date: startDate,
    service: row.display_name || row.user_id || row.model || "Unknown LiteLLM row",
    account: dashboardKind === "llm-usage-by-user" ? `${row.api_key_count || 0} API keys` : "",
    amount: toNumber(row.spend),
    unit: "USD",
    totalTokens: toNumber(row.total_tokens),
    requests: toNumber(row.requests),
  }));
  const trend = rollup.trend
    .filter((item) => item.date)
    .map((item) => ({
      date: item.date,
      amount: toNumber(item.amount),
      totalTokens: toNumber(item.totalTokens),
      requests: toNumber(item.requests),
    }));
  const totals = rollup.totals;

  return {
    status: "structured",
    dataSource: "litellm",
    currency: "USD",
    dashboardKind,
    lookbackDays,
    periodLabel,
    startDate,
    endDate,
    totalCost: toNumber(totals.spend),
    forecastCost: toNumber(totals.spend),
    totalTokens: toNumber(totals.total_tokens),
    totalRequests: toNumber(totals.requests),
    services,
    trend,
    rawCost,
    anomalies: [],
    recommendations: liteLlmDashboardRecommendations(services, totals, dashboardKind),
  };
}

function renderLiteLlmDashboardMarkdown(analysis, dashboardKind, startDate, endDate) {
  const top = analysis.services[0];
  const titleByKind = {
    "llm-usage-by-user": "LiteLLM usage and spend by user",
    "llm-spend-by-model": "LiteLLM spend by model",
    "llm-token-usage": "LiteLLM token usage",
    "llm-top-models": "LiteLLM top models",
  };
  return [
    `## ${titleByKind[dashboardKind] || "LiteLLM dashboard"}`,
    "",
    `Period: ${startDate} to ${endDate}`,
    "",
    `Total spend: ${formatUsd(analysis.totalCost)} across ${formatCompact(analysis.totalRequests)} requests and ${formatCompact(analysis.totalTokens)} tokens.`,
    top ? `Top driver: ${top.name} (${formatUsd(top.amount)}, ${formatCompact(top.totalTokens)} tokens).` : "No LiteLLM usage rows were returned for this period.",
    "",
    "The dashboard visuals below are updated with ranked drivers, trend, weekday pattern, and raw rows.",
  ].join("\n");
}

function liteLlmDashboardRecommendations(services, totals, dashboardKind) {
  if (!services.length) {
    return ["No LiteLLM rows were returned for this period. Try a longer lookback or a previous fiscal quarter."];
  }
  const top = services[0];
  const totalSpend = toNumber(totals.spend);
  const share = totalSpend > 0 ? Math.round((top.amount / totalSpend) * 100) : 0;
  const focus = dashboardKind === "llm-usage-by-user" ? "user" : "model";
  return [
    `Start with the top ${focus}, ${top.name}, which represents ${share}% of spend for this dashboard period.`,
    "Use the chat FinOps report tools for downloadable HTML and CSV files when you need an audit artifact.",
  ];
}

function finalizeLiteLlmUserRows(users, rankBy, limit) {
  return finalizeLiteLlmRows(
    users.map((user) => ({
      ...user,
      api_key_count: user.apiKeyHashes?.size || 0,
      top_models: finalizeLiteLlmRows([...user.models.values()], rankBy, 5),
      models: undefined,
      apiKeyHashes: undefined,
    })),
    rankBy,
    limit,
  );
}

function finalizeLiteLlmRows(rows, rankBy, limit) {
  return rows
    .map((row) => ({ ...row }))
    .sort((a, b) => toNumber(b[rankBy]) - toNumber(a[rankBy]))
    .slice(0, limit);
}

function rankForLiteLlmDashboard(dashboardKind) {
  if (dashboardKind === "llm-spend-by-model") return "spend";
  if (dashboardKind === "llm-token-usage" || dashboardKind === "llm-top-models") return "total_tokens";
  return "total_tokens";
}

function normalizeLiteLlmDashboardKind(value) {
  const allowed = new Set(["llm-usage-by-user", "llm-spend-by-model", "llm-token-usage", "llm-top-models"]);
  return allowed.has(String(value)) ? String(value) : "llm-usage-by-user";
}

function newLiteLlmRollup() {
  return {
    totals: emptyLiteLlmMetrics(),
    models: new Map(),
    users: new Map(),
    trend: [],
    days: 0,
    rangesScanned: [],
  };
}

function emptyLiteLlmMetrics() {
  return {
    requests: 0,
    successful_requests: 0,
    failed_requests: 0,
    prompt_tokens: 0,
    completion_tokens: 0,
    cache_read_input_tokens: 0,
    cache_creation_input_tokens: 0,
    total_tokens: 0,
    spend: 0,
  };
}

function liteLlmMetricsFrom(source = {}) {
  return {
    requests: toNumber(firstPresent(source, ["api_requests", "requests", "total_requests"])),
    successful_requests: toNumber(firstPresent(source, ["successful_requests", "total_successful_requests"])),
    failed_requests: toNumber(firstPresent(source, ["failed_requests", "total_failed_requests"])),
    prompt_tokens: toNumber(firstPresent(source, ["prompt_tokens", "total_prompt_tokens"])),
    completion_tokens: toNumber(firstPresent(source, ["completion_tokens", "total_completion_tokens"])),
    cache_read_input_tokens: toNumber(firstPresent(source, ["cache_read_input_tokens", "total_cache_read_input_tokens"])),
    cache_creation_input_tokens: toNumber(firstPresent(source, ["cache_creation_input_tokens", "total_cache_creation_input_tokens"])),
    total_tokens: toNumber(firstPresent(source, ["total_tokens", "tokens"])),
    spend: toNumber(firstPresent(source, ["spend", "total_spend", "cost"])),
  };
}

function addLiteLlmMetrics(target, metrics) {
  for (const key of Object.keys(emptyLiteLlmMetrics())) {
    target[key] = toNumber(target[key]) + toNumber(metrics[key]);
  }
}

function liteLlmUserIdentity(apiKeyHash, payload) {
  const metadata = payload?.metadata && typeof payload.metadata === "object" ? payload.metadata : {};
  const value =
    firstPresent(metadata, ["user_id", "user_email", "email", "end_user", "key_alias", "team_id"]) ??
    firstPresent(payload || {}, ["user_id", "user_email", "email", "end_user", "key_alias", "team_id"]);
  if (value !== undefined && value !== null && value !== "") {
    return { userId: String(value), displayName: String(value) };
  }
  const shortHash = String(apiKeyHash || "unknown").slice(0, 12);
  return { userId: `api_key:${shortHash}`, displayName: `api_key:${shortHash}` };
}

function firstPresent(source, keys) {
  for (const key of keys) {
    const value = source?.[key];
    if (value !== undefined && value !== null && value !== "") return value;
  }
  return undefined;
}

function dateRangeForLookback(days) {
  const safeDays = clampNumber(days, 1, 120);
  const end = new Date();
  const start = new Date(end);
  start.setUTCDate(start.getUTCDate() - safeDays + 1);
  return {
    startDate: isoDate(start),
    endDate: isoDate(end),
  };
}

function monthRanges(startDate, endDate) {
  const ranges = [];
  let cursor = parseIsoDate(startDate);
  const end = parseIsoDate(endDate);
  while (cursor <= end) {
    const segmentEnd = new Date(Date.UTC(cursor.getUTCFullYear(), cursor.getUTCMonth() + 1, 0));
    const actualEnd = segmentEnd < end ? segmentEnd : end;
    ranges.push({ startDate: isoDate(cursor), endDate: isoDate(actualEnd) });
    cursor = new Date(Date.UTC(actualEnd.getUTCFullYear(), actualEnd.getUTCMonth(), actualEnd.getUTCDate() + 1));
  }
  return ranges;
}

function parseIsoDate(value) {
  const [year, month, day] = String(value).split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day));
}

function isoDate(value) {
  return value.toISOString().slice(0, 10);
}

function normalizeIsoDate(value) {
  const raw = String(value || "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) return "";
  const parsed = parseIsoDate(raw);
  return Number.isNaN(parsed.getTime()) || isoDate(parsed) !== raw ? "" : raw;
}

function daysBetweenInclusive(startDate, endDate) {
  const start = parseIsoDate(startDate);
  const end = parseIsoDate(endDate);
  const msPerDay = 24 * 60 * 60 * 1000;
  return Math.max(1, Math.round((end.getTime() - start.getTime()) / msPerDay) + 1);
}

function clampNumber(value, min, max) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return min;
  return Math.max(min, Math.min(max, Math.round(numeric)));
}

function toNumber(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : 0;
}

function formatUsd(value) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 2 }).format(toNumber(value));
}

function formatCompact(value) {
  return new Intl.NumberFormat("en-US", {
    notation: Math.abs(toNumber(value)) >= 1_000_000 ? "compact" : "standard",
    maximumFractionDigits: Math.abs(toNumber(value)) >= 1_000_000 ? 1 : 0,
  }).format(toNumber(value));
}

function markdownCell(value) {
  return String(value || "unknown").replaceAll("|", "\\|").replace(/\s+/g, " ").trim();
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
        --app-font-scale: 1.12;
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
      .inline-control {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        padding: 3px 8px;
        border: 1px solid rgba(148, 163, 184, 0.22);
        border-radius: 12px;
        background: rgba(15, 23, 42, 0.42);
        color: #cbd5e1;
        font-size: 0.72rem;
        font-weight: 800;
      }
      .inline-control input { width: 58px; text-align: center; }
      .inline-control select,
      .inline-control input[type="month"] {
        min-width: 124px;
      }
      .custom-period-control[hidden] { display: none; }
      .dashboard-tabs {
        display: flex;
        flex-wrap: wrap;
        gap: 6px;
        margin: 10px 0 0;
      }
      .dashboard-tab {
        border: 1px solid rgba(148, 163, 184, 0.16);
        background: rgba(2, 6, 23, 0.62);
        color: #94a3b8;
        padding: 7px 12px;
        font-size: 0.76rem;
        font-weight: 900;
        letter-spacing: 0.08em;
        text-transform: uppercase;
      }
      .dashboard-tab.active {
        border-color: rgba(52, 211, 153, 0.56);
        background: linear-gradient(135deg, rgba(5, 150, 105, 0.42), rgba(2, 132, 199, 0.36));
        color: #ecfeff;
        box-shadow: 0 10px 28px rgba(8, 47, 73, 0.18);
      }
      .tab-panel { display: none; }
      .tab-panel.active {
        display: grid;
        gap: 10px;
      }
      .driver-table {
        display: grid;
        gap: 0;
        border: 1px solid rgba(148, 163, 184, 0.12);
        border-radius: 12px;
        overflow: hidden;
        background: rgba(2, 6, 23, 0.34);
      }
      .driver-row {
        display: grid;
        grid-template-columns: 36px minmax(0, 1.25fr) repeat(4, minmax(86px, 0.5fr));
        gap: 10px;
        align-items: center;
        min-height: 40px;
        padding: 8px 10px;
        border: 0;
        border-bottom: 1px solid rgba(148, 163, 184, 0.10);
        border-radius: 0;
        background: transparent;
        color: #cbd5e1;
        font-size: 0.76rem;
        overflow: hidden;
      }
      .driver-row:last-child { border-bottom: 0; }
      .driver-row.header {
        min-height: auto;
        padding: 8px 10px;
        color: #94a3b8;
        font-size: 0.66rem;
        font-weight: 900;
        letter-spacing: 0.08em;
        text-transform: uppercase;
        background: rgba(15, 23, 42, 0.82);
      }
      .driver-row > span {
        min-width: 0;
      }
      .driver-row.header span {
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .driver-row.header span:first-child {
        text-align: center;
      }
      .driver-row.header span:nth-child(n + 3) {
        text-align: right;
      }
      .driver-rank {
        display: inline-flex;
        width: 24px;
        height: 24px;
        align-items: center;
        justify-content: center;
        justify-self: center;
        border-radius: 8px;
        background: rgba(20, 184, 166, 0.18);
        border: 1px solid rgba(45, 212, 191, 0.26);
        color: #99f6e4;
        font-weight: 1000;
        font-size: 0.66rem;
      }
      .driver-row .driver-name {
        color: #f8fafc;
        font-weight: 850;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .driver-metric {
        color: #e2e8f0;
        font-weight: 750;
        text-align: right;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }
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
      .kpi-strip { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 8px; }
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
      .kpi.secondary-kpi { display: none; }
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
      #serviceRows { display: none; }
      .chart-summary {
        display: grid;
        grid-template-columns: repeat(4, minmax(0, 1fr));
        gap: 6px;
        margin-top: 8px;
      }
      .chart-summary-item {
        min-width: 0;
        padding: 7px 8px;
        border-radius: 10px;
        border: 1px solid rgba(148, 163, 184, 0.12);
        background: rgba(2, 6, 23, 0.42);
      }
      .chart-summary-item small {
        display: block;
        color: #94a3b8;
        font-size: 0.62rem;
        font-weight: 900;
        letter-spacing: 0.08em;
        text-transform: uppercase;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }
      .chart-summary-item strong {
        display: block;
        margin-top: 3px;
        color: #f8fafc;
        font-size: 0.84rem;
        line-height: 1.15;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }
      .row { display: flex; justify-content: space-between; gap: 10px; margin-top: 6px; color: #cbd5e1; font-size: 0.78rem; }
      .row strong { color: #f8fafc; font-weight: 700; }
      .panel-head { display: flex; align-items: baseline; justify-content: space-between; gap: 8px; margin-bottom: 6px; }
      .panel-subhead { margin-top: 12px; padding-top: 10px; border-top: 1px solid rgba(148, 163, 184, 0.14); }
      .legend { display: inline-flex; align-items: center; gap: 4px; color: #94a3b8; font-size: 0.64rem; font-weight: 700; letter-spacing: 0.1em; text-transform: uppercase; }
      .legend-swatch { display: inline-block; width: 14px; height: 3px; border-radius: 2px; vertical-align: middle; margin-right: 4px; }
      .legend-swatch.line { background: linear-gradient(90deg, #22c55e, #0ea5e9); }
      .legend-swatch.avg { background: #fbbf24; }
      .trend-summary { color: #cbd5e1; font-size: 0.78rem; margin-bottom: 4px; }
      .trend-details { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 6px; margin-top: 6px; }
      .trend-detail { padding: 7px 8px; border-radius: 10px; background: rgba(2, 6, 23, 0.44); border: 1px solid rgba(148, 163, 184, 0.12); }
      .trend-detail small { display: block; color: #94a3b8; font-size: 0.64rem; font-weight: 850; letter-spacing: 0.08em; text-transform: uppercase; }
      .trend-detail strong { display: block; color: #f8fafc; font-size: 0.86rem; margin-top: 2px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
      .trend-detail span { display: block; color: #94a3b8; font-size: 0.68rem; margin-top: 1px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
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
      button.driver-row {
        background: transparent;
        border-color: transparent;
        color: inherit;
        padding: 8px 10px;
      }
      button.driver-row:hover {
        background: rgba(8, 47, 73, 0.34);
      }
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
      .assistant-grid { display: grid; gap: 8px; }
      .assistant { position: sticky; top: 12px; align-self: start; }
      .assistant button { width: 100%; }
      .assistant button + button { margin-top: 6px; }
      .assistant-signal-grid {
        display: grid;
        gap: 12px;
        margin-top: 4px;
      }
      .assistant-signal {
        border-top: 1px solid rgba(148, 163, 184, 0.14);
        padding-top: 10px;
      }
      .assistant-signal h2 {
        margin-bottom: 6px;
      }
      .assistant .dow-grid {
        grid-template-columns: 24px repeat(7, minmax(18px, 1fr));
      }
      .assistant .top-mover {
        grid-template-columns: minmax(0, 1fr);
        gap: 6px;
      }
      .assistant .top-mover .mover-bar {
        width: 100%;
      }
      .assistant .top-mover .mover-delta {
        min-width: 0;
        text-align: left;
      }
      .assistant-details {
        border-radius: 12px;
        border: 1px solid rgba(148, 163, 184, 0.14);
        background: rgba(2, 6, 23, 0.34);
        overflow: hidden;
      }
      .assistant-details summary {
        cursor: pointer;
        list-style: none;
        padding: 10px 12px;
        color: #cbd5e1;
        font-size: 0.78rem;
        font-weight: 900;
      }
      .assistant-details summary::-webkit-details-marker { display: none; }
      .assistant-details .message {
        margin: 0 10px 10px;
      }
      .message { margin-top: 8px; color: #cbd5e1; line-height: 1.5; white-space: pre-wrap; font-size: 0.78rem; }
      .visual-summary { display: grid; gap: 10px; white-space: normal; }
      .visual-title { display: flex; justify-content: space-between; gap: 10px; align-items: flex-start; }
      .visual-title strong { color: #f8fafc; font-size: 1rem; line-height: 1.2; }
      .visual-title span { color: #94a3b8; font-size: 0.78rem; white-space: nowrap; }
      .visual-metrics { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 8px; }
      .visual-metric { padding: 9px; border: 1px solid rgba(148, 163, 184, 0.16); border-radius: 10px; background: rgba(2, 6, 23, 0.34); }
      .visual-metric small { display: block; color: #94a3b8; font-size: 0.68rem; font-weight: 800; letter-spacing: 0.08em; text-transform: uppercase; }
      .visual-metric strong { display: block; color: #f8fafc; font-size: 1rem; margin-top: 4px; }
      .visual-bars { display: grid; gap: 8px; }
      .visual-bar-row { display: grid; grid-template-columns: minmax(90px, 1fr) minmax(100px, 1.15fr); gap: 8px; align-items: center; }
      .visual-bar-label { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: #e2e8f0; font-size: 0.78rem; font-weight: 700; }
      .visual-bar-track { position: relative; height: 26px; border-radius: 999px; background: rgba(15, 23, 42, 0.82); overflow: hidden; border: 1px solid rgba(148, 163, 184, 0.12); }
      .visual-bar-fill { position: absolute; inset: 0 auto 0 0; min-width: 4px; border-radius: inherit; background: linear-gradient(90deg, #34d399, #38bdf8); }
      .visual-bar-value { position: relative; z-index: 1; display: block; padding: 4px 8px; color: #f8fafc; font-size: 0.72rem; font-weight: 850; text-align: right; text-shadow: 0 1px 4px rgba(2, 6, 23, 0.8); }
      .visual-note { margin: 0; color: #94a3b8; font-size: 0.78rem; }
      .visual-empty { color: #94a3b8; font-size: 0.82rem; }
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
        .driver-row {
          grid-template-columns: 28px minmax(0, 1fr) minmax(72px, 0.5fr) minmax(72px, 0.5fr);
        }
        .driver-row span:nth-child(5),
        .driver-row span:nth-child(6) { display: none; }
        .chart-summary { grid-template-columns: repeat(2, minmax(0, 1fr)); }
      }
    </style>
  </head>
  <body>
    <main>
      <section class="hero">
        <div class="hero-row">
          <div class="hero-title">
            <p class="eyebrow"><span class="pulse"></span>FinOps · AWS + LiteLLM</p>
            <h1>FinOps Command Center</h1>
          </div>
          <div class="controls">
            <select id="dataSource" aria-label="Data source">
              <option value="aws-cost-explorer"${defaultDataSource === "aws-cost-explorer" ? " selected" : ""}>AWS Cost Explorer</option>
              <option value="litellm"${defaultDataSource === "litellm" ? " selected" : ""}>LiteLLM</option>
            </select>
            <input id="agentId" aria-label="FinOps agent id" value="${escapeHtml(defaultAgentId)}" />
            <label class="inline-control" title="Period included in the dashboard refresh">
              Period
              <select id="periodPreset" aria-label="Report period">
                <option value="last-7-days">Last 7 days</option>
                <option value="last-30-days"${defaultLookbackDays === 30 ? " selected" : ""}>Last 30 days</option>
                <option value="last-60-days"${defaultLookbackDays === 60 ? " selected" : ""}>Last 60 days</option>
                <option value="fy26q1">FY26Q1</option>
                <option value="fy26q2">FY26Q2</option>
                <option value="fy26q3">FY26Q3</option>
                <option value="fy26q4">FY26Q4</option>
                <option value="custom-month">Custom month</option>
              </select>
            </label>
            <label class="inline-control custom-period-control" id="customMonthControl" title="Custom calendar month" hidden>
              Month
              <input id="customMonth" type="month" aria-label="Custom month" value="${escapeHtml(new Date().toISOString().slice(0, 7))}" />
            </label>
            <select id="dashboardKind" aria-label="Dashboard kind">
              <option value="cost-overview" selected>Cost overview</option>
              <option value="service-breakdown">Service breakdown</option>
              <option value="anomaly-review">Anomaly review</option>
              <option value="savings-plan">Savings plan</option>
              <option value="llm-usage-by-user">LiteLLM usage by user</option>
              <option value="llm-spend-by-model">LiteLLM spend by model</option>
              <option value="llm-token-usage">LiteLLM token usage</option>
              <option value="llm-top-models">LiteLLM top models</option>
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
          <div class="kpi-label" id="kpiTotalLabel">💸 Total spend</div>
          <div class="kpi-value" id="kpiTotal">—</div>
          <div class="kpi-sub" id="kpiTotalSub">Awaiting agent</div>
          <svg class="kpi-spark" id="kpiSpark" viewBox="0 0 90 30" preserveAspectRatio="none" aria-hidden="true"></svg>
        </div>
        <div class="kpi accent-forecast">
          <div class="kpi-label" id="kpiForecastLabel">🔮 Forecast</div>
          <div class="kpi-value" id="kpiForecast">—</div>
          <div class="kpi-sub" id="kpiForecastSub">Projected total</div>
        </div>
        <div class="kpi secondary-kpi">
          <div class="kpi-label">📈 Δ vs prior</div>
          <div class="kpi-value" id="kpiDelta">—</div>
          <div class="kpi-sub" id="kpiDeltaSub">Day-over-day</div>
        </div>
        <div class="kpi">
          <div class="kpi-label" id="kpiTopLabel">🏆 Top service</div>
          <div class="kpi-value" id="kpiTopService" style="font-size: 1rem;">—</div>
          <div class="kpi-sub" id="kpiTopServiceSub">No data</div>
        </div>
        <div class="kpi accent-warn">
          <div class="kpi-label" id="kpiAnomaliesLabel">⚠ Anomalies</div>
          <div class="kpi-value" id="kpiAnomalies">0</div>
          <div class="kpi-sub" id="kpiAnomaliesSub">No alerts</div>
        </div>
        <div class="kpi secondary-kpi">
          <div class="kpi-label" id="kpiRecsLabel">🧭 Recs</div>
          <div class="kpi-value" id="kpiRecs">0</div>
          <div class="kpi-sub" id="kpiRecsSub">Optimization signals</div>
        </div>
      </div>

      <nav class="dashboard-tabs" role="tablist" aria-label="FinOps dashboard sections">
        <button class="dashboard-tab active" type="button" role="tab" aria-selected="true" data-tab-target="overview">Overview</button>
        <button class="dashboard-tab" type="button" role="tab" aria-selected="false" data-tab-target="drivers">Drivers</button>
        <button class="dashboard-tab" type="button" role="tab" aria-selected="false" data-tab-target="details">Details</button>
      </nav>

      <div class="shell" style="margin-top: 10px;">
        <section>
          <div class="tab-panel active" data-tab-panel="overview">
            <div class="panel">
              <div class="panel-head">
                <h2 style="margin: 0;">Spend over time</h2>
                <span class="legend">
                  <span class="legend-swatch line"></span>Spend
                  <span class="legend-swatch avg" style="margin-left: 8px;"></span>7-day avg
                </span>
              </div>
              <div class="trend-summary" id="trendSummary">Run analysis to see daily spend.</div>
              <svg class="chart small" id="trendChart" viewBox="0 0 760 220" role="img" aria-label="Daily spend trend chart"></svg>
              <div class="trend-details" id="trendDetails">
                <div class="trend-detail"><small>Latest</small><strong>-</strong><span>No data</span></div>
                <div class="trend-detail"><small>Highest</small><strong>-</strong><span>No data</span></div>
                <div class="trend-detail"><small>Lowest</small><strong>-</strong><span>No data</span></div>
              </div>
            </div>
            <div class="panel">
              <h2 id="costChartTitle">Service spend</h2>
              <svg class="chart small" id="costChart" viewBox="0 0 760 220" role="img" aria-label="AWS service cost chart"></svg>
              <div class="chart-summary" id="costChartSummary">
                <div class="chart-summary-item"><small>Spend</small><strong>-</strong></div>
                <div class="chart-summary-item"><small>Tokens</small><strong>-</strong></div>
                <div class="chart-summary-item"><small>Requests</small><strong>-</strong></div>
                <div class="chart-summary-item"><small>Top</small><strong>-</strong></div>
              </div>
              <div id="serviceRows"></div>
              <div class="panel-subhead">
                <h2 id="driverTableTitle">Top usage contributors</h2>
                <div class="driver-table" data-driver-table="compact">
                  <div class="row">Run analysis to see ranked spend and usage contributors.</div>
                </div>
              </div>
            </div>
          </div>

          <div class="tab-panel" data-tab-panel="drivers">
            <div class="panel">
              <h2 id="driverTableTitleSecondary">Top contributors detail</h2>
              <div class="driver-table" data-driver-table="full">
                <div class="row">Run analysis to see ranked spend and usage contributors.</div>
              </div>
            </div>
            <div class="panel">
              <h2>Anomalies & recommendations</h2>
              <div id="recommendations" class="message">
                Run the FinOps agent to populate real anomalies and recommendations.
              </div>
            </div>
            <div class="panel">
              <h2>Key insights</h2>
              <div class="insights-strip" id="insightsStrip">
                <div class="insight">
                  <span class="insight-icon">📊</span>
                  <span class="insight-text"><strong>Run the agent</strong><small>Insights appear here once data lands.</small></span>
                </div>
              </div>
            </div>
          </div>

          <div class="tab-panel" data-tab-panel="details">
            <div class="panel">
              <h2 id="rawRowsTitle">Detailed rows</h2>
              <p class="subtitle" style="margin: 0 0 6px;">Rows used by the current dashboard view.</p>
              <div id="rawRows" class="message">
                Raw rows will appear here after the FinOps agent returns structured output.
              </div>
            </div>
          </div>
        </section>

        <aside class="assistant">
          <div class="assistant-grid">
            <div>
              <p class="eyebrow">Cost Intelligence</p>
              <h2 style="margin-top: 4px;">Executive Summary</h2>
              <p class="subtitle">
                Share this dashboard with FinOps chat when you want explanation, follow-up analysis,
                or an action plan.
              </p>
              <button id="publishContext">Share to FinOps chat</button>
              <button class="ghost" id="openAssistantChat" type="button">Open Ask FinOps Chat</button>
              <div class="message" id="assistantStatus">Dashboard context has not been shared to FinOps chat yet.</div>
            </div>
            <div class="assistant-signal-grid">
              <section class="assistant-signal">
                <h2>Usage by weekday</h2>
                <p class="subtitle" id="dowSummary" style="margin: 0 0 6px;">Shows which days usually have the highest spend.</p>
                <div class="dow-grid" id="dowGrid"></div>
              </section>
              <section class="assistant-signal">
                <h2>Top movers (vs prior period)</h2>
                <p class="subtitle" id="moversSummary" style="margin: 0 0 6px;">Biggest changes between halves of the window.</p>
                <div id="topMovers"></div>
              </section>
            </div>
            <details class="assistant-details">
              <summary>Run details and transcript</summary>
              <div class="message markdown-report" id="agentTranscript">Latest pull status will appear here.</div>
            </details>
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
      const defaultPrompt = ${JSON.stringify(buildDashboardPrompt(defaultDataSource, defaultLookbackDays, defaultDashboardKind))};
      const defaultDataSource = ${JSON.stringify(defaultDataSource)};
      const defaultAgents = {
        "aws-cost-explorer": ${JSON.stringify(defaultAwsAgentId)},
        litellm: ${JSON.stringify(defaultLiteLlmAgentId)},
      };
      const dashboardKindOptions = {
        "aws-cost-explorer": ["cost-overview", "service-breakdown", "anomaly-review", "savings-plan"],
        litellm: ["llm-usage-by-user", "llm-spend-by-model", "llm-token-usage", "llm-top-models"],
      };
      const state = {
        analysis: null,
        lastAgentMessage: "",
        runs: [],
        selectedService: "",
        selectedDate: "",
        activityEventCount: 0,
        debugEventCount: 0,
        initialAutoRunStarted: false,
        runToken: 0,
      };
      const fontStorageKey = "agentic-app.fontPreferences";
      const settingsToggle = document.getElementById("settingsToggle");
      const fontCustomizer = document.getElementById("fontCustomizer");
      const fontFamilySelect = document.getElementById("fontFamilySelect");
      const fontScaleSelect = document.getElementById("fontScaleSelect");

      document.getElementById("runAnalysis").addEventListener("click", runFinOpsAgent);
      document.getElementById("dataSource").addEventListener("change", handleDataSourceChange);
      document.getElementById("periodPreset").addEventListener("change", handlePeriodChange);
      document.getElementById("customMonth").addEventListener("change", handlePeriodChange);
      document.getElementById("publishContext").addEventListener("click", () => publishAssistantContext("manual"));
      document.getElementById("openAssistantChat").addEventListener("click", openAssistantChat);
      document.getElementById("loadSelectedRun").addEventListener("click", loadSelectedRun);
      document.getElementById("runHistory").addEventListener("change", loadSelectedRun);
      document.querySelectorAll("[data-tab-target]").forEach((button) => {
        button.addEventListener("click", () => setDashboardTab(button.dataset.tabTarget || "overview"));
      });
      settingsToggle.addEventListener("click", toggleFontSettings);
      fontFamilySelect.addEventListener("change", () => writeFontPreferences());
      fontScaleSelect.addEventListener("change", () => writeFontPreferences());
      applyFontPreferences();
      syncPeriodControls();
      syncDataSourceControls({ preserveAgent: true });
      bootstrapDashboard();

      function appRoute(path) {
        const normalizedPath = path.startsWith("/") ? path : "/" + path;
        const isProxied = window.location.pathname === basePath || window.location.pathname.startsWith(basePath + "/");
        return isProxied ? basePath + normalizedPath : normalizedPath;
      }

      async function primeAgentPlan() {
        const response = await fetch(appRoute("/api/summary"), { headers: { accept: "application/json" } });
        const plan = await response.json();
        document.getElementById("agentTranscript").textContent =
          "Ready to call " + plan.endpoint + " with agent_id=" + plan.agentId + ".";
      }

      async function bootstrapDashboard() {
        await primeAgentPlan().catch(() => {
          document.getElementById("agentTranscript").textContent = "Preparing FinOps dashboard...";
        });
        const dataSource = normalizeDataSource(document.getElementById("dataSource").value);
        await loadCachedDashboard({ dataSource });

        if (dataSource === "litellm" && !state.initialAutoRunStarted) {
          state.initialAutoRunStarted = true;
          await runFinOpsAgent({ auto: true });
        }
      }

      async function handleDataSourceChange() {
        const dataSource = normalizeDataSource(document.getElementById("dataSource").value);
        state.runToken += 1;
        syncDataSourceControls();
        resetDashboardForDataSource(dataSource, "Switching to " + dataSourceLabel(dataSource) + "...");
        await loadCachedDashboard({ dataSource });
        await runFinOpsAgent({ auto: true });
      }

      function handlePeriodChange() {
        syncPeriodControls();
        const period = resolveSelectedPeriod();
        setDashboardStatus("idle", "Period changed", "Period: " + period.label + "\\nRun analysis to refresh the dashboard.");
      }

      function syncPeriodControls() {
        const preset = document.getElementById("periodPreset").value || "last-30-days";
        document.getElementById("customMonthControl").hidden = preset !== "custom-month";
      }

      function setDashboardTab(tabName) {
        const target = ["overview", "drivers", "details"].includes(tabName) ? tabName : "overview";
        document.querySelectorAll("[data-tab-target]").forEach((button) => {
          const active = button.dataset.tabTarget === target;
          button.classList.toggle("active", active);
          button.setAttribute("aria-selected", String(active));
        });
        document.querySelectorAll("[data-tab-panel]").forEach((panel) => {
          panel.classList.toggle("active", panel.dataset.tabPanel === target);
        });
      }

      function syncDataSourceControls(options = {}) {
        const dataSource = normalizeDataSource(document.getElementById("dataSource").value);
        const agentInput = document.getElementById("agentId");
        const kindSelect = document.getElementById("dashboardKind");
        const validKinds = dashboardKindOptions[dataSource] || dashboardKindOptions["aws-cost-explorer"];
        const shouldResetAgent =
          !options.preserveAgent ||
          !agentInput.value.trim() ||
          Object.values(defaultAgents).includes(agentInput.value.trim());

        if (shouldResetAgent) {
          agentInput.value = defaultAgents[dataSource] || defaultAgents["aws-cost-explorer"];
        }

        Array.from(kindSelect.options).forEach((option) => {
          option.hidden = !validKinds.includes(option.value);
          option.disabled = !validKinds.includes(option.value);
        });
        if (!validKinds.includes(kindSelect.value)) {
          kindSelect.value = validKinds[0];
        }
        renderDashboardCopy(dataSource);
      }

      function resolveSelectedPeriod() {
        const preset = document.getElementById("periodPreset").value || "last-30-days";
        if (preset === "last-7-days") return clientPeriodFromDays(7, "Last 7 days", preset);
        if (preset === "last-60-days") return clientPeriodFromDays(60, "Last 60 days", preset);
        if (preset === "fy26q1") return fixedClientPeriod("2025-08-01", "2025-10-31", "FY26Q1", preset);
        if (preset === "fy26q2") return fixedClientPeriod("2025-11-01", "2026-01-31", "FY26Q2", preset);
        if (preset === "fy26q3") return fixedClientPeriod("2026-02-01", "2026-04-30", "FY26Q3", preset);
        if (preset === "fy26q4") return fixedClientPeriod("2026-05-01", "2026-07-31", "FY26Q4", preset);
        if (preset === "custom-month") {
          const month = document.getElementById("customMonth").value || new Date().toISOString().slice(0, 7);
          const start = month + "-01";
          const end = lastDayOfMonth(month);
          return fixedClientPeriod(start, end, month, preset);
        }
        return clientPeriodFromDays(30, "Last 30 days", "last-30-days");
      }

      function clientPeriodFromDays(days, label, preset) {
        const range = dateRangeForLookback(days);
        return {
          ...range,
          label,
          preset,
          lookbackDays: daysBetweenInclusive(range.start, range.end),
        };
      }

      function fixedClientPeriod(start, end, label, preset) {
        return {
          start,
          end,
          label,
          preset,
          lookbackDays: daysBetweenInclusive(start, end),
        };
      }

      function lastDayOfMonth(monthValue) {
        const match = String(monthValue || "").match(/^(\\d{4})-(\\d{2})$/);
        if (!match) return new Date().toISOString().slice(0, 10);
        const end = new Date(Date.UTC(Number(match[1]), Number(match[2]), 0));
        return end.toISOString().slice(0, 10);
      }

      function daysBetweenInclusive(startDate, endDate) {
        const start = new Date(startDate + "T00:00:00Z");
        const end = new Date(endDate + "T00:00:00Z");
        if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return ${JSON.stringify(defaultLookbackDays)};
        const msPerDay = 24 * 60 * 60 * 1000;
        return Math.max(1, Math.round((end.getTime() - start.getTime()) / msPerDay) + 1);
      }

      function exclusiveEndDate(endDate) {
        const end = new Date(endDate + "T00:00:00Z");
        end.setUTCDate(end.getUTCDate() + 1);
        return end.toISOString().slice(0, 10);
      }

      function buildClientDashboardPrompt(dataSource, periodInput, dashboardKind) {
        const period = typeof periodInput === "number"
          ? clientPeriodFromDays(periodInput, "Last " + periodInput + " days", "last-" + periodInput + "-days")
          : periodInput || resolveSelectedPeriod();
        if (normalizeDataSource(dataSource) !== "litellm") {
          return [
            "Build the " + dashboardKind + " FinOps dashboard using AWS Cost Explorer for " + period.label + " (" + period.start + " through " + period.end + ").",
            "Do not call request_user_input or ask follow-up questions; this embedded dashboard request already includes the required parameters.",
            "Use aws_cli_execute exactly once for the primary cost pull.",
            "For aws_cli_execute: profile must be an empty string, region must be us-east-2, output_format must be json, and jq_filter must be omitted.",
            "The command must not include the aws prefix, --profile, --region, --output, shell pipes, jq, file:// filters, or forecast calls.",
            "Use this command shape only: ce get-cost-and-usage --time-period Start=" + period.start + ",End=" + exclusiveEndDate(period.end) + " --granularity DAILY --metrics UnblendedCost --group-by Type=DIMENSION,Key=SERVICE Type=DIMENSION,Key=LINKED_ACCOUNT.",
            "Use submit_structured_response with the requested finops.dashboard.v1 schema before the final explanation.",
            "Include trend as daily total cost points and rawCost as raw Cost Explorer rows grouped by date, service, and account when available.",
            "Set dataSource to aws-cost-explorer.",
            "Set forecastCost to totalCost if a forecast cannot be derived from the returned data without another tool call.",
            "Do not invent values. If AWS Cost Explorer is unavailable, explain what credential or permission is missing."
          ].join(" ");
        }

        const toolByKind = {
          "llm-usage-by-user": "get_llm_usage_and_spend_by_user_report",
          "llm-spend-by-model": "get_llm_spend_by_model_report",
          "llm-token-usage": "get_llm_token_usage_report",
          "llm-top-models": "get_llm_top_models_report",
        };
        const toolName = toolByKind[dashboardKind] || "get_llm_usage_and_spend_by_user_report";
        return [
          "Build the " + dashboardKind + " FinOps dashboard using LiteLLM usage data for " + period.label + " (" + period.start + " through " + period.end + ").",
          "Do not call request_user_input or ask follow-up questions; this embedded dashboard request already includes the report type, date range, output shape, and target dashboard.",
          "Use the LiteLLM MCP curated report tool " + toolName + " with start_date=" + period.start + ", end_date=" + period.end + ", limit=20, and report_format=html_csv.",
          "Do not call raw spend log pagination tools unless the curated report tool fails.",
          "Use submit_structured_response with schema finops.dashboard.v1 before the final explanation.",
          "Set dataSource to litellm, currency to USD, and forecastCost to totalCost because LiteLLM reports are historical.",
          "Map LiteLLM totals.spend to totalCost, totals.total_tokens to totalTokens, and totals.requests to totalRequests.",
          "Map the main ranked LiteLLM rows into services where name is the user/model label and amount is spend. Include totalTokens and requests when present.",
          "Map chart_data or report tables into rawCost rows with date=" + period.start + ", service=user/model label, amount=spend, unit=USD, and optional totalTokens and requests when available.",
          "Trend may be an empty array if the curated LiteLLM report does not include daily trend points. Do not invent trend values.",
          "Keep the final explanation short and dashboard-focused."
        ].join(" ");
      }

      function dateRangeForLookback(days) {
        const safeDays = Math.max(1, Math.min(120, Number(days) || ${JSON.stringify(defaultLookbackDays)}));
        const end = new Date();
        const start = new Date(end);
        start.setUTCDate(start.getUTCDate() - safeDays + 1);
        return {
          start: start.toISOString().slice(0, 10),
          end: end.toISOString().slice(0, 10),
        };
      }

      function normalizeDataSource(value) {
        return String(value || "").toLowerCase() === "litellm" ? "litellm" : "aws-cost-explorer";
      }

      function dataSourceLabel(value) {
        return normalizeDataSource(value) === "litellm" ? "LiteLLM" : "AWS Cost Explorer";
      }

      function renderDashboardCopy(dataSource) {
        const isLiteLlm = normalizeDataSource(dataSource) === "litellm";
        document.getElementById("costChartTitle").textContent = isLiteLlm ? "LiteLLM usage and spend" : "Service spend";
        document.getElementById("driverTableTitle").textContent = isLiteLlm ? "Contributor details" : "Cost contributor details";
        document.getElementById("driverTableTitleSecondary").textContent = isLiteLlm ? "Contributor details" : "Cost contributor details";
        document.getElementById("rawRowsTitle").textContent = isLiteLlm ? "Detailed LiteLLM rows" : "Detailed Cost Explorer rows";
      }

      function resetDashboardForDataSource(dataSource, message) {
        const normalized = normalizeDataSource(dataSource);
        state.analysis = emptyDashboardPayload(normalized);
        state.lastAgentMessage = message || dataSourceLabel(normalized) + " dashboard selected.";
        state.selectedService = "";
        state.selectedDate = "";
        renderAnalysis(state.analysis, state.lastAgentMessage);
        setDashboardStatus("active", "Updating...", dataSourceLabel(normalized) + " live refresh is starting.");
      }

      function emptyDashboardPayload(dataSource) {
        return {
          status: "structured",
          dataSource: normalizeDataSource(dataSource),
          currency: "USD",
          totalCost: 0,
          forecastCost: 0,
          totalTokens: 0,
          totalRequests: 0,
          services: [],
          trend: [],
          rawCost: [],
          anomalies: [],
          recommendations: [],
        };
      }

      async function loadCachedDashboard(options = {}) {
        try {
          const targetDataSource = normalizeDataSource(options.dataSource || document.getElementById("dataSource").value);
          const response = await fetch("/api/agentic-apps/finops-cache", {
            headers: { accept: "application/json" },
          });
          if (!response.ok) return false;
          const result = await response.json();
          const allRuns = Array.isArray(result.data?.items)
            ? result.data.items
            : result.data?.item
              ? [result.data.item]
              : [];
          state.runs = allRuns.filter((run) =>
            normalizeDataSource(run?.dataSource || run?.payload?.dataSource) === targetDataSource
          );
          const cached = state.runs[0];
          renderRunHistory();
          if (!cached?.payload) return false;
          applyRun(cached);
          document.getElementById("agentTranscript").textContent =
            "Loaded latest successful " + dataSourceLabel(targetDataSource) + " run from " + new Date(cached.updatedAt).toLocaleString() + ".";
          setDashboardStatus("done", "Updated " + new Date(cached.updatedAt).toLocaleTimeString(), dashboardStatusDetail(cached));
          return true;
        } catch {
          // Cache is a warm-start convenience. Fresh pulls still work if unavailable.
          return false;
        }
      }

      async function runFinOpsAgent(options = {}) {
        const dataSource = normalizeDataSource(document.getElementById("dataSource").value);
        const agentId = document.getElementById("agentId").value.trim() || defaultAgents[dataSource] || ${JSON.stringify(defaultAgentId)};
        const period = resolveSelectedPeriod();
        const days = period.lookbackDays;
        const dashboardKind = document.getElementById("dashboardKind").value || ${JSON.stringify(defaultDashboardKind)};
        const prompt = buildClientDashboardPrompt(dataSource, period, dashboardKind);
        const isAutoRun = options && options.auto === true;
        const runToken = ++state.runToken;

        state.selectedService = "";
        state.selectedDate = "";
        initializeActivityFeed();
        setDashboardStatus("active", "Updating...", "Agent: " + agentId + "\\nData: " + dataSourceLabel(dataSource) + "\\nDashboard: " + dashboardKind + "\\nPeriod: " + period.label);
        setRunButtonBusy(true);
        updateAgentProgress("prepare", "Preparing " + dataSourceLabel(dataSource) + " request", "Period: " + period.label + " • Dashboard: " + dashboardKind);
        document.getElementById("agentTranscript").textContent = isAutoRun
          ? "Loading live " + dataSourceLabel(dataSource) + " analysis..."
          : "Running FinOps analysis agent " + agentId + "...";

        try {
          if (dataSource === "litellm") {
            updateAgentProgress("agent", "Pulling LiteLLM aggregate data", "Calling the FinOps app LiteLLM dashboard endpoint.");
            const response = await fetch(appRoute("/api/litellm-dashboard"), {
              method: "POST",
              headers: { "content-type": "application/json", accept: "application/json" },
              body: JSON.stringify({
                dashboardKind,
                lookbackDays: days,
                periodPreset: period.preset,
                periodLabel: period.label,
                startDate: period.start,
                endDate: period.end,
              }),
            });
            const result = await response.json().catch(() => ({}));
            if (!response.ok || result.success === false) {
              throw new Error(result.error || "LiteLLM dashboard pull failed.");
            }
            if (runToken !== state.runToken) return;

            const liveRun = result.data || {};
            state.analysis = normalizeDashboardPayload(liveRun.analysis || liveRun, dataSource);
            const content = liveRun.content || "LiteLLM dashboard data loaded.";
            state.lastAgentMessage = content;
            updateAgentProgress("shape", "Rendering LiteLLM dashboard", "Direct aggregate output received from LiteLLM.");
            renderAnalysis(state.analysis, content);
            updateAgentProgress("save", "Saving run history", "Captured " + state.analysis.services.length + " rows, " + state.analysis.trend.length + " trend points, " + state.analysis.rawCost.length + " raw rows.");
            await saveCachedDashboard(agentId, dashboardKind, period, state.analysis, content, dataSource);
            updateAgentProgress("done", "Run complete", "Dashboard updated from LiteLLM aggregate data.");
            setDashboardStatus(
              "done",
              "Updated " + new Date().toLocaleTimeString(),
              "Agent: " + agentId + "\\nData: " + dataSourceLabel(dataSource) + "\\nPeriod: " + period.label + "\\nRows: " + state.analysis.services.length + "\\nTrend points: " + state.analysis.trend.length + "\\nRaw rows: " + state.analysis.rawCost.length + "\\nStructured output: direct",
            );
            publishAssistantContext("litellm-dashboard");
            return;
          }

          updateAgentProgress("agent", "Running CAIPE structured invoke", "Agent: " + agentId);
          const response = await fetch("/api/v1/chat/invoke", {
            method: "POST",
            headers: { "content-type": "application/json", accept: "application/json" },
            body: JSON.stringify({
              agent_id: agentId,
              message: prompt,
              conversation_id: "finops-command-center-" + Date.now(),
              client_context: {
                appId: "finops",
                source: "agentic-app",
                requestedDataSource: dataSource,
                dashboardKind,
                lookbackDays: days,
                period,
                response_format: ${JSON.stringify(buildFinOpsDashboardResponseFormat())},
              },
            }),
          });
          if (!response.ok) {
            const message = await response.text().catch(() => "FinOps analysis request failed.");
            document.getElementById("agentTranscript").textContent = message;
            updateAgentProgress("error", "FinOps analysis request failed", message);
            publishAssistantContext("agent-error");
            return;
          }
          const invokeResult = await response.json();
          if (invokeResult.success === false) {
            throw new Error(invokeResult.error || "FinOps analysis invoke failed.");
          }
          if (runToken !== state.runToken) return;
          const structuredOutput = invokeResult.structured_output || null;
          updateAgentProgress("shape", "Shaping dashboard output", structuredOutput ? "Structured output received from invoke." : "No finops.dashboard.v1 structured output received.");
          const content = invokeResult.content || "No explanation was returned.";
          appendStreamContent(content);
          state.lastAgentMessage = content;
          if (!structuredOutput || typeof structuredOutput !== "object") {
            throw new Error("No finops.dashboard.v1 structured output received");
          }
          state.analysis = normalizeDashboardPayload(structuredOutput, dataSource);
          renderAnalysis(state.analysis, content);
          if (state.analysis.status === "structured") {
            updateAgentProgress("save", "Saving run history", "Captured " + state.analysis.services.length + " rows, " + state.analysis.trend.length + " trend points, " + state.analysis.rawCost.length + " raw rows.");
            await saveCachedDashboard(agentId, dashboardKind, period, state.analysis, content, dataSource);
          }
          updateAgentProgress("done", "Run complete", "Dashboard updated from structured agent invoke.");
          setDashboardStatus(
            "done",
            "Updated " + new Date().toLocaleTimeString(),
            "Agent: " + agentId + "\\nData: " + dataSourceLabel(dataSource) + "\\nPeriod: " + period.label + "\\nRows: " + state.analysis.services.length + "\\nTrend points: " + state.analysis.trend.length + "\\nRaw rows: " + state.analysis.rawCost.length + "\\nStructured output: " + (state.analysis.status === "structured" ? "yes" : "no"),
          );
          publishAssistantContext("agent-analysis");
        } catch (error) {
          const message = error instanceof Error ? error.message : "Failed to call FinOps agent";
          document.getElementById("agentTranscript").textContent =
            "The FinOps analysis service is not reachable from this session yet. " + message;
          updateAgentProgress("error", "Live run failed", message);
          setDashboardStatus("error", "Update failed", message);
          publishAssistantContext("agent-unavailable");
        } finally {
          if (runToken === state.runToken) {
            setRunButtonBusy(false);
          }
        }
      }

      async function saveCachedDashboard(agentId, dashboardKind, period, analysis, content, dataSource) {
        try {
          const response = await fetch("/api/agentic-apps/finops-cache", {
            method: "POST",
            headers: { "content-type": "application/json", accept: "application/json" },
            body: JSON.stringify({
              agentId,
              dataSource: normalizeDataSource(dataSource),
              dashboardKind,
              lookbackDays: period?.lookbackDays ?? ${JSON.stringify(defaultLookbackDays)},
              periodLabel: period?.label || "",
              periodPreset: period?.preset || "",
              startDate: period?.start || analysis?.startDate || "",
              endDate: period?.end || analysis?.endDate || "",
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
        const dataSource = normalizeDataSource(run.dataSource || run.payload?.dataSource || "aws-cost-explorer");
        document.getElementById("dataSource").value = dataSource;
        syncDataSourceControls({ preserveAgent: true });
        state.analysis = normalizeDashboardPayload(run.payload, dataSource);
        state.lastAgentMessage = run.lastAgentMessage || JSON.stringify(run.payload, null, 2);
        state.selectedService = "";
        state.selectedDate = "";
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
            dataSourceLabel(run.dataSource || payload.dataSource || "aws-cost-explorer"),
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
        const scales = { small: "1.02", default: "1.12", large: "1.22", xl: "1.34" };
        const family = families[preferences.family] ? preferences.family : "inter";
        const scale = scales[preferences.scale] ? preferences.scale : "default";
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
        const dataSource = normalizeDataSource(run?.dataSource || payload.dataSource || document.getElementById("dataSource").value);
        return [
          "Agent: " + (run?.agentId || document.getElementById("agentId").value.trim() || ${JSON.stringify(defaultAgentId)}),
          "Data: " + dataSourceLabel(dataSource),
          "Dashboard: " + (run?.dashboardKind || document.getElementById("dashboardKind").value || ${JSON.stringify(defaultDashboardKind)}),
          "Period: " + (run?.periodLabel || payload.periodLabel || [payload.startDate, payload.endDate].filter(Boolean).join(" to ") || "current selection"),
          "Rows: " + ((payload.services || []).length || 0),
          "Trend points: " + ((payload.trend || []).length || 0),
          "Raw rows: " + ((payload.rawCost || []).length || 0),
          "Structured output: " + (payload.status === "structured" || payload.totalCost !== undefined ? "yes" : "unknown"),
        ].join("\\n");
      }

      function selectService(serviceName) {
        state.selectedService = state.selectedService === serviceName ? "" : serviceName;
        if (state.analysis) {
          renderServiceRows(state.analysis.services, state.analysis.currency);
          renderDriverTable(state.analysis.services, state.analysis.currency);
          renderRawCostRows(state.analysis.rawCost, state.analysis.currency);
          publishAssistantContext("service-filter");
        }
      }

      function selectTrendDate(date) {
        state.selectedDate = state.selectedDate === date ? "" : date;
        if (state.analysis) {
          renderRawCostRows(state.analysis.rawCost, state.analysis.currency);
          publishAssistantContext("trend-filter");
        }
      }

      function normalizeDashboardPayload(json, fallbackDataSource = "aws-cost-explorer") {
        const dataSource = normalizeDataSource(json.dataSource || fallbackDataSource);
        const totals = json.totals && typeof json.totals === "object" ? json.totals : {};
        const chartData = Array.isArray(json.visualizations?.chart_data)
          ? json.visualizations.chart_data
          : Array.isArray(json.chartData)
            ? json.chartData
            : [];
        const firstChartRows = Array.isArray(chartData[0]?.data) ? chartData[0].data : [];
        const fallbackRows = firstChartRows.map((item) => ({
          name: String(item.label || item.name || "Unknown LiteLLM row"),
          amount: numberOrNull(item.spend ?? item.amount ?? item.value) ?? 0,
          totalTokens: numberOrNull(item.total_tokens ?? item.totalTokens),
          requests: numberOrNull(item.requests),
        }));
        const serviceSource = Array.isArray(json.services) && json.services.length ? json.services : fallbackRows;
        const rawSource = Array.isArray(json.rawCost) && json.rawCost.length
          ? json.rawCost
          : fallbackRows.map((item) => ({
              date: String(json.start_date || json.startDate || ""),
              service: item.name,
              amount: item.amount,
              unit: json.currency || "USD",
              totalTokens: item.totalTokens,
              requests: item.requests,
            }));
        return {
          status: "structured",
          dataSource,
          currency: String(json.currency || "USD"),
          startDate: String(json.startDate || json.start_date || ""),
          endDate: String(json.endDate || json.end_date || ""),
          periodLabel: String(json.periodLabel || json.period_label || ""),
          dashboardKind: String(json.dashboardKind || json.report_type || ""),
          totalCost: numberOrNull(json.totalCost) ?? numberOrNull(totals.spend),
          forecastCost: numberOrNull(json.forecastCost) ?? numberOrNull(json.totalCost) ?? numberOrNull(totals.spend),
          totalTokens: numberOrNull(json.totalTokens) ?? numberOrNull(totals.total_tokens ?? totals.totalTokens),
          totalRequests: numberOrNull(json.totalRequests) ?? numberOrNull(totals.requests),
          services: serviceSource
            .map((item) => ({
                name: String(item.name || (dataSource === "litellm" ? "Unknown LiteLLM row" : "Unknown service")),
                amount: numberOrNull(item.amount ?? item.spend ?? item.value) ?? 0,
                totalTokens: numberOrNull(item.totalTokens ?? item.total_tokens),
                requests: numberOrNull(item.requests),
              })).filter((item) => item.amount > 0 || (item.totalTokens ?? 0) > 0 || (item.requests ?? 0) > 0),
          trend: Array.isArray(json.trend)
            ? json.trend.map((item) => ({
                date: String(item.date || ""),
                amount: numberOrNull(item.amount) ?? 0,
                totalTokens: numberOrNull(item.totalTokens ?? item.total_tokens),
                requests: numberOrNull(item.requests),
              })).filter((item) => item.date && item.amount >= 0)
            : [],
          rawCost: rawSource
            .map((item) => ({
                date: String(item.date || ""),
                service: String(item.service || (dataSource === "litellm" ? "Unknown LiteLLM row" : "Unknown service")),
                account: String(item.account || ""),
                amount: numberOrNull(item.amount ?? item.spend ?? item.value) ?? 0,
                unit: String(item.unit || json.currency || "USD"),
                totalTokens: numberOrNull(item.totalTokens ?? item.total_tokens),
                requests: numberOrNull(item.requests),
              })).filter((item) => item.date && item.amount >= 0),
          anomalies: Array.isArray(json.anomalies) ? json.anomalies : [],
          recommendations: Array.isArray(json.recommendations) ? json.recommendations.map(String) : [],
        };
      }

      function renderAnalysis(analysis, content) {
        renderDashboardCopy(analysis.dataSource);
        renderKpiStrip(analysis);
        renderInsightsStrip(analysis);

        renderReportSummary(document.getElementById("agentTranscript"), analysis, content);
        renderCostChart(analysis.services, analysis.currency);
        renderCostChartSummary(analysis);
        renderServiceRows(analysis.services, analysis.currency);
        renderDriverTable(analysis.services, analysis.currency);
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

      function renderReportSummary(target, analysis, content) {
        if (normalizeDataSource(analysis.dataSource) !== "litellm") {
          renderMarkdownReport(target, content);
          return;
        }

        target.dataset.markdown = "";
        target.innerHTML = buildLiteLlmVisualSummary(analysis);
      }

      function buildLiteLlmVisualSummary(analysis) {
        const rows = Array.isArray(analysis.services) ? analysis.services.slice(0, 6) : [];
        if (!rows.length) {
          return '<div class="visual-summary"><div class="visual-empty">No LiteLLM usage rows returned for this period.</div></div>';
        }

        const maxValue = Math.max(...rows.map((row) => Number(row.totalTokens || row.amount || row.requests) || 0), 1);
        const period = analysis.periodLabel || [analysis.startDate, analysis.endDate].filter(Boolean).join(" to ") || "Current period";
        const top = rows[0];
        const bars = rows.map((row, index) => {
          const value = Number(row.totalTokens || row.amount || row.requests) || 0;
          const width = Math.max(3, Math.min(100, (value / maxValue) * 100));
          const detail = row.totalTokens
            ? formatCount(row.totalTokens) + " tokens"
            : row.amount
              ? formatMoney(row.amount, analysis.currency)
              : formatCount(row.requests) + " requests";
          return (
            '<div class="visual-bar-row">' +
              '<div class="visual-bar-label" title="' + escapeAttribute(row.name) + '">' + (index + 1) + ". " + escapeHtml(row.name) + "</div>" +
              '<div class="visual-bar-track">' +
                '<span class="visual-bar-fill" style="width:' + width.toFixed(1) + '%"></span>' +
                '<span class="visual-bar-value">' + escapeHtml(detail) + "</span>" +
              "</div>" +
            "</div>"
          );
        }).join("");

        return (
          '<div class="visual-summary">' +
            '<div class="visual-title"><strong>LiteLLM visual summary</strong><span>' + escapeHtml(period) + "</span></div>" +
            '<div class="visual-metrics">' +
              '<div class="visual-metric"><small>Spend</small><strong>' + escapeHtml(formatMoney(analysis.totalCost, analysis.currency)) + "</strong></div>" +
              '<div class="visual-metric"><small>Tokens</small><strong>' + escapeHtml(formatCount(analysis.totalTokens)) + "</strong></div>" +
              '<div class="visual-metric"><small>Requests</small><strong>' + escapeHtml(formatCount(analysis.totalRequests)) + "</strong></div>" +
            "</div>" +
            '<p class="visual-note">Top driver: <strong>' + escapeHtml(top.name) + "</strong> · " + escapeHtml(formatDriverValue(top, analysis.currency)) + "</p>" +
            '<div class="visual-bars">' + bars + "</div>" +
          "</div>"
        );
      }

      function renderKpiStrip(analysis) {
        const currency = analysis.currency;
        const trend = Array.isArray(analysis.trend) ? analysis.trend : [];
        const isLiteLlm = normalizeDataSource(analysis.dataSource) === "litellm";
        const isLiteLlmUserDashboard = isLiteLlm && analysis.dashboardKind === "llm-usage-by-user";
        const liteLlmCountLabel = isLiteLlmUserDashboard ? "👥 Active users" : "🤖 Models used";
        const liteLlmCountSub = isLiteLlmUserDashboard
          ? "Users with usage in period"
          : "Models with usage in period";

        document.getElementById("kpiTotalLabel").textContent = "💸 Total spend";
        document.getElementById("kpiForecastLabel").textContent = isLiteLlm ? "🧮 Total tokens" : "🔮 Forecast";
        document.getElementById("kpiTopLabel").textContent = isLiteLlm ? "🏆 Top driver" : "🏆 Top service";
        document.getElementById("kpiAnomaliesLabel").textContent = isLiteLlm ? liteLlmCountLabel : "⚠ Anomalies";
        document.getElementById("kpiRecsLabel").textContent = isLiteLlm ? "🔁 Requests" : "🧭 Recs";

        document.getElementById("kpiTotal").textContent = formatMoney(analysis.totalCost, currency);
        document.getElementById("kpiTotalSub").textContent =
          isLiteLlm
            ? formatCount(analysis.totalTokens) + " tokens · " + formatCount(analysis.totalRequests) + " requests"
            : analysis.services.length + " services · " + analysis.rawCost.length + " rows";

        document.getElementById("kpiForecast").textContent = isLiteLlm
          ? formatCount(analysis.totalTokens)
          : formatMoney(analysis.forecastCost, currency);
        const forecastDelta = numberOrNull(analysis.forecastCost) !== null && numberOrNull(analysis.totalCost) !== null
          ? Number(analysis.forecastCost) - Number(analysis.totalCost)
          : null;
        document.getElementById("kpiForecastSub").textContent = isLiteLlm
          ? "Total LiteLLM tokens"
          : forecastDelta === null
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
          ? formatDriverValue(top, currency) + (analysis.totalCost ? " · " + Math.round((top.amount / analysis.totalCost) * 100) + "% of spend" : "")
          : "No data";

        const anomalyCount = analysis.anomalies.length;
        document.getElementById("kpiAnomalies").textContent = isLiteLlm ? String(analysis.services.length) : String(anomalyCount);
        document.getElementById("kpiAnomaliesSub").textContent = isLiteLlm
          ? liteLlmCountSub
          : anomalyCount === 0
          ? "No alerts"
          : (anomalyCount === 1 ? "1 alert" : anomalyCount + " alerts") + " to review";

        const recCount = analysis.recommendations.length;
        document.getElementById("kpiRecs").textContent = isLiteLlm ? formatCount(analysis.totalRequests) : String(recCount);
        document.getElementById("kpiRecsSub").textContent = isLiteLlm
          ? "LiteLLM requests"
          : recCount === 0
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
        const isLiteLlm = normalizeDataSource(state.analysis?.dataSource) === "litellm";
        chart.replaceChildren();
        if (!services.length) {
          chart.innerHTML = '<text x="20" y="108" fill="#64748b" font-size="13">' + (isLiteLlm ? "Run a LiteLLM pull to populate usage and spend." : "Run a cost pull to populate service spend.") + '</text>';
          return;
        }
        const max = Math.max(...services.map((service) => service.amount), 1);
        chart.innerHTML = services.slice(0, 6).map((service, index) => {
          const y = 12 + index * 32;
          const width = Math.max(6, (service.amount / max) * 480);
          return '<g data-service="' + escapeAttribute(service.name) + '" style="cursor:pointer;">' +
            '<rect x="200" y="' + y + '" width="' + width.toFixed(1) + '" height="20" rx="6" fill="url(#finopsGlow)"></rect>' +
            '<text x="14" y="' + (y + 14) + '" fill="#cbd5e1" font-size="13">' + escapeHtml(service.name.slice(0, 22)) + '</text>' +
            '<text x="' + (210 + width).toFixed(1) + '" y="' + (y + 14) + '" fill="#86efac" font-size="13" font-weight="700">' + escapeHtml(formatDriverValue(service, currency)) + '</text>' +
            '</g>';
        }).join("") + '<defs><linearGradient id="finopsGlow" x1="0" x2="1"><stop offset="0%" stop-color="#34d399"/><stop offset="100%" stop-color="#38bdf8"/></linearGradient></defs>';
        chart.querySelectorAll("[data-service]").forEach((node) => {
          node.addEventListener("click", () => selectService(node.getAttribute("data-service") || ""));
        });
      }

      function renderCostChartSummary(analysis) {
        const container = document.getElementById("costChartSummary");
        if (!container) return;
        const isLiteLlm = normalizeDataSource(analysis.dataSource) === "litellm";
        const top = analysis.services[0];
        const items = isLiteLlm
          ? [
              ["Spend", formatMoney(analysis.totalCost, analysis.currency)],
              ["Tokens", formatCount(analysis.totalTokens)],
              ["Requests", formatCount(analysis.totalRequests)],
              ["Top contributor", top ? top.name : "-"],
            ]
          : [
              ["Spend", formatMoney(analysis.totalCost, analysis.currency)],
              ["Services", formatCount(analysis.services.length)],
              ["Rows", formatCount(analysis.rawCost.length)],
              ["Top service", top ? top.name : "-"],
            ];
        container.innerHTML = items.map(([label, value]) =>
          '<div class="chart-summary-item"><small>' + escapeHtml(label) + '</small><strong title="' + escapeAttribute(value) + '">' + escapeHtml(value) + '</strong></div>'
        ).join("");
      }

      function renderTrendChart(trend, currency) {
        const chart = document.getElementById("trendChart");
        chart.replaceChildren();
        const summary = document.getElementById("trendSummary");
        const details = document.getElementById("trendDetails");
        if (!trend.length) {
          chart.innerHTML = '<text x="20" y="108" fill="#64748b" font-size="13">Run a cost pull to populate daily trend.</text>';
          if (summary) summary.textContent = "Run analysis to see daily spend.";
          if (details) details.innerHTML = trendDetailCards();
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
        if (details) {
          const latest = trend[trend.length - 1];
          const highest = trend.reduce((best, item) => (Number(item.amount) || 0) > (Number(best.amount) || 0) ? item : best, trend[0]);
          const lowest = trend.reduce((best, item) => (Number(item.amount) || 0) < (Number(best.amount) || 0) ? item : best, trend[0]);
          details.innerHTML = trendDetailCards([
            { label: "Latest", value: formatMoney(latest.amount, currency), hint: latest.date },
            { label: "Highest", value: formatMoney(highest.amount, currency), hint: highest.date },
            { label: "Lowest", value: formatMoney(lowest.amount, currency), hint: lowest.date },
          ]);
        }
      }

      function trendDetailCards(items = []) {
        const defaults = [
          { label: "Latest", value: "-", hint: "No data" },
          { label: "Highest", value: "-", hint: "No data" },
          { label: "Lowest", value: "-", hint: "No data" },
        ];
        const cards = items.length ? items : defaults;
        return cards.map((item) =>
          '<div class="trend-detail"><small>' + escapeHtml(item.label) + '</small><strong>' + escapeHtml(item.value) + '</strong><span>' + escapeHtml(item.hint) + '</span></div>'
        ).join("");
      }

      function renderDayOfWeekHeatmap(trend, currency) {
        const grid = document.getElementById("dowGrid");
        const summary = document.getElementById("dowSummary");
        if (!grid) return;
        if (!trend || !trend.length) {
          grid.innerHTML = '<div class="row" style="grid-column: 1 / -1;">No trend data yet.</div>';
          if (summary) summary.textContent = "Shows which days of the week usually have the highest spend.";
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
          summary.innerHTML = "<strong>" + dayNames[topDay] + "s</strong> are currently highest, averaging <strong>" + escapeHtml(formatMoney(topAvg, currency)) + "</strong> per day.";
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

      function renderDriverTable(services, currency) {
        const tables = document.querySelectorAll("[data-driver-table]");
        if (!tables.length) return;
        const isLiteLlm = normalizeDataSource(state.analysis?.dataSource) === "litellm";
        const rows = Array.isArray(services) ? services.slice(0, 10) : [];
        const emptyHtml = '<div class="row">Run analysis to see ranked spend and usage contributors.</div>';
        if (!rows.length) {
          tables.forEach((table) => { table.innerHTML = emptyHtml; });
          return;
        }
        const totalAmount = rows.reduce((sum, row) => sum + (Number(row.amount) || 0), 0) || 1;
        const renderRows = (limit) => rows.slice(0, limit).map((row, index) => {
          const share = ((Number(row.amount) || 0) / totalAmount) * 100;
          return (
            '<button type="button" class="driver-row interactive-row' + (state.selectedService === row.name ? " active" : "") + '" data-driver="' + escapeAttribute(row.name) + '">' +
              '<span class="driver-rank">#' + (index + 1) + "</span>" +
              '<span class="driver-name" title="' + escapeAttribute(row.name) + '">' + escapeHtml(row.name) + "</span>" +
              '<span class="driver-metric">' + escapeHtml(formatMoney(row.amount, currency)) + "</span>" +
              '<span class="driver-metric">' + escapeHtml(isLiteLlm ? formatCount(row.totalTokens) : share.toFixed(1) + "%") + "</span>" +
              '<span class="driver-metric">' + escapeHtml(isLiteLlm ? formatCount(row.requests) : formatCount(row.requests || 0)) + "</span>" +
              '<span class="driver-metric">' + share.toFixed(1) + "%</span>" +
            "</button>"
          );
        }).join("");
        tables.forEach((table) => {
          const limit = table.getAttribute("data-driver-table") === "compact" ? 5 : 10;
          const headers = isLiteLlm
            ? ["#", "Contributor", "Spend", "Tokens", "Requests", "Share"]
            : ["#", "Service", "Spend", "Share", "Requests", "Share"];
          table.innerHTML =
            '<div class="driver-row header">' + headers.map((label) => '<span>' + escapeHtml(label) + '</span>').join("") + "</div>" +
            renderRows(limit);
          table.querySelectorAll("[data-driver]").forEach((node) => {
            node.addEventListener("click", () => selectService(node.getAttribute("data-driver") || ""));
          });
        });
      }

      function renderServiceRows(services, currency) {
        const rows = document.getElementById("serviceRows");
        rows.replaceChildren(...services.slice(0, 8).map((service) => {
          const node = document.createElement("button");
          node.type = "button";
          node.className = "row interactive-row" + (state.selectedService === service.name ? " active" : "");
          node.innerHTML = "<span>" + escapeHtml(service.name) + "</span><strong>" + escapeHtml(formatDriverValue(service, currency)) + "</strong>";
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
          rows.textContent = normalizeDataSource(state.analysis?.dataSource) === "litellm"
            ? "Run a LiteLLM report pull to populate usage rows."
            : "Run a cost pull to populate raw Cost Explorer rows.";
          return;
        }
        rows.replaceChildren(...filtered.slice(0, 12).map((item) => {
          const node = document.createElement("div");
          node.className = "row";
          const account = item.account ? " • " + item.account : "";
          const usage = item.totalTokens ? " • " + formatCount(item.totalTokens) + " tokens" : "";
          const requests = item.requests ? " • " + formatCount(item.requests) + " requests" : "";
          node.innerHTML = "<span>" + escapeHtml(item.date + " • " + item.service + account + usage + requests) + "</span><strong>" + escapeHtml(formatMoney(item.amount, item.unit || currency)) + "</strong>";
          return node;
        }));
      }

      function publishAssistantContext(source) {
        const analysis = state.analysis;
        const dataSource = normalizeDataSource(analysis?.dataSource || document.getElementById("dataSource").value);
        const summary = analysis
          ? dataSourceLabel(dataSource) + " FinOps analysis: " + formatMoney(analysis.totalCost, analysis.currency) + " spend, " + analysis.services.length + " ranked rows, " + analysis.trend.length + " trend points, " + analysis.rawCost.length + " raw rows" + (analysis.totalTokens ? ", " + formatCount(analysis.totalTokens) + " tokens." : ".")
          : "FinOps dashboard is ready to pull " + dataSourceLabel(dataSource) + " data.";
        const filteredContext = [
          state.selectedService ? (dataSource === "litellm" ? "Selected driver: " : "Selected service: ") + state.selectedService : "",
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
              { kind: "agent", id: document.getElementById("agentId").value.trim() || defaultAgents[dataSource] || ${JSON.stringify(defaultAgentId)} },
              { kind: "datasource", id: dataSource },
            ],
            suggestedPrompts: [
              dataSource === "litellm" ? "Explain the biggest LiteLLM usage and spend drivers in this dashboard." : "Explain the biggest AWS cost drivers in this FinOps context.",
              dataSource === "litellm" ? "Which users or models should we investigate first?" : "Draft optimization tasks for the top three savings opportunities.",
              dataSource === "litellm" ? "Create an action plan to reduce high LLM spend safely." : "Which anomaly should a platform engineer investigate first?",
            ],
          },
        }, "*");
        document.getElementById("assistantStatus").textContent =
          "Shared dashboard context to FinOps chat from " + source + ".";
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

      function formatCount(value) {
        if (value === undefined || value === null) return "—";
        const numeric = Number(value);
        if (!Number.isFinite(numeric)) return "—";
        return new Intl.NumberFormat("en-US", {
          notation: Math.abs(numeric) >= 1_000_000 ? "compact" : "standard",
          maximumFractionDigits: Math.abs(numeric) >= 1_000_000 ? 1 : 0,
        }).format(numeric);
      }

      function formatDriverValue(row, currency) {
        const amount = numberOrNull(row?.amount);
        const tokens = numberOrNull(row?.totalTokens);
        const requests = numberOrNull(row?.requests);
        const parts = [];
        if (amount !== null && amount > 0) parts.push(formatMoney(amount, currency));
        if (tokens !== null && tokens > 0) parts.push(formatCount(tokens) + " tokens");
        if (!parts.length && requests !== null && requests > 0) parts.push(formatCount(requests) + " requests");
        return parts.join(" · ") || "Needs agent";
      }

      function numberOrNull(value) {
        if (value === undefined || value === null || value === "") return null;
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

async function readJsonBody(request) {
  const chunks = [];
  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  const raw = Buffer.concat(chunks).toString("utf8").trim();
  if (!raw) return {};
  return JSON.parse(raw);
}

function normalizeBasePath(value) {
  const trimmed = String(value || "").trim();
  if (!trimmed || trimmed === "/") return "/";
  return trimmed.startsWith("/") ? trimmed.replace(/\/+$/, "") : `/${trimmed.replace(/\/+$/, "")}`;
}

function normalizeDataSource(value) {
  return String(value || "").toLowerCase() === "litellm" ? "litellm" : "aws-cost-explorer";
}

function agentIdForDataSource(value) {
  return normalizeDataSource(value) === "litellm" ? defaultLiteLlmAgentId : defaultAwsAgentId;
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}
