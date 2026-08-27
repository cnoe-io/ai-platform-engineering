#!/usr/bin/env node

import { readFile } from "node:fs/promises";
import { createServer } from "node:http";

import { createRequiredAgenticAppJwtVerifier } from "../../_lib/jwt-verify.mjs";
import { renderMicrofrontendClient } from "../../_lib/microfrontend-client.mjs";
import { authorizeAgenticAppRuntimeRequest } from "../../_lib/runtime-authorization.mjs";
import { resolveAgenticAppSurface } from "../../_lib/runtime-base-path.mjs";
import {
  EXAMPLE_SPEAKERS_COLLECTIVE_CONFIG,
  normalizeSpeakersCollectiveConfig,
} from "./dashboard.mjs";

const appId = "speakers-collective";
const port = Number(process.env.SPEAKERS_COLLECTIVE_APP_PORT ?? "3043");
const dataFile = String(process.env.SPEAKERS_COLLECTIVE_DATA_FILE || "").trim();
const verifier = createRequiredAgenticAppJwtVerifier({
  appId,
  disabled: process.env.AGENTIC_APP_SPEAKERS_COLLECTIVE_JWT_DISABLED === "true",
});

const server = createServer(async (request, response) => {
  const url = new URL(request.url ?? "/", `http://${request.headers.host ?? "localhost"}`);

  if (url.pathname === "/healthz") {
    try {
      const config = await loadDashboardConfig();
      sendJson(response, 200, {
        ok: true,
        app: appId,
        runtime: "separate-process",
        dataSource: config.fixture ? "fixture" : "configured-json",
        events: config.events.length,
        lastScan: config.lastScan || null,
      });
    } catch (error) {
      sendJson(response, 503, {
        ok: false,
        app: appId,
        error: "event_source_invalid",
        message: error instanceof Error ? error.message : "The event source is unavailable",
      });
    }
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
    appId,
    method: request.method,
    readScope: "speakers-collective:read",
    invokeScope: "speakers-collective:manage",
    allowDevelopmentBypass: verifier === null,
  });
  if (!authorization.ok) {
    sendJson(response, authorization.status, {
      error: authorization.error,
      requiredScope: authorization.requiredScope,
    });
    return;
  }

  if (request.method !== "GET" && request.method !== "HEAD") {
    sendJson(response, 405, { error: "method_not_allowed" });
    return;
  }

  try {
    const config = url.pathname === "/example"
      ? normalizeSpeakersCollectiveConfig(EXAMPLE_SPEAKERS_COLLECTIVE_CONFIG, { fixture: true })
      : await loadDashboardConfig();

    if (url.pathname === "/api/events") {
      sendJson(response, 200, config, request.method === "HEAD");
      return;
    }

    if (url.pathname === "/" || url.pathname === "/dashboard" || url.pathname === "/example") {
      sendHtml(
        response,
        renderDashboard(config, {
          compact: resolveAgenticAppSurface(request.headers) === "hosted",
          authorization: authorization.summary,
        }),
        request.method === "HEAD",
      );
      return;
    }
  } catch (error) {
    sendHtml(
      response,
      renderSourceError(error instanceof Error ? error.message : "The event source is unavailable"),
      request.method === "HEAD",
      503,
    );
    return;
  }

  sendJson(response, 404, { error: "not_found" });
});

server.listen(port, () => {
  console.log(`Speakers Collective listening on http://localhost:${port}`);
  console.log(`Configure CAIPE with AGENTIC_APP_SPEAKERS_COLLECTIVE_ORIGIN=http://localhost:${port}`);
});

async function loadDashboardConfig() {
  if (!dataFile) {
    return normalizeSpeakersCollectiveConfig(EXAMPLE_SPEAKERS_COLLECTIVE_CONFIG, { fixture: true });
  }
  const contents = await readFile(dataFile, "utf8");
  return normalizeSpeakersCollectiveConfig(JSON.parse(contents), { fixture: false });
}

