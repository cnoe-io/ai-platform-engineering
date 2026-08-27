import assert from "node:assert/strict";
import { createServer } from "node:http";
import test from "node:test";

import { z } from "zod";

import { handleAppMcpRequest, mcpJson } from "./app-mcp-server.mjs";

test("serves a stateless MCP tool contract and requires a bearer credential", async (t) => {
  const server = createServer((request, response) =>
    handleAppMcpRequest(request, response, {
      name: "example-app",
      registerTools(mcp) {
        mcp.registerTool(
          "example_read",
          {
            description: "Read an example value",
            inputSchema: z.object({ value: z.string() }),
            annotations: { readOnlyHint: true },
          },
          async ({ value }) => mcpJson({ value }),
        );
      },
    }),
  );
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => server.close());
  const address = server.address();
  assert(address && typeof address === "object");
  const endpoint = `http://127.0.0.1:${address.port}`;

  const unauthorized = await fetch(endpoint, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list", params: {} }),
  });
  assert.equal(unauthorized.status, 401);

  const listed = await fetch(endpoint, {
    method: "POST",
    headers: {
      accept: "application/json, text/event-stream",
      authorization: "Bearer test-token",
      "content-type": "application/json",
    },
    body: JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} }),
  });
  assert.equal(listed.status, 200);
  const payload = await listed.json();
  assert.equal(payload.result.tools[0].name, "example_read");
});
