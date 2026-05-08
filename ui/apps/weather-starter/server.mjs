#!/usr/bin/env node

// assisted-by Codex Codex-sonnet-4-6
import { createServer } from "node:http";

import { createAgenticAppJwtVerifier } from "../_lib/jwt-verify.mjs";

const port = Number(process.env.WEATHER_APP_PORT ?? "3020");
const basePath = normalizeBasePath(process.env.WEATHER_APP_BASE_PATH ?? "/apps/weather");
const defaultCity = "San Jose, CA";

// Phase 2 trust contract: each request from the CAIPE host gateway carries the
// user's OIDC id_token as `Authorization: Bearer <jwt>`. We verify it here
// against the IdP's JWKS endpoint and trust nothing else from the host.
const verifier = process.env.AGENTIC_APP_WEATHER_JWT_DISABLED === "true"
  ? null
  : createAgenticAppJwtVerifier({ appId: "weather" });

const server = createServer(async (request, response) => {
  const url = new URL(request.url ?? "/", `http://${request.headers.host ?? "localhost"}`);

  if (url.pathname === "/healthz") {
    sendJson(response, 200, {
      ok: true,
      app: "weather",
      runtime: "separate-process",
      generativeUi: "ag-ui",
    });
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

  if (url.pathname === "/api/weather") {
    sendJson(response, 200, buildWeatherState(normalizeCity(url.searchParams.get("city"))));
    return;
  }

  if (url.pathname === "/embed") {
    response.writeHead(200, {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "no-store",
    });
    response.end(renderWeatherFragment(normalizeCity(url.searchParams.get("city"))));
    return;
  }

  if (url.pathname === "/api/ag-ui/weather-layout") {
    const city = normalizeCity(url.searchParams.get("city"));
    sendJson(response, 200, buildAgUiWeatherEnvelope(city, "forecast-summary"));
    return;
  }

  if (url.pathname === "/api/copilotkit/weather-agent" && request.method === "POST") {
    try {
      const body = await readJsonBody(request);
      const city = normalizeCity(body?.city);
      const intent = normalizeIntent(body?.intent);
      sendJson(response, 200, {
        message: `Weather Advisor prepared a ${intent.replaceAll("-", " ")} layout for ${city}.`,
        agUi: buildAgUiWeatherEnvelope(city, intent),
      });
    } catch (error) {
      sendJson(response, 400, { error: "invalid_weather_agent_request" });
    }
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
  console.log(`Weather starter app listening on http://localhost:${port}`);
  console.log(`Configure CAIPE with AGENTIC_APP_WEATHER_ORIGIN=http://localhost:${port}`);
});

function buildWeatherState(city) {
  return {
    city,
    observedAt: new Date().toISOString(),
    current: {
      temperature: "72°F",
      condition: "Clear",
      wind: "7 mph NW",
      airQuality: "Good",
    },
    forecast: [
      { day: "Today", high: "74°F", low: "56°F", condition: "Clear" },
      { day: "Tomorrow", high: "69°F", low: "54°F", condition: "Clouds building" },
      { day: "Saturday", high: "66°F", low: "51°F", condition: "Light rain" },
    ],
    recommendations: [
      "Good window for outdoor standups before 3 PM.",
      "Pack a light jacket for the evening temperature drop.",
      "Rain-sensitive deploy windows should avoid Saturday morning travel.",
    ],
  };
}

function buildAgUiWeatherEnvelope(city, intent) {
  const weather = buildWeatherState(city);
  const runId = `weather-${Date.now()}`;
  // Compatibility-oriented demo shape: constrained AG-UI-style events and
  // CopilotKit action metadata, not a byte-for-byte protocol compatibility test.
  return {
    protocol: "ag-ui",
    version: "1.0",
    runId,
    intent,
    generatedBy: {
      agentId: "weather-advisor",
      copilotKitPrimitive: "useCopilotAction",
      actionName: "renderWeatherLayout",
    },
    events: [
      { type: "RUN_STARTED", runId },
      { type: "STATE_DELTA", path: "weather.current", value: weather.current },
      {
        type: "UI_RENDER",
        component: "WeatherCurrentCard",
        props: { city: weather.city, ...weather.current },
      },
      {
        type: "UI_RENDER",
        component: "WeatherForecastTimeline",
        props: { forecast: weather.forecast },
      },
      {
        type: "UI_RENDER",
        component: "WeatherRecommendationList",
        props: { recommendations: weather.recommendations },
      },
      { type: "RUN_FINISHED", runId },
    ],
    surfaces: [
      { type: "weather.current", props: { city: weather.city, ...weather.current } },
      { type: "weather.forecast", props: { forecast: weather.forecast } },
      { type: "weather.recommendations", props: { recommendations: weather.recommendations } },
    ],
    copilotKit: {
      pattern: "Register this layout through useCopilotAction and render known components.",
      action: {
        name: "renderWeatherLayout",
        parameters: [
          { name: "city", type: "string", required: true },
          { name: "intent", type: "string", required: false },
        ],
      },
    },
  };
}

function renderDashboard() {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Weather Starter</title>
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
          radial-gradient(circle at top left, rgba(56, 189, 248, 0.22), transparent 34rem),
          radial-gradient(circle at bottom right, rgba(16, 185, 129, 0.16), transparent 32rem),
          linear-gradient(135deg, #020617 0%, #0f172a 58%, #082f49 100%);
      }
      main { max-width: 1120px; margin: 0 auto; padding: 44px 24px; }
      .hero, .panel, .surface {
        border: 1px solid rgba(255,255,255,0.12);
        background: rgba(15, 23, 42, 0.72);
        box-shadow: 0 30px 90px rgba(8, 47, 73, 0.24);
        backdrop-filter: blur(18px);
      }
      .hero { border-radius: 30px; padding: 32px; }
      .eyebrow {
        margin: 0 0 12px;
        color: #7dd3fc;
        font-size: 12px;
        font-weight: 800;
        letter-spacing: 0.22em;
        text-transform: uppercase;
      }
      h1 { margin: 0; font-size: clamp(36px, 6vw, 64px); letter-spacing: -0.06em; }
      .subtitle { max-width: 760px; color: #cbd5e1; line-height: 1.7; font-size: 17px; }
      .controls { display: flex; flex-wrap: wrap; gap: 12px; margin-top: 22px; }
      input, button {
        border-radius: 999px;
        border: 1px solid rgba(255,255,255,0.14);
        background: rgba(2, 6, 23, 0.72);
        color: #e2e8f0;
        padding: 12px 16px;
        font: inherit;
      }
      button { cursor: pointer; background: linear-gradient(135deg, #0284c7, #059669); font-weight: 800; }
      .layout { display: grid; grid-template-columns: 1.2fr 0.8fr; gap: 18px; margin-top: 18px; }
      .panel, .surface { border-radius: 24px; padding: 22px; }
      .surface h2, .panel h2 { margin: 0 0 12px; }
      .cards { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 14px; }
      .card { border-radius: 20px; padding: 18px; background: rgba(2, 6, 23, 0.62); border: 1px solid rgba(255,255,255,0.1); }
      .label { color: #94a3b8; font-size: 13px; }
      .value { margin-top: 6px; font-size: 26px; font-weight: 850; color: white; letter-spacing: -0.04em; }
      ul { margin: 0; padding-left: 20px; color: #cbd5e1; line-height: 1.8; }
      code, pre { color: #67e8f9; }
      pre {
        overflow: auto;
        border-radius: 18px;
        background: rgba(2, 6, 23, 0.72);
        padding: 16px;
        border: 1px solid rgba(125, 211, 252, 0.18);
      }
      @media (max-width: 860px) {
        .layout { grid-template-columns: 1fr; }
        .cards { grid-template-columns: 1fr; }
      }
    </style>
  </head>
  <body>
    <main>
      <section class="hero">
        <p class="eyebrow">Template App · CopilotKit / AG-UI First</p>
        <h1>Weather Starter</h1>
        <p class="subtitle">
          This standalone app is mounted through CAIPE at <code>${escapeHtml(basePath)}</code>.
          It demonstrates the preferred pattern for new agentic apps: fixed shell,
          constrained AG-UI surfaces, and a CopilotKit action boundary that can be
          connected to a custom weather agent.
        </p>
        <div class="controls">
          <input id="city" value="${escapeHtml(defaultCity)}" aria-label="City" />
          <button id="refresh" type="button">Ask Weather Advisor</button>
        </div>
      </section>

      <div class="layout">
        <section class="surface">
          <h2>Agent-rendered AG-UI surfaces</h2>
          <div id="surfaces" class="cards" aria-live="polite"></div>
        </section>
        <section class="panel">
          <h2>CopilotKit primitive</h2>
          <p class="subtitle">
            React apps can register these known layouts as frontend actions instead
            of rendering arbitrary HTML from an agent.
          </p>
          <pre>useCopilotAction({
  name: "renderWeatherLayout",
  parameters: [{ name: "city", type: "string" }],
  render: ({ args }) =&gt; &lt;WeatherLayout city={args.city} /&gt;,
});</pre>
        </section>
      </div>
    </main>
    <script>
      const surfaces = document.getElementById("surfaces");
      const input = document.getElementById("city");
      const button = document.getElementById("refresh");
      button.addEventListener("click", () => renderWeather(input.value));
      renderWeather(input.value);

      async function renderWeather(city) {
        const res = await fetch("/api/ag-ui/weather-layout?city=" + encodeURIComponent(city), {
          headers: { accept: "application/json" },
        });
        if (!res.ok) {
          surfaces.replaceChildren(listCard("Weather Advisor unavailable", [
            "The template app could not load its AG-UI layout endpoint.",
          ]));
          return;
        }
        const envelope = await res.json();
        surfaces.replaceChildren(...envelope.surfaces.map(renderSurface));
      }

      function renderSurface(surface) {
        if (surface.type === "weather.current") {
          return card("Current in " + surface.props.city, [
            ["Temperature", surface.props.temperature],
            ["Condition", surface.props.condition],
            ["Wind", surface.props.wind],
            ["Air quality", surface.props.airQuality],
          ]);
        }
        if (surface.type === "weather.forecast") {
          return listCard("Forecast", surface.props.forecast.map((day) =>
            day.day + ": " + day.condition + " · " + day.high + " / " + day.low
          ));
        }
        return listCard("Advisor suggestions", surface.props.recommendations);
      }

      function card(title, rows) {
        const node = document.createElement("article");
        node.className = "card";
        const heading = document.createElement("h3");
        heading.textContent = title;
        node.append(heading, ...rows.map(([label, value]) => {
          const row = document.createElement("div");
          const labelNode = document.createElement("div");
          const valueNode = document.createElement("div");
          labelNode.className = "label";
          valueNode.className = "value";
          labelNode.textContent = label;
          valueNode.textContent = value;
          row.append(labelNode, valueNode);
          return row;
        }));
        return node;
      }

      function listCard(title, items) {
        const node = document.createElement("article");
        node.className = "card";
        const heading = document.createElement("h3");
        const list = document.createElement("ul");
        heading.textContent = title;
        items.forEach((item) => {
          const li = document.createElement("li");
          li.textContent = item;
          list.appendChild(li);
        });
        node.append(heading, list);
        return node;
      }
    </script>
  </body>
</html>`;
}

function renderWeatherFragment(city) {
  const weather = buildWeatherState(city);
  return `<section id="weather-fragment" data-agentic-app="weather">
  <div class="weather-fragment-card">
    <p class="weather-fragment-eyebrow">Fragment mode</p>
    <h2>Weather in ${escapeHtml(weather.city)}</h2>
    <p>${escapeHtml(weather.current.condition)} · ${escapeHtml(weather.current.temperature)} · ${escapeHtml(weather.current.wind)}</p>
    <ul>
      ${weather.recommendations.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}
    </ul>
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

function normalizeCity(value) {
  const input = String(value || defaultCity).trim().slice(0, 80);
  return /^[A-Za-z0-9 ,.'-]+$/.test(input) && input ? input : defaultCity;
}

function normalizeIntent(value) {
  const input = String(value || "forecast-summary").trim().toLowerCase();
  return ["forecast-summary", "travel-planning", "weather-alert-explanation"].includes(input)
    ? input
    : "forecast-summary";
}

async function readJsonBody(request) {
  if (request.bufferedBody) {
    if (request.bufferedBody.length === 0) return {};
    return JSON.parse(request.bufferedBody.toString("utf8"));
  }
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > 64 * 1024) {
      throw new Error("request_body_too_large");
    }
    chunks.push(chunk);
  }
  if (!chunks.length) return {};
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}
