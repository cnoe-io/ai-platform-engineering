#!/usr/bin/env node

// assisted-by Codex Codex-sonnet-4-6
import { createServer } from "node:http";

import { createAgenticAppJwtVerifier } from "../_lib/jwt-verify.mjs";

const port = Number(process.env.FINOPS_APP_PORT ?? "3010");
const basePath = normalizeBasePath(process.env.FINOPS_APP_BASE_PATH ?? "/apps/finops");

// Phase 2 trust contract: each request from the CAIPE host gateway carries the
// user's OIDC id_token as `Authorization: Bearer <jwt>`. We verify it here
// against the IdP's JWKS endpoint and trust nothing else from the host.
const verifier = process.env.AGENTIC_APP_FINOPS_JWT_DISABLED === "true"
  ? null
  : createAgenticAppJwtVerifier({ appId: "finops" });

const summary = {
  monthToDateSpend: "$128.4K",
  forecast: "$173.8K",
  savingsOpportunity: "$31.2K",
  anomalyCount: 3,
  lastUpdated: new Date().toISOString(),
};

const server = createServer(async (request, response) => {
  const url = new URL(request.url ?? "/", `http://${request.headers.host ?? "localhost"}`);

  if (url.pathname === "/healthz") {
    sendJson(response, 200, { ok: true, app: "finops", runtime: "separate-process" });
    return;
  }

  if (verifier) {
    const result = await verifier(request.headers);
    if (!result.ok) {
      sendJson(response, result.status, {
        error: "unauthorized",
        reason: result.reason,
      });
      return;
    }
    request.caipeIdentity = result.identity;
  }

  if (url.pathname === "/api/summary") {
    sendJson(response, 200, summary);
    return;
  }

  if (url.pathname === "/embed") {
    response.writeHead(200, {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "no-store",
    });
    response.end(renderFinOpsFragment());
    return;
  }

  if (url.pathname === "/" || url.pathname === "/dashboard") {
    response.writeHead(200, {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "no-store",
    });
    response.end(renderDashboard());
    return;
  }

  sendJson(response, 404, { error: "not_found" });
});

server.listen(port, () => {
  console.log(`FinOps sample app listening on http://localhost:${port}`);
  console.log(`Configure CAIPE with AGENTIC_APP_FINOPS_ORIGIN=http://localhost:${port}`);
});

function renderDashboard() {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>FinOps Dashboard</title>
    <style>
      :root {
        color-scheme: dark;
        font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        background: #020617;
        color: #e2e8f0;
      }
      * { box-sizing: border-box; }
      body {
        margin: 0;
        min-height: 100vh;
        background:
          radial-gradient(circle at top left, rgba(34, 211, 238, 0.18), transparent 36rem),
          linear-gradient(135deg, #020617 0%, #0f172a 55%, #111827 100%);
      }
      main { max-width: 1120px; margin: 0 auto; padding: 48px 24px; }
      .hero {
        border: 1px solid rgba(255,255,255,0.12);
        border-radius: 28px;
        padding: 32px;
        background: rgba(15, 23, 42, 0.72);
        box-shadow: 0 30px 90px rgba(8, 47, 73, 0.25);
        backdrop-filter: blur(18px);
      }
      .eyebrow {
        margin: 0 0 12px;
        color: #67e8f9;
        font-size: 12px;
        font-weight: 800;
        letter-spacing: 0.24em;
        text-transform: uppercase;
      }
      h1 { margin: 0; font-size: clamp(36px, 6vw, 64px); letter-spacing: -0.06em; }
      .subtitle { max-width: 720px; color: #cbd5e1; line-height: 1.7; font-size: 17px; }
      .grid { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 16px; margin-top: 24px; }
      .card {
        border: 1px solid rgba(255,255,255,0.1);
        border-radius: 22px;
        padding: 22px;
        background: rgba(2, 6, 23, 0.58);
      }
      .label { color: #94a3b8; font-size: 13px; }
      .value { margin-top: 8px; font-size: 30px; font-weight: 800; color: white; letter-spacing: -0.04em; }
      .panel {
        margin-top: 18px;
        border-radius: 22px;
        border: 1px solid rgba(103,232,249,0.2);
        background: rgba(8,47,73,0.26);
        padding: 22px;
      }
      .panel h2 { margin: 0 0 10px; }
      .panel ul { margin: 0; padding-left: 20px; color: #cbd5e1; line-height: 1.8; }
      code { color: #67e8f9; }
      @media (max-width: 860px) {
        .grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
      }
      @media (max-width: 560px) {
        .grid { grid-template-columns: 1fr; }
      }
    </style>
  </head>
  <body>
    <main>
      <section class="hero">
        <p class="eyebrow">Separate Agentic App</p>
        <h1>FinOps Dashboard</h1>
        <p class="subtitle">
          This page is served by a standalone Node process and mounted inside CAIPE through
          the host app proxy at <code>${escapeHtml(basePath)}</code>. It proves the manifest,
          registry, hub, and same-origin routing path for future agentic apps.
        </p>

        <div class="grid">
          <div class="card">
            <div class="label">Month-to-date spend</div>
            <div class="value">${summary.monthToDateSpend}</div>
          </div>
          <div class="card">
            <div class="label">Forecast</div>
            <div class="value">${summary.forecast}</div>
          </div>
          <div class="card">
            <div class="label">Savings opportunity</div>
            <div class="value">${summary.savingsOpportunity}</div>
          </div>
          <div class="card">
            <div class="label">Open anomalies</div>
            <div class="value">${summary.anomalyCount}</div>
          </div>
        </div>
      </section>

      <section class="panel">
        <h2>Agentic workflow preview</h2>
        <ul>
          <li>Explain EC2 and EKS spend variance across linked accounts.</li>
          <li>Draft savings-plan recommendations for human approval.</li>
          <li>Open optimization tasks in the host CAIPE workflow system.</li>
        </ul>
      </section>
    </main>
  </body>
</html>`;
}

function renderFinOpsFragment() {
  return `<section class="finops-fragment" style="font-family: Inter, ui-sans-serif, system-ui; color: #e2e8f0;">
  <div style="border: 1px solid rgba(255,255,255,0.12); border-radius: 24px; padding: 24px; background: linear-gradient(135deg, rgba(16,185,129,0.18), rgba(8,47,73,0.35));">
    <p style="margin: 0 0 10px; color: #6ee7b7; font-size: 12px; font-weight: 800; letter-spacing: 0.2em; text-transform: uppercase;">FinOps fragment</p>
    <h2 style="margin: 0; color: white; font-size: 28px;">Savings radar</h2>
    <p style="margin: 12px 0 0; line-height: 1.6; color: #cbd5e1;">${summary.savingsOpportunity} in candidate savings across ${summary.anomalyCount} active anomalies.</p>
  </div>
</section>`;
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
