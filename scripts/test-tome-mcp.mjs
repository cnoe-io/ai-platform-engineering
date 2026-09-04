#!/usr/bin/env node

import fs from "node:fs";

/**
 * Minimal local smoke client for the deployed TOME MCP transports.
 *
 * Usage:
 *   node scripts/test-tome-mcp.mjs --mode both
 *   TOME_MCP_TEST_TOKEN=... node scripts/test-tome-mcp.mjs --mode both
 *   node scripts/test-tome-mcp.mjs --token-file /path/to/token --mode sse
 *
 * The client intentionally reports only protocol/status metadata. It never
 * prints bearer tokens or response bodies.
 */

const DEFAULT_URL = "https://tome-sri.dev.outshift.io/api/tome/mcp";
const PROTOCOL_VERSION = "2024-11-05";

function option(name, fallback) {
  const index = process.argv.indexOf(name);
  return index === -1 ? fallback : process.argv[index + 1] || fallback;
}

function readToken() {
  const tokenFile = option("--token-file", "");
  if (tokenFile) {
    const value = fs.readFileSync(tokenFile, "utf8").trim();
    if (!value.includes("\n") && !value.includes(":")) {
      return value.replace(/^ACCESS_TOKEN=/, "").trim();
    }

    for (const line of value.split(/\r?\n/)) {
      const match = line.match(/^\s*access_token\s*:\s*(.*?)\s*$/i);
      if (!match) continue;
      return match[1].replace(/^['\"]|['\"]$/g, "").replace(/^Bearer\s+/i, "").trim();
    }
    throw new Error(`no access_token field found in ${tokenFile}`);
  }
  return process.env.TOME_MCP_TEST_TOKEN?.trim() || "";
}

function authHeaders(token) {
  return token ? { Authorization: `Bearer ${token}` } : {};
}

async function request(url, init = {}) {
  const response = await fetch(url, {
    ...init,
    headers: {
      Accept: "application/json, text/event-stream",
      "MCP-Protocol-Version": PROTOCOL_VERSION,
      ...init.headers,
    },
  });
  const text = await response.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    // The caller only uses JSON when the status/content type indicates it.
  }
  return { response, json };
}

function rpcBody(id, method, params = undefined) {
  return JSON.stringify({
    jsonrpc: "2.0",
    id,
    method,
    ...(params === undefined ? {} : { params }),
  });
}

function printAuthStatus(label, status, token) {
  const expected = token ? "authenticated" : "authentication_required";
  console.log(`${label}: status=${status} mode=${expected}`);
}

async function streamable(url, token) {
  const headers = {
    "Content-Type": "application/json",
    ...authHeaders(token),
  };
  const initialize = await request(url, {
    method: "POST",
    headers,
    body: rpcBody(1, "initialize", {
      protocolVersion: PROTOCOL_VERSION,
      capabilities: {},
      clientInfo: { name: "tome-local-smoke-client", version: "0.1.0" },
    }),
  });
  printAuthStatus("streamable.initialize", initialize.response.status, token);
  if (initialize.response.status === 401) return false;
  if (!initialize.response.ok || !initialize.json?.result) {
    throw new Error(`streamable initialize returned unexpected status ${initialize.response.status}`);
  }

  const listed = await request(url, {
    method: "POST",
    headers,
    body: rpcBody(2, "tools/list"),
  });
  printAuthStatus("streamable.tools/list", listed.response.status, token);
  if (!listed.response.ok || !listed.json?.result) {
    throw new Error(`streamable tools/list returned unexpected status ${listed.response.status}`);
  }
  const tools = Array.isArray(listed.json.result.tools) ? listed.json.result.tools : [];
  console.log(`streamable.tools: count=${tools.length} names=${tools.map((tool) => tool.name).join(",")}`);
  return true;
}

function parseSseFrame(frame) {
  let event = "message";
  const data = [];
  for (const line of frame.split("\n")) {
    if (line.startsWith("event:")) event = line.slice(6).trim();
    if (line.startsWith("data:")) data.push(line.slice(5).trim());
  }
  return { event, data: data.join("\n") };
}

async function nextSseFrame(reader, state, timeoutMs = 10000) {
  const read = (async () => {
    for (;;) {
      const boundary = state.buffer.indexOf("\n\n");
      if (boundary !== -1) {
        const frame = state.buffer.slice(0, boundary);
        state.buffer = state.buffer.slice(boundary + 2);
        return parseSseFrame(frame);
      }
      const { done, value } = await reader.read();
      if (done) throw new Error("SSE stream closed before the expected event");
      state.buffer += new TextDecoder().decode(value, { stream: true });
    }
  })();
  let timer;
  try {
    return await Promise.race([
      read,
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error("SSE event timed out")), timeoutMs);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

async function sse(url, token) {
  const controller = new AbortController();
  const response = await fetch(`${url}/sse`, {
    headers: { Accept: "text/event-stream", ...authHeaders(token) },
    signal: controller.signal,
  });
  printAuthStatus("sse.connect", response.status, token);
  if (response.status === 401) return false;
  if (!response.ok || !response.body) {
    throw new Error(`SSE connect returned unexpected status ${response.status}`);
  }

  const reader = response.body.getReader();
  const state = { buffer: "" };
  try {
    const endpointEvent = await nextSseFrame(reader, state);
    if (endpointEvent.event !== "endpoint" || !endpointEvent.data) {
      throw new Error("SSE stream did not provide an endpoint event");
    }
    const messagesUrl = new URL(endpointEvent.data, url).toString();
    console.log("sse.endpoint: received=true");

    const posted = await request(messagesUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...authHeaders(token) },
      body: rpcBody(3, "initialize", {
        protocolVersion: PROTOCOL_VERSION,
        capabilities: {},
        clientInfo: { name: "tome-local-smoke-client", version: "0.1.0" },
      }),
    });
    printAuthStatus("sse.messages.initialize", posted.response.status, token);
    if (posted.response.status === 401) return false;
    if (posted.response.status !== 202) {
      throw new Error(`SSE messages returned unexpected status ${posted.response.status}`);
    }

    const event = await nextSseFrame(reader, state);
    let message = null;
    try {
      message = JSON.parse(event.data);
    } catch {
      // Keep diagnostics status-only; malformed data is reported below.
    }
    if (event.event !== "message" || !message?.result) {
      throw new Error("SSE stream did not provide an initialize result");
    }
    console.log(`sse.initialize: server=${message.result.serverInfo?.name || "unknown"}`);
    return true;
  } finally {
    await reader.cancel().catch(() => {});
    controller.abort();
  }
}

async function main() {
  const mode = option("--mode", "both");
  const url = option("--url", process.env.TOME_MCP_URL || DEFAULT_URL).replace(/\/$/, "");
  const token = readToken();
  if (!['streamable', 'sse', 'both'].includes(mode)) {
    throw new Error("--mode must be streamable, sse, or both");
  }

  if (mode === "streamable" || mode === "both") await streamable(url, token);
  if (mode === "sse" || mode === "both") await sse(url, token);
  console.log("result: completed");
}

main().catch((error) => {
  console.error(`result: failed (${error instanceof Error ? error.message : "unknown error"})`);
  process.exitCode = 1;
});
