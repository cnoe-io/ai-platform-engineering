#!/usr/bin/env node

// assisted-by Codex Codex-sonnet-4-6

import { createServer } from "node:http";

import { createAgenticAppJwtVerifier } from "../_lib/jwt-verify.mjs";

const port = Number(process.env.AGENTIC_SDLC_APP_PORT ?? "3030");

export function createAgenticSdlcReferenceServer() {
  const verifier = process.env.AGENTIC_APP_AGENTIC_SDLC_JWT_DISABLED === "true"
    ? null
    : createAgenticAppJwtVerifier({ appId: "agentic-sdlc" });

  return createServer(async (request, response) => {
    const url = new URL(request.url ?? "/", `http://${request.headers.host ?? "localhost"}`);

    if (url.pathname === "/healthz") {
      sendJson(response, 200, { ok: true, app: "agentic-sdlc", runtime: "external-reference" });
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
      response.end(renderAgenticSdlcHome());
      return;
    }

    sendJson(response, 404, { error: "not_found" });
  });
}

export function renderAgenticSdlcHome() {
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
    </style>
  </head>
  <body>
    <main>
      <section>
        <p>External Reference App</p>
        <h1>Agentic SDLC</h1>
        <p>This runtime exercises the generic CAIPE Agentic App manifest, proxy, token, webhook, and assistant contracts outside the host source tree.</p>
        <p>Old bookmarks under <code>/apps/agentic-sdlc/:owner/:repo</code> remain compatible through the host migration page.</p>
        <div class="controls">
          <input id="agentId" aria-label="Agent id" value="agent-agentic-sdlc" />
          <input id="repoInput" aria-label="Repository" value="current workspace" />
          <button id="loadDashboard">Pull Delivery Dashboard</button>
        </div>
        <div id="dashboard" class="dashboard">Ask the custom <code>agentic-sdlc</code> CAIPE agent for a delivery-dashboard summary.</div>
      </section>
      <script>
        const dashboard = document.getElementById("dashboard");
        document.getElementById("loadDashboard").addEventListener("click", pullDeliveryDashboard);

        async function pullDeliveryDashboard() {
          const agentId = document.getElementById("agentId").value.trim() || "agent-agentic-sdlc";
          const repository = document.getElementById("repoInput").value.trim() || "current workspace";
          dashboard.textContent = "Calling CAIPE dynamic agent " + agentId + "...";
          try {
            const response = await fetch("/api/v1/chat/invoke", {
              method: "POST",
              headers: { "content-type": "application/json", accept: "application/json" },
              body: JSON.stringify({
                agent_id: agentId,
                message: [
                  "Build a delivery-dashboard for " + repository + ".",
                  "Return JSON first, then a concise explanation.",
                  "JSON schema: { repository, stage, risks: string[], openWork: string[], recommendedNextActions: string[] }.",
                  "Use only available CAIPE SDLC context and say what is missing if the repo cannot be inspected."
                ].join(" "),
                conversation_id: "agentic-sdlc-dashboard-" + Date.now(),
                client_context: {
                  source: "agentic-app",
                  appId: "agentic-sdlc",
                  dashboardKind: "delivery-dashboard",
                  repository,
                },
              }),
            });
            const payload = await response.json();
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
