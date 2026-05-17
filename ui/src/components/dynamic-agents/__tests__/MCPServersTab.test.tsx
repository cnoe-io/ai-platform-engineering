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
      if (url === "/api/mcp-servers/agentgateway/discover") {
        return Promise.resolve({
          json: async () => ({
            success: true,
            data: {
              targets: [
                {
                  id: "rag",
                  name: "RAG",
                  transport: "http",
                  endpoint: "http://agentgateway:4000/mcp",
                  target_endpoint: "http://rag-server:9446/mcp",
                  enabled: true,
                  status: "new",
                },
                {
                  id: "jira",
                  name: "Jira",
                  transport: "http",
                  endpoint: "http://agentgateway:4000/mcp",
                  target_endpoint: "http://mcp-jira:8000/mcp",
                  enabled: true,
                  status: "conflict",
                  existing_endpoint: "http://mcp-jira:8000/mcp",
                },
              ],
            },
          }),
        } as Response);
      }
      if (url === "/api/mcp-servers/agentgateway/sync" && init?.method === "POST") {
        return Promise.resolve({
          json: async () => ({
            success: true,
            data: { added: ["rag"], skipped: [{ id: "jira", reason: "existing" }] },
          }),
        } as Response);
      }
      throw new Error(`Unexpected fetch: ${url}`);
    }) as unknown as typeof fetch;
  });

  it("lets users confirm which AgentGateway-discovered MCP servers to add", async () => {
    render(<MCPServersTab />);

    await screen.findByText("Jira");
    fireEvent.click(screen.getByRole("button", { name: /Sync with AgentGateway/i }));

    expect(await screen.findByText("AgentGateway MCP targets")).toBeInTheDocument();
    expect(screen.getByText("RAG")).toBeInTheDocument();
    expect(screen.getByText("New")).toBeInTheDocument();
    expect(screen.getByText("Conflict")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /Add selected servers/i }));

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith(
        "/api/mcp-servers/agentgateway/sync",
        expect.objectContaining({
          method: "POST",
          body: JSON.stringify({ ids: ["rag"] }),
        }),
      );
    });
    expect(await screen.findByText(/Added 1 MCP server/i)).toBeInTheDocument();
  });

  it("marks AgentGateway-registered MCP servers in the table", async () => {
    serverItems = [jiraServer, agentGatewayRagServer];
    render(<MCPServersTab />);

    await screen.findByText("RAG");

    expect(screen.getByText("AgentGateway")).toBeInTheDocument();
    expect(screen.getByText(/Target: http:\/\/rag-server:9446\/mcp/i)).toBeInTheDocument();
  });
});
