#!/usr/bin/env node

// assisted-by Codex Codex-sonnet-4-6

import { createServer } from "node:http";

import { handleAppMcpRequest } from "../_lib/app-mcp-server.mjs";
import { renderAgenticAppConversationClient } from "../_lib/conversation-client.mjs";
import { createRequiredAgenticAppJwtVerifier } from "../_lib/jwt-verify.mjs";
import { authorizeAgenticAppRuntimeRequest } from "../_lib/runtime-authorization.mjs";
import { registerAgenticSdlcMcpTools } from "./mcp.mjs";

const port = Number(process.env.AGENTIC_SDLC_APP_PORT ?? "3030");
const githubApiBase = String(process.env.AGENTIC_SDLC_GITHUB_API_URL ?? "https://api.github.com").replace(/\/+$/, "");
const githubToken = String(process.env.AGENTIC_SDLC_GITHUB_TOKEN ?? process.env.GITHUB_TOKEN ?? "").trim();

export function createAgenticSdlcReferenceServer() {
  const verifier = createRequiredAgenticAppJwtVerifier({
    appId: "agentic-sdlc",
    disabled: process.env.AGENTIC_APP_AGENTIC_SDLC_JWT_DISABLED === "true",
  });

  return createServer(async (request, response) => {
    const url = new URL(request.url ?? "/", `http://${request.headers.host ?? "localhost"}`);

    if (url.pathname === "/healthz") {
      sendJson(response, 200, {
        ok: true,
        app: "agentic-sdlc",
        runtime: "external-reference",
        mcp: { endpoint: "/mcp", authentication: "forwarded-bearer" },
      });
      return;
    }

    if (url.pathname === "/mcp") {
      await handleAppMcpRequest(request, response, {
        name: "agentic-sdlc-app",
        authenticationDisabled: process.env.AGENTIC_APP_AGENTIC_SDLC_MCP_AUTH_DISABLED === "true",
        registerTools(mcpServer) {
          registerAgenticSdlcMcpTools(mcpServer, {
            getRepositorySnapshot,
            getRuntimeContract,
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
      appId: "agentic-sdlc",
      method: request.method,
      readScope: "sdlc:read",
      invokeScope: "agents:invoke",
      allowDevelopmentBypass: verifier === null,
    });
    if (!authorization.ok) {
      sendJson(response, authorization.status, {
        error: authorization.error,
        requiredScope: authorization.requiredScope,
      });
      return;
    }

    if (url.pathname === "/webhooks/github" && request.method === "POST") {
      const body = await readJsonBody(request);
      sendJson(response, 202, {
        ok: true,
        app: "agentic-sdlc",
        received: "github",
        event: request.headers["x-github-event"] ?? null,
        deliveryId: request.headers["x-github-delivery"] ?? null,
        repository: body?.repository?.full_name ?? null,
        decisionId: request.headers["x-caipe-decision-id"] ?? null,
      });
      return;
    }

    if (url.pathname === "/" || url.pathname === "/repos") {
      response.writeHead(200, {
        "content-type": "text/html; charset=utf-8",
        "cache-control": "no-store",
      });
      response.end(renderAgenticSdlcHome(authorization.summary));
      return;
    }

    sendJson(response, 404, { error: "not_found" });
  });
}

async function getRepositorySnapshot(repo) {
  const headers = {
    accept: "application/vnd.github+json",
    "user-agent": "caipe-agentic-sdlc-app",
    ...(githubToken ? { authorization: `Bearer ${githubToken}` } : {}),
  };
  const fetchJson = async (path) => {
    const upstreamResponse = await fetch(`${githubApiBase}${path}`, { headers });
    if (!upstreamResponse.ok) {
      throw new Error(`GitHub request failed with status ${upstreamResponse.status}`);
    }
    return upstreamResponse.json();
  };
  const encodedRepo = repo.split("/").map(encodeURIComponent).join("/");
  const [metadata, pulls, issues, workflows] = await Promise.all([
    fetchJson(`/repos/${encodedRepo}`),
    fetchJson(`/repos/${encodedRepo}/pulls?state=open&per_page=20`),
    fetchJson(`/repos/${encodedRepo}/issues?state=open&per_page=20`),
    fetchJson(`/repos/${encodedRepo}/actions/runs?per_page=20`),
  ]);
  const openIssues = issues.filter((issue) => !issue.pull_request);
  const workflowRuns = Array.isArray(workflows.workflow_runs) ? workflows.workflow_runs : [];
  return {
    repository: metadata.full_name,
    generatedAt: new Date().toISOString(),
    defaultBranch: metadata.default_branch,
    visibility: metadata.visibility,
    archived: Boolean(metadata.archived),
    openPullRequests: pulls.map((pull) => ({
      number: pull.number,
      title: pull.title,
      draft: Boolean(pull.draft),
      updatedAt: pull.updated_at,
      url: pull.html_url,
    })),
    openIssues: openIssues.map((issue) => ({
      number: issue.number,
      title: issue.title,
      updatedAt: issue.updated_at,
      url: issue.html_url,
    })),
    workflowRuns: workflowRuns.map((run) => ({
      name: run.name,
      status: run.status,
      conclusion: run.conclusion,
      branch: run.head_branch,
      updatedAt: run.updated_at,
      url: run.html_url,
    })),
    limits: { pullRequests: 20, issues: 20, workflowRuns: 20 },
  };
}

function getRuntimeContract() {
  return {
    appId: "agentic-sdlc",
    agentId: "agent-agentic-sdlc",
    authorization: "CAS/OpenFGA through AgentGateway",
    capabilities: ["repository-snapshot", "github-webhook-receipt", "delivery-dashboard"],
    webhooks: [{ path: "/webhooks/github", method: "POST" }],
    mutations: "No MCP mutation tools are exposed by this reference runtime.",
  };
}

export function renderAgenticSdlcHome(authorization = null) {
  const auth = authorization ?? {
    launchDecision: "NOT EVALUATED",
    appResource: "agentic_app:agentic-sdlc",
    decisionReference: "static-render",
    tokenAudience: "agentic-app:agentic-sdlc",
    readScope: "sdlc:read",
  };
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Agentic SDLC Reference</title>
    <style>
      :root { color-scheme: dark; font-family: Inter, ui-sans-serif, system-ui, sans-serif; background: #020617; color: #e2e8f0; }
      body { margin: 0; min-height: 100vh; background: radial-gradient(circle at top left, rgba(34,211,238,.2), transparent 34rem), #020617; }
      main { max-width: 960px; margin: 0 auto; padding: 56px 24px; }
      section { border: 1px solid rgba(255,255,255,.12); border-radius: 28px; padding: 32px; background: rgba(15,23,42,.72); }
      p { color: #cbd5e1; line-height: 1.7; }
      code { color: #67e8f9; }
      input, button { border-radius: 999px; border: 1px solid rgba(255,255,255,.14); background: rgba(2,6,23,.78); color: #e2e8f0; padding: 12px 16px; font: inherit; }
      button { cursor: pointer; background: linear-gradient(135deg, #0284c7, #7c3aed); font-weight: 900; }
      .controls { display: flex; flex-wrap: wrap; gap: 12px; margin-top: 24px; }
      .dashboard { margin-top: 18px; border-radius: 20px; border: 1px solid rgba(255,255,255,.1); background: rgba(2,6,23,.58); padding: 18px; white-space: pre-wrap; color: #cbd5e1; }
      .authz { display: grid; grid-template-columns: repeat(3, minmax(0,1fr)); gap: 10px; margin: 18px 0; }
      .authz div { padding: 12px; border: 1px solid rgba(103,232,249,.22); border-radius: 14px; background: rgba(8,47,73,.28); }
      .authz small { display: block; color: #94a3b8; margin-bottom: 5px; }
      @media (max-width: 700px) { .authz { grid-template-columns: 1fr; } }
    </style>
  </head>
  <body>
    <main>
      <section>
        <p>External Reference App</p>
        <h1>Agentic SDLC</h1>
        <p>This runtime exercises the generic CAIPE Agentic App manifest, proxy, token, webhook, and assistant contracts outside the host source tree.</p>
        <div class="authz" aria-label="CAS authorization example">
          <div><small>CAS app grant</small><strong>${escapeHtml(auth.launchDecision)}</strong><br /><code>${escapeHtml(auth.appResource)}#use</code></div>
          <div><small>Scoped runtime token</small><strong>${escapeHtml(auth.tokenAudience)}</strong><br /><code>${escapeHtml(auth.readScope)}</code></div>
          <div><small>Safe decision reference</small><strong>${escapeHtml(auth.decisionReference)}</strong><br />No token or identity is displayed.</div>
        </div>
        <p>Old bookmarks under <code>/apps/agentic-sdlc/:owner/:repo</code> remain compatible through the host migration page.</p>
        <div class="controls">
          <input id="agentId" aria-label="Agent id" value="agent-agentic-sdlc" />
          <input id="repoInput" aria-label="Repository" value="current workspace" />
          <button id="loadDashboard">Pull Delivery Dashboard</button>
        </div>
        <div id="dashboard" class="dashboard">Ask the custom <code>agentic-sdlc</code> CAIPE agent for a delivery-dashboard summary.</div>
      </section>
      ${renderAgenticAppConversationClient()}
      <script>
        const dashboard = document.getElementById("dashboard");
        document.getElementById("loadDashboard").addEventListener("click", pullDeliveryDashboard);

        async function pullDeliveryDashboard() {
          const agentId = document.getElementById("agentId").value.trim() || "agent-agentic-sdlc";
          const repository = document.getElementById("repoInput").value.trim() || "current workspace";
          dashboard.textContent = "Calling CAIPE dynamic agent " + agentId + "...";
          try {
            const payload = await invokeAgenticApp({
              agentId,
              appId: "agentic-sdlc",
              title: "Agentic SDLC dashboard · " + repository,
              message: [
                "Build a delivery-dashboard for " + repository + ".",
                "Return JSON first, then a concise explanation.",
                "JSON schema: { repository, stage, risks: string[], openWork: string[], recommendedNextActions: string[] }.",
                "Use only available CAIPE SDLC context and say what is missing if the repo cannot be inspected."
              ].join(" "),
              clientContext: {
                dashboardKind: "delivery-dashboard",
                repository,
              },
            });
            const content = payload.content || payload.message || JSON.stringify(payload, null, 2);
            dashboard.textContent = content;
            publishContext("Agentic SDLC delivery dashboard", content, agentId);
          } catch (error) {
            dashboard.textContent = "Could not reach CAIPE Dynamic Agents from this runtime yet.";
            publishContext("Agentic SDLC dashboard unavailable", dashboard.textContent, agentId);
          }
        }

        function publishContext(title, selection, agentId) {
          window.parent?.postMessage({
            type: "caipe.agenticApp.context.v1",
            version: "1.0",
            appId: "agentic-sdlc",
            context: {
              route: "/",
              title,
              summary: selection.slice(0, 500),
              selection: selection.slice(0, 3000),
              resourceRefs: [{ kind: "agent", id: agentId }],
              suggestedPrompts: [
                "Summarize delivery risk from this SDLC dashboard",
                "Draft next engineering actions",
                "Explain which repo signal is missing"
              ]
            }
          }, window.location.origin);
        }

        window.parent?.postMessage({
          type: "caipe.agenticApp.context.v1",
          version: "1.0",
          appId: "agentic-sdlc",
          context: {
            route: "/",
            title: "Agentic SDLC",
            summary: "User is viewing the external Agentic SDLC reference runtime.",
            suggestedPrompts: ["Summarize this repository workflow"]
          }
        }, window.location.origin);
      </script>
    </main>
  </body>
</html>`;
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#039;",
  })[character]);
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
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > 128 * 1024) {
      throw new Error("request_body_too_large");
    }
    chunks.push(chunk);
  }
  if (!chunks.length) return {};
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

if (import.meta.url === `file://${process.argv[1]}`) {
  createAgenticSdlcReferenceServer().listen(port, () => {
    console.log(`Agentic SDLC reference app listening on http://localhost:${port}`);
    console.log(`Configure CAIPE with AGENTIC_APP_AGENTIC_SDLC_ORIGIN=http://localhost:${port}`);
  });
}