function renderDashboard(config, { compact, authorization }) {
  const payload = safeJson(config);
  const authPayload = safeJson(authorization ?? {});
  return `<!doctype html>
<html lang="en" data-caipe-theme="system">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${escapeHtml(config.title)}</title>
  <style>${DASHBOARD_CSS}</style>
</head>
<body class="${compact ? "compact" : ""}">
  <main class="wrap">
    ${config.fixture ? '<div class="fixture">STATIC EXAMPLE · SAMPLE DATA · NO LIVE CONNECTION</div>' : ""}
    <header class="hero">
      <div>
        <p class="eyebrow">${escapeHtml(config.eyebrow)}</p>
        <h1>${escapeHtml(config.title)}</h1>
        <p class="summary">${escapeHtml(config.description)}</p>
        <div class="source-line">
          <span>${escapeHtml(config.sourceLabel)}</span>
          <span>Last scan: <strong>${escapeHtml(formatSourceDate(config.lastScan))}</strong></span>
          <span class="cas">CAS ${escapeHtml(String(authorization?.launchDecision || "ALLOW"))}</span>
        </div>
      </div>
      <nav class="hero-actions" aria-label="Program links">
        ${config.communityUrl ? `<a href="${escapeHtml(config.communityUrl)}" target="_blank" rel="noopener noreferrer">Community space</a>` : ""}
        ${config.submissionUrl ? `<a href="${escapeHtml(config.submissionUrl)}" target="_blank" rel="noopener noreferrer">Record a submission</a>` : ""}
        <button id="ask-view" type="button">Ask about this view</button>
      </nav>
    </header>

    <section class="stats" id="stats" aria-label="Opportunity summary"></section>

    <section class="controls" aria-label="Filter opportunities">
      <input type="search" id="query" placeholder="Search event, team, topic, location, or notes" />
      <select id="team" aria-label="Filter by team"><option value="">All teams</option></select>
      <select id="publication" aria-label="Filter by publication status">
        <option value="">All statuses</option>
        <option value="Published">Published</option>
        <option value="Held">Held for review</option>
        <option value="Watching">Watching</option>
      </select>
      <div class="views" id="views" aria-label="Saved views">
        <button type="button" data-view="open" class="active">Open CFPs</button>
        <button type="button" data-view="soon">Closing ≤14d</button>
        <button type="button" data-view="held">Held</button>
        <button type="button" data-view="watching">Watching</button>
        <button type="button" data-view="recent-closed">Recently closed</button>
        <button type="button" data-view="all">All</button>
      </div>
    </section>

    <p class="result-summary" id="result-summary" aria-live="polite"></p>
    <section class="table-shell" aria-label="Speaking opportunities">
      <table id="events-table">
        <thead><tr>
          <th data-sort="name">Event <span>↕</span></th>
          <th data-sort="team">Teams <span>↕</span></th>
          <th data-sort="topic">Topic area <span>↕</span></th>
          <th data-sort="dates">Event dates <span>↕</span></th>
          <th data-sort="location">Location <span>↕</span></th>
          <th data-sort="deadline">CFP deadline <span>↕</span></th>
          <th data-sort="publication" class="publication-column">Status <span>↕</span></th>
          <th>Apply</th>
        </tr></thead>
        <tbody id="rows"></tbody>
      </table>
    </section>

    <section class="workflow" aria-label="Program workflow">
      <article><span>01 · Discover</span><p>Scan trusted sources for new or changed CFP and speaking windows.</p></article>
      <article><span>02 · Qualify</span><p>Route relevant opportunities to the teams and topics they support.</p></article>
      <article><span>03 · Act</span><p>Prioritize deadlines, apply through the source link, and record the submission.</p></article>
    </section>

    <footer>
      <span><i class="legend critical"></i> deadline ≤7d</span>
      <span><i class="legend soon"></i> deadline ≤21d</span>
      <span><i class="legend open"></i> longer lead or rolling</span>
      <span>Source dates remain linked to their reviewed opportunity.</span>
    </footer>
  </main>
  <script>window.__SPEAKERS_COLLECTIVE__=${payload};window.__SPEAKERS_AUTH__=${authPayload};</script>
  ${renderMicrofrontendClient(appId)}
  <script>${DASHBOARD_SCRIPT}</script>
</body>
</html>`;
}

function renderSourceError(message) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8" /><meta name="viewport" content="width=device-width,initial-scale=1" /><title>Speakers Collective unavailable</title><style>${DASHBOARD_CSS}</style></head><body><main class="wrap"><section class="source-error"><p class="eyebrow">Source unavailable</p><h1>Speakers Collective could not load</h1><p>${escapeHtml(message)}</p><p>Verify <code>SPEAKERS_COLLECTIVE_DATA_FILE</code> points to a readable, valid JSON source.</p></section></main></body></html>`;
}

