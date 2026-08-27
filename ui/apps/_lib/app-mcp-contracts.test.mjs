import assert from "node:assert/strict";
import { createServer } from "node:http";
import test from "node:test";

import { registerAgenticSdlcMcpTools } from "../agentic-sdlc/mcp.mjs";
import { registerFinOpsMcpTools } from "../agentic-apps/finops/mcp.mjs";
import { registerLiteLlmMcpTools } from "../agentic-apps/litellm/mcp.mjs";
import { sanitizeLiteLlmModelInfo } from "../agentic-apps/litellm/model-info.mjs";
import { registerOssReportCardMcpTools } from "../agentic-apps/oss-repo-management/mcp.mjs";
import { registerWeatherMcpTools } from "../agentic-apps/weather/mcp.mjs";
import { handleAppMcpRequest } from "./app-mcp-server.mjs";

const contracts = [
  {
    name: "weather-app",
    tools: ["weather_get_dashboard"],
    register(server) {
      registerWeatherMcpTools(server, {
        fetchDashboard: async (city) => ({ city, dailyGuidance: { howIsMyDay: "Clear" } }),
        buildResponse: (forecast, intent) => ({ forecast, intent }),
      });
    },
  },
  {
    name: "oss-repo-report-card-app",
    tools: ["oss_get_report_card", "oss_get_markdown_report"],
    register(server) {
      registerOssReportCardMcpTools(server, {
        loadReportCard: async ({ repo }) => ({ repo, generatedAt: "2026-01-01T00:00:00Z" }),
        renderMarkdown: (dashboard) => `# ${dashboard.repo}`,
      });
    },
  },
  {
    name: "finops-app",
    tools: ["finops_get_capabilities", "finops_get_litellm_dashboard"],
    register(server) {
      registerFinOpsMcpTools(server, {
        getCapabilities: () => ({ sources: [] }),
        getLiteLlmDashboard: async () => ({ spend: 0 }),
      });
    },
  },
  {
    name: "litellm-app",
    tools: ["litellm_get_daily_activity", "litellm_get_model_info"],
    register(server) {
      registerLiteLlmMcpTools(server, {
        getDailyActivity: async () => ({ results: [] }),
        getModelInfo: async () => ({ data: [] }),
      });
    },
  },
  {
    name: "agentic-sdlc-app",
    tools: ["sdlc_get_repository_snapshot", "sdlc_get_runtime_contract"],
    register(server) {
      registerAgenticSdlcMcpTools(server, {
        getRepositorySnapshot: async (repo) => ({ repository: repo }),
        getRuntimeContract: () => ({ capabilities: [] }),
      });
    },
  },
];

for (const contract of contracts) {
  test(`${contract.name} exposes its bounded MCP tool list`, async (context) => {
    const httpServer = createServer((request, response) =>
      handleAppMcpRequest(request, response, {
        name: contract.name,
        registerTools: contract.register,
      }),
    );
    await new Promise((resolve) => httpServer.listen(0, "127.0.0.1", resolve));
    context.after(() => new Promise((resolve) => httpServer.close(resolve)));
    const address = httpServer.address();
    assert.ok(address && typeof address === "object");

    const response = await fetch(`http://127.0.0.1:${address.port}/mcp`, {
      method: "POST",
      headers: {
        accept: "application/json, text/event-stream",
        authorization: "Bearer test-credential",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "tools/list",
        params: {},
      }),
    });
    assert.equal(response.status, 200);
    const payload = await response.json();
    assert.deepEqual(
      payload.result.tools.map((tool) => tool.name).sort(),
      [...contract.tools].sort(),
    );
  });
}

test("LiteLLM model inventory removes upstream credentials and bulky configuration", () => {
  const result = sanitizeLiteLlmModelInfo({
    data: [
      {
        model_name: "example-model",
        litellm_params: {
          model: "provider/example-model",
          custom_llm_provider: "provider",
          api_key: "must-not-leak",
        },
        model_info: {
          id: "model-1",
          mode: "chat",
          supports_function_calling: true,
          supports_vision: false,
          private_metadata: { token: "must-not-leak-either" },
        },
      },
    ],
  });

  assert.deepEqual(result, {
    source: "litellm-model-info",
    totalModels: 1,
    returnedModels: 1,
    truncated: false,
    models: [
      {
        name: "example-model",
        id: "model-1",
        provider: "provider",
        upstreamModel: "provider/example-model",
        mode: "chat",
        supportsFunctionCalling: true,
        supportsVision: false,
      },
    ],
  });
  assert.equal(JSON.stringify(result).includes("must-not-leak"), false);
});
