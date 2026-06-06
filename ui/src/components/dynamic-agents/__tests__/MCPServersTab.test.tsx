import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MCPServersTab } from "../MCPServersTab";

const jiraServer = {
  _id: "jira",
  name: "Jira",
  transport: "http",
  endpoint: "http://mcp-jira:8000/mcp",
  enabled: true,
  created_at: "2026-05-17T00:00:00.000Z",
  updated_at: "2026-05-17T00:00:00.000Z",
};

const agentGatewayRagServer = {
  _id: "rag",
  name: "RAG",
  transport: "http",
  endpoint: "http://agentgateway:4000/mcp",
  enabled: true,
  config_driven: true,
  source: "agentgateway",
  agentgateway_discovered: true,
  agentgateway_target_endpoint: "http://rag-server:9446/mcp",
  created_at: "2026-05-17T00:00:00.000Z",
  updated_at: "2026-05-17T00:00:00.000Z",
};

describe("MCPServersTab AgentGateway sync", () => {
  let serverItems: Record<string, unknown>[];

  beforeEach(() => {
    jest.clearAllMocks();
    serverItems = [jiraServer];
    global.fetch = jest.fn((url: string, init?: RequestInit) => {
      if (url === "/api/mcp-servers?page_size=100") {
        return Promise.resolve({
          json: async () => ({
            success: true,
            data: {
              items: serverItems,
            },
          }),
        } as Response);
      }
      if (url === "/api/mcp-servers/agentgateway/sync" && init?.method === "POST") {
        return Promise.resolve({
          json: async () => ({
            success: true,
            data: {
              added: ["rag"],
              skipped: [{ id: "jira", reason: "conflict" }],
              summary: { added: 1, existing: 0, conflicts: 1, skipped: 1 },
              migration_warnings: [
                {
                  id: "jira",
                  endpoint: "http://agentgateway:4000/mcp",
                  target_endpoint: "http://mcp-jira:8000/mcp",
                  existing_endpoint: "http://legacy-jira:8000/mcp",
                  message:
                    "Legacy MCP server conflicts with AgentGateway target \"jira\". Remove or rename the legacy MCP server to let AgentGateway manage it.",
                },
              ],
            },
          }),
        } as Response);
      }
      throw new Error(`Unexpected fetch: ${url}`);
    }) as unknown as typeof fetch;
  });

  it("syncs AgentGateway MCP servers in one click and shows migration conflicts", async () => {
    render(<MCPServersTab />);

    await screen.findByText("Jira");
    fireEvent.click(screen.getByRole("button", { name: /Sync with AgentGateway/i }));

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith(
        "/api/mcp-servers/agentgateway/sync",
        expect.objectContaining({
          method: "POST",
          body: JSON.stringify({}),
        }),
      );
    });

    // Message format changed to break down counts:
    //   "Added 1, migrated 0, and refreshed 0 MCP server from AgentGateway."
    expect(
      await screen.findByText(/Added 1, migrated 0, and refreshed 0 MCP server/i),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/1 legacy MCP server conflicts with AgentGateway targets/i),
    ).toBeInTheDocument();
    expect(screen.getByText(/Remove or rename the legacy MCP server/i)).toBeInTheDocument();
    expect(screen.getAllByText("jira").length).toBeGreaterThan(0);
    expect(screen.getByText(/Current: http:\/\/legacy-jira:8000\/mcp/i)).toBeInTheDocument();
    expect(screen.getByText(/AgentGateway: http:\/\/mcp-jira:8000\/mcp/i)).toBeInTheDocument();
  });

  it("marks AgentGateway-registered MCP servers in the table", async () => {
    serverItems = [jiraServer, agentGatewayRagServer];
    render(<MCPServersTab />);

    await screen.findByText("RAG");

    expect(screen.getByText("AgentGateway")).toBeInTheDocument();
    expect(screen.getByText(/Target: http:\/\/rag-server:9446\/mcp/i)).toBeInTheDocument();
  });
});