function sendJson(response, status, value, head = false) {
  const body = JSON.stringify(value);
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
  });
  response.end(head ? undefined : body);
}

function sendHtml(response, body, head = false, status = 200) {
  response.writeHead(status, {
    "content-type": "text/html; charset=utf-8",
    "cache-control": "no-store",
  });
  response.end(head ? undefined : body);
}

function safeJson(value) {
  return JSON.stringify(value).replace(/</g, "\\u003c").replace(/>/g, "\\u003e");
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

function formatSourceDate(value) {
  if (!value) return "Not provided";
  const date = new Date(`${value}T00:00:00`);
  return Number.isNaN(date.getTime())
    ? "Not provided"
    : date.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

const DASHBOARD_CSS = String.raw`
  :root {
    color-scheme: light dark;
    --app-font-scale: 1;
    --bg: #f5f6fb; --card: #ffffff; --card-2: #fbfbfe;
    --ink: #14151f; --muted: #5b5f72; --faint: #8b8fa3;
    --line: #e3e4ee; --line-soft: #edeef5;
    --accent: #5b3df5; --accent-soft: #ece8ff; --accent-ink: #4629d1;
    --green: #12805f; --green-soft: #dff3ea;
    --amber: #9a5b0a; --amber-soft: #fbead0;
    --red: #b23327; --red-soft: #fbe4e1;
    --grey: #7b8095; --grey-soft: #eef0f5;
    --shadow: 0 1px 2px rgba(20,21,31,.04), 0 10px 28px -18px rgba(20,21,31,.22);
    --sans: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    --mono: ui-monospace, "SFMono-Regular", Consolas, monospace;
  }
  @media (prefers-color-scheme: dark) {
    :root:not([data-caipe-theme="light"]) {
      --bg: #07111f; --card: #0b1829; --card-2: #0e1d31;
      --ink: #edf5ff; --muted: #a8b7ca; --faint: #74869b;
      --line: #24364b; --line-soft: #182a3e;
      --accent: #34d4f4; --accent-soft: #102c42; --accent-ink: #79e4f7;
      --green: #5ce0ae; --green-soft: #112d27;
      --amber: #f3bd69; --amber-soft: #332713;
      --red: #ff9b93; --red-soft: #381e20;
      --grey: #9aa8b8; --grey-soft: #172536;
      --shadow: 0 12px 30px -20px rgba(0,0,0,.75);
    }
  }
  :root[data-caipe-theme="dark"] {
    --bg: #07111f; --card: #0b1829; --card-2: #0e1d31;
    --ink: #edf5ff; --muted: #a8b7ca; --faint: #74869b;
    --line: #24364b; --line-soft: #182a3e;
    --accent: #34d4f4; --accent-soft: #102c42; --accent-ink: #79e4f7;
    --green: #5ce0ae; --green-soft: #112d27;
    --amber: #f3bd69; --amber-soft: #332713;
    --red: #ff9b93; --red-soft: #381e20;
    --grey: #9aa8b8; --grey-soft: #172536;
    --shadow: 0 12px 30px -20px rgba(0,0,0,.75);
  }
  * { box-sizing: border-box; }
  html { -webkit-text-size-adjust: 100%; }
  body { margin: 0; background: var(--bg); color: var(--ink); font-family: var(--sans); font-size: calc(16px * var(--app-font-scale)); line-height: 1.5; }
  .wrap { width: min(1380px, calc(100% - 32px)); margin: 0 auto; padding: 24px 0 52px; }
  a { color: var(--accent-ink); }
  :focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; border-radius: 5px; }
  .fixture { display: inline-flex; margin-bottom: 12px; padding: 6px 10px; border-radius: 999px; background: var(--amber-soft); color: var(--amber); font-size: .72rem; font-weight: 850; letter-spacing: .08em; }
  .hero { display: flex; justify-content: space-between; gap: 24px; padding: 24px; border: 1px solid var(--line); border-radius: 18px; background: radial-gradient(circle at 100% 0, color-mix(in srgb, var(--accent) 12%, transparent), transparent 34rem), var(--card); box-shadow: var(--shadow); }
  .eyebrow { margin: 0 0 8px; color: var(--accent-ink); font-family: var(--mono); font-size: .72rem; font-weight: 750; letter-spacing: .12em; text-transform: uppercase; }
  h1 { margin: 0 0 8px; font-size: clamp(1.75rem, 4vw, 2.6rem); line-height: 1.1; letter-spacing: -.025em; }
  .summary { max-width: 76ch; margin: 0; color: var(--muted); }
  .source-line { display: flex; flex-wrap: wrap; gap: 8px 16px; margin-top: 16px; color: var(--muted); font-size: .78rem; }
  .cas { color: var(--green); font-weight: 750; }
  .hero-actions { display: flex; flex-wrap: wrap; justify-content: flex-end; align-content: flex-start; gap: 8px; min-width: 230px; }
  .hero-actions a, .hero-actions button { border: 1px solid var(--line); border-radius: 10px; padding: 9px 12px; background: var(--card-2); color: var(--ink); font: inherit; font-size: .8rem; font-weight: 750; text-decoration: none; cursor: pointer; }
  .hero-actions button { border-color: color-mix(in srgb, var(--accent) 55%, var(--line)); background: var(--accent); color: #07111f; }
  .stats { display: grid; grid-template-columns: repeat(5, minmax(0,1fr)); gap: 12px; margin: 16px 0; }
  .stat { min-width: 0; padding: 16px; border: 1px solid var(--line); border-radius: 14px; background: var(--card); box-shadow: var(--shadow); }
  .stat strong { display: block; font-size: 1.65rem; line-height: 1.1; font-variant-numeric: tabular-nums; }
  .stat span { display: block; margin-top: 6px; color: var(--muted); font-size: .7rem; font-weight: 750; letter-spacing: .07em; text-transform: uppercase; }
  .stat.ok strong { color: var(--green); } .stat.hot strong { color: var(--red); } .stat.warn strong { color: var(--amber); }
  .controls { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; margin-bottom: 8px; }
  .controls input, .controls select { border: 1px solid var(--line); border-radius: 10px; padding: 10px 12px; background: var(--card); color: var(--ink); font: inherit; font-size: .82rem; }
  .controls input { flex: 1; min-width: 240px; }
  .views { display: flex; flex-wrap: wrap; gap: 3px; padding: 3px; border-radius: 11px; background: var(--line-soft); }
  .views button { border: 0; border-radius: 8px; padding: 8px 11px; background: transparent; color: var(--muted); font: inherit; font-size: .77rem; font-weight: 750; cursor: pointer; }
  .views button.active { background: var(--card); color: var(--ink); box-shadow: var(--shadow); }
  .result-summary { min-height: 1.25rem; margin: 8px 2px; color: var(--muted); font-size: .76rem; }
  .table-shell { overflow: auto; border: 1px solid var(--line); border-radius: 16px; background: var(--card); box-shadow: var(--shadow); }
  table { width: 100%; min-width: 1080px; border-collapse: collapse; font-size: .78rem; }
  th, td { padding: 12px 13px; border-bottom: 1px solid var(--line-soft); text-align: left; vertical-align: top; }
  th { position: sticky; top: 0; z-index: 1; background: var(--card-2); color: var(--muted); font-size: .68rem; font-weight: 800; letter-spacing: .07em; text-transform: uppercase; white-space: nowrap; cursor: pointer; }
  th:last-child { cursor: default; }
  th span { opacity: .5; }
  tr.closed { opacity: .54; }
  tr:hover td { background: var(--card-2); }
  td.event { min-width: 250px; font-weight: 760; }
  .note { display: block; max-width: 420px; margin-top: 5px; color: var(--muted); font-size: .72rem; font-weight: 450; }
  .chip-row { display: flex; flex-wrap: wrap; gap: 4px; min-width: 130px; }
  .chip, .badge, .deadline { display: inline-flex; align-items: center; border-radius: 999px; padding: 3px 8px; font-family: var(--mono); font-size: .65rem; font-weight: 750; white-space: nowrap; }
  .chip { background: var(--accent-soft); color: var(--accent-ink); }
  .badge { margin-left: 5px; background: var(--grey-soft); color: var(--grey); }
  .badge.new { background: var(--accent-soft); color: var(--accent-ink); } .badge.priority { background: var(--amber-soft); color: var(--amber); }
  .deadline.critical { background: var(--red-soft); color: var(--red); } .deadline.soon { background: var(--amber-soft); color: var(--amber); } .deadline.open, .deadline.rolling { background: var(--green-soft); color: var(--green); } .deadline.closed { background: var(--grey-soft); color: var(--grey); }
  .date-detail { display: block; margin-top: 4px; color: var(--muted); font-size: .68rem; }
  .publication { display: flex; flex-direction: column; min-width: 130px; font-weight: 740; }
  .publication small { color: var(--muted); font-family: var(--mono); font-size: .66rem; font-weight: 500; }
  .apply { display: inline-flex; border-radius: 9px; padding: 7px 11px; background: var(--accent); color: #07111f; font-weight: 800; text-decoration: none; white-space: nowrap; }
  .unavailable { color: var(--faint); }
  #events-table.hide-publication .publication-column { display: none; }
  .workflow { display: grid; grid-template-columns: repeat(3,minmax(0,1fr)); gap: 12px; margin-top: 18px; }
  .workflow article { padding: 16px; border: 1px solid var(--line); border-radius: 14px; background: var(--card); }
  .workflow span { color: var(--accent-ink); font-family: var(--mono); font-size: .68rem; font-weight: 800; letter-spacing: .07em; text-transform: uppercase; }
  .workflow p { margin: 6px 0 0; color: var(--muted); font-size: .78rem; }
  footer { display: flex; flex-wrap: wrap; gap: 10px 18px; margin-top: 15px; color: var(--muted); font-size: .7rem; }
  .legend { display: inline-block; width: 8px; height: 8px; margin-right: 5px; border-radius: 50%; } .legend.critical { background: var(--red); } .legend.soon { background: var(--amber); } .legend.open { background: var(--green); }
  .source-error { margin: 18vh auto 0; max-width: 760px; padding: 28px; border: 1px solid var(--red); border-radius: 18px; background: var(--card); }
  body.compact .wrap { padding-top: 18px; } body.compact th, body.compact td { padding-top: 9px; padding-bottom: 9px; }
  @media (max-width: 980px) { .hero { flex-direction: column; } .hero-actions { justify-content: flex-start; min-width: 0; } .stats { grid-template-columns: repeat(3,minmax(0,1fr)); } }
  @media (max-width: 700px) { .wrap { width: min(100% - 20px, 1380px); } .stats { grid-template-columns: repeat(2,minmax(0,1fr)); } .workflow { grid-template-columns: 1fr; } }
`;

const DASHBOARD_SCRIPT = String.raw`
  (() => {
    const config = window.__SPEAKERS_COLLECTIVE__;
    const events = config.events || [];
    const state = { view: "open", sortKey: "", sortDirection: 1 };
    const dayMs = 86400000;
    const rows = document.getElementById("rows");
    const query = document.getElementById("query");
    const team = document.getElementById("team");
    const publication = document.getElementById("publication");
    const table = document.getElementById("events-table");
    const views = document.getElementById("views");

    config.teams.forEach((name) => {
      const option = document.createElement("option");
      option.value = name;
      option.textContent = name;
      team.appendChild(option);
    });

    const escapeHtml = (value) => String(value ?? "").replace(/[&<>"']/g, (character) => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;",
    })[character]);
    const formatDate = (value) => value
      ? new Date(value + "T00:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })
      : "TBD";
    const startOfToday = () => { const now = new Date(); return new Date(now.getFullYear(), now.getMonth(), now.getDate()); };
    const daysTo = (value) => value ? Math.round((new Date(value + "T00:00:00") - startOfToday()) / dayMs) : null;
    const eventState = (event) => {
      const deadlineDays = daysTo(event.deadline);
      const endDays = daysTo(event.end);
      const closed = deadlineDays !== null ? deadlineDays < 0 : endDays !== null && endDays < 0;
      const referenceDays = deadlineDays !== null ? deadlineDays : endDays;
      let urgency = "open";
      if (closed) urgency = "closed";
      else if (event.rolling && !event.deadline) urgency = "rolling";
      else if (deadlineDays !== null && deadlineDays <= 7) urgency = "critical";
      else if (deadlineDays !== null && deadlineDays <= 21) urgency = "soon";
      return { closed, deadlineDays, closedDaysAgo: closed && referenceDays !== null ? -referenceDays : null, urgency };
    };
    const urgencyRank = (event) => {
      const current = eventState(event);
      if (current.closed) return 99999;
      return current.deadlineDays === null ? 9000 : current.deadlineDays;
    };
    const badges = (event) => [
      event.isNew ? '<span class="badge new">NEW</span>' : "",
      event.routeExecutive ? '<span class="badge">EXEC</span>' : "",
      event.priority ? '<span class="badge priority">★ PRIORITY</span>' : "",
    ].join("");
    const teamCell = (event) => '<div class="chip-row">' + event.teams.map((value) => '<span class="chip">' + escapeHtml(value) + '</span>').join("") + '</div>';
    const deadlineCell = (event) => {
      const current = eventState(event);
      if (current.closed) return '<span class="deadline closed">CLOSED</span><span class="date-detail">' + escapeHtml(formatDate(event.deadline || event.end)) + '</span>';
      if (current.urgency === "rolling") return '<span class="deadline rolling">ROLLING</span>';
      const label = current.deadlineDays === null ? "OPEN" : "OPEN · " + current.deadlineDays + "d";
      return '<span class="deadline ' + current.urgency + '">' + escapeHtml(label) + '</span><span class="date-detail">' + escapeHtml(formatDate(event.deadline)) + '</span>';
    };
    const publicationCell = (event) => {
      const label = event.publication.status === "Held" ? "Held for review" : event.publication.status;
      return '<div class="publication"><span>' + escapeHtml(label) + '</span><small>' + (event.publication.since ? "since " + escapeHtml(formatDate(event.publication.since)) : "source status") + '</small></div>';
    };
    const passes = (event) => {
      const current = eventState(event);
      const text = [event.name, event.organization, event.location, event.notes, event.topic, ...event.teams].join(" ").toLowerCase();
      if (query.value && !text.includes(query.value.toLowerCase())) return false;
      if (team.value && !event.teams.includes(team.value)) return false;
      if (publication.value && event.publication.status !== publication.value) return false;
      if (state.view === "open" && (current.closed || event.publication.status !== "Published")) return false;
      if (state.view === "soon" && (current.closed || event.publication.status !== "Published" || current.deadlineDays === null || current.deadlineDays > 14)) return false;
      if (state.view === "held" && event.publication.status !== "Held") return false;
      if (state.view === "watching" && event.publication.status !== "Watching") return false;
      if (state.view === "recent-closed" && (!current.closed || current.closedDaysAgo === null || current.closedDaysAgo > 14)) return false;
      return true;
    };
    const sortValue = (event, key) => ({
      name: event.name.toLowerCase(), team: event.teams.join(",").toLowerCase(), topic: event.topic.toLowerCase(),
      dates: event.start || "9999", location: event.location.toLowerCase(), deadline: urgencyRank(event), publication: event.publication.status,
    })[key] ?? 0;
    const filteredEvents = () => {
      const list = events.filter(passes);
      if (state.sortKey) {
        list.sort((left, right) => {
          const a = sortValue(left, state.sortKey); const b = sortValue(right, state.sortKey);
          return (a < b ? -1 : a > b ? 1 : 0) * state.sortDirection;
        });
      } else if (state.view === "recent-closed") {
        list.sort((left, right) => eventState(left).closedDaysAgo - eventState(right).closedDaysAgo);
      } else list.sort((left, right) => urgencyRank(left) - urgencyRank(right));
      return list;
    };
    const publishContext = (visible, reason) => {
      const snapshot = visible.slice(0, 20).map((event) => ({
        name: event.name, organization: event.organization, teams: event.teams, topic: event.topic,
        dates: [event.start, event.end].filter(Boolean), location: event.location, deadline: event.deadline,
        status: event.publication.status, notes: event.notes, sourceUrl: event.link,
      }));
      window.parent.postMessage({
        type: "caipe.agenticApp.context.v1", version: "1.0", appId: "speakers-collective",
        context: {
          route: "/apps/speakers-collective",
          title: config.title + " · " + state.view,
          summary: visible.length + " opportunities match the current view. Source last scanned " + (config.lastScan || "at an unspecified time") + ". Context shared because: " + reason + ".",
          selection: JSON.stringify({ view: state.view, team: team.value, publication: publication.value, query: query.value, opportunities: snapshot }),
          resourceRefs: [{ kind: "dashboard", id: "speakers-collective" }],
          suggestedPrompts: [
            "Which open CFPs are closing soonest?",
            "Which opportunities best fit the selected team?",
            "Summarize priority opportunities and next actions.",
            "What gaps or unverified deadlines need follow-up?",
          ],
        },
      }, window.location.origin);
    };
    const renderStats = () => {
      const open = events.filter((event) => !eventState(event).closed && event.publication.status === "Published");
      const closing = open.filter((event) => eventState(event).deadlineDays !== null && eventState(event).deadlineDays <= 7);
      const watching = events.filter((event) => event.publication.status === "Watching");
      const newCount = events.filter((event) => event.isNew).length;
      document.getElementById("stats").innerHTML = [
        [events.length, "Tracked", ""], [open.length, "Open CFPs", "ok"], [closing.length, "Closing ≤7d", "hot"],
        [watching.length, "Watching", "warn"], [newCount, "New this scan", ""],
      ].map(([value, label, tone]) => '<article class="stat ' + tone + '"><strong>' + value + '</strong><span>' + label + '</span></article>').join("");
    };
    const render = () => {
      const visible = filteredEvents();
      table.classList.toggle("hide-publication", state.view === "open" || state.view === "soon");
      rows.innerHTML = visible.map((event) => {
        const current = eventState(event);
        const dates = event.start ? formatDate(event.start) + (event.end && event.end !== event.start ? " – " + formatDate(event.end) : "") : "TBD";
        const apply = !current.closed && event.link
          ? '<a class="apply" href="' + escapeHtml(event.link) + '" target="_blank" rel="noopener noreferrer">Apply ↗</a>'
          : '<span class="unavailable">' + (current.closed ? "Closed" : "—") + '</span>';
        return '<tr class="' + (current.closed ? "closed" : "") + '">' +
          '<td class="event">' + escapeHtml(event.name) + badges(event) + '<span class="note">' + escapeHtml((event.organization ? event.organization + " · " : "") + event.notes) + '</span></td>' +
          '<td>' + teamCell(event) + '</td><td>' + escapeHtml(event.topic) + '</td><td>' + escapeHtml(dates) + '</td><td>' + escapeHtml(event.location || "TBD") + '</td>' +
          '<td>' + deadlineCell(event) + '</td><td class="publication-column">' + publicationCell(event) + '</td><td>' + apply + '</td></tr>';
      }).join("") || '<tr><td colspan="8" class="unavailable" style="padding:28px">No opportunities match the current filters.</td></tr>';
      document.getElementById("result-summary").textContent = visible.length + " of " + events.length + " opportunities shown";
      publishContext(visible, "the dashboard view changed");
    };

    [query, team, publication].forEach((control) => control.addEventListener(control === query ? "input" : "change", render));
    views.querySelectorAll("button").forEach((button) => button.addEventListener("click", () => {
      views.querySelectorAll("button").forEach((candidate) => candidate.classList.remove("active"));
      button.classList.add("active"); state.view = button.dataset.view; render();
    }));
    document.querySelectorAll("th[data-sort]").forEach((heading) => heading.addEventListener("click", () => {
      const key = heading.dataset.sort;
      if (state.sortKey === key) state.sortDirection *= -1; else { state.sortKey = key; state.sortDirection = 1; }
      render();
    }));
    document.getElementById("ask-view").addEventListener("click", () => {
      publishContext(filteredEvents(), "the user opened Speakers Collective Assistant");
      window.parent.postMessage({ type: "caipe.agenticApp.assistant.open.v1", appId: "speakers-collective" }, window.location.origin);
    });
    window.addEventListener("caipe:microfrontend-initialize", (event) => {
      const requested = event.detail?.preferences?.defaultView;
      const button = views.querySelector('[data-view="' + requested + '"]');
      if (!button) return;
      views.querySelectorAll("button").forEach((candidate) => candidate.classList.remove("active"));
      button.classList.add("active"); state.view = requested; render();
    });
    renderStats(); render();
  })();
`;
