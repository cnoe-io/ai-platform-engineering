import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";

const DEFAULT_MAX_BODY_BYTES = 1024 * 1024;

export function mcpJson(value) {
  return {
    content: [{ type: "text", text: JSON.stringify(value) }],
    structuredContent: value && typeof value === "object" ? value : { value },
  };
}

export function hasBearerCredential(headers) {
  const value = String(headers?.authorization ?? "").trim();
  return /^Bearer\s+\S+$/i.test(value);
}

export async function handleAppMcpRequest(
  request,
  response,
  {
    name,
    version = "1.0.0",
    registerTools,
    authenticationDisabled = false,
    maxBodyBytes = DEFAULT_MAX_BODY_BYTES,
  },
) {
  if (request.method !== "POST") {
    sendJson(response, 405, { error: "method_not_allowed", allow: ["POST"] });
    return;
  }
  if (!authenticationDisabled && !hasBearerCredential(request.headers)) {
    sendJson(response, 401, { error: "missing_bearer_credential" });
    return;
  }

  let body;
  try {
    body = await readJsonBody(request, maxBodyBytes);
  } catch (error) {
    const tooLarge = error instanceof Error && error.message === "request_too_large";
    sendJson(response, tooLarge ? 413 : 400, {
      error: tooLarge ? "request_too_large" : "invalid_json",
    });
    return;
  }

  const server = new McpServer({ name, version });
  registerTools(server);
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
  });

  try {
    await server.connect(transport);
    await transport.handleRequest(request, response, body);
  } catch (error) {
    if (!response.headersSent) {
      sendJson(response, 500, {
        error: "mcp_request_failed",
        message: error instanceof Error ? error.message : "MCP request failed",
      });
    } else if (!response.writableEnded) {
      response.end();
    }
  }
}

async function readJsonBody(request, maxBodyBytes) {
  const chunks = [];
  let totalBytes = 0;
  for await (const chunk of request) {
    totalBytes += chunk.length;
    if (totalBytes > maxBodyBytes) throw new Error("request_too_large");
    chunks.push(chunk);
  }
  const raw = Buffer.concat(chunks).toString("utf8");
  if (!raw.trim()) throw new Error("invalid_json");
  return JSON.parse(raw);
}

function sendJson(response, status, body) {
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
  });
  response.end(JSON.stringify(body));
}
