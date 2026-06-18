import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { MCPServerEditor } from "../MCPServerEditor";

describe("MCPServerEditor credential sources", () => {
  beforeEach(() => {
    global.fetch = jest.fn(async () => ({
      json: async () => ({ success: true }),
    })) as jest.Mock;
  });

  it("persists credential source metadata when creating an MCP server", async () => {
    const user = userEvent.setup();
    render(<MCPServerEditor server={null} onSave={jest.fn()} onCancel={jest.fn()} />);

    await user.type(screen.getByLabelText(/server id/i), "github");
    await user.type(screen.getByLabelText(/display name/i), "GitHub MCP");
    await user.type(screen.getByLabelText(/endpoint url/i), "https://mcp.example.com/sse");
    await user.click(screen.getByRole("button", { name: /add credential/i }));
    await user.type(screen.getByLabelText(/credential name/i), "Authorization");
    await user.type(screen.getByLabelText(/credential reference/i), "conn-1");
    await user.selectOptions(screen.getByLabelText(/credential kind/i), "provider_connection");
    await user.click(screen.getByRole("button", { name: /create server/i }));

    expect(global.fetch).toHaveBeenCalledWith(
      "/api/mcp-servers",
      expect.objectContaining({
        method: "POST",
        body: expect.stringContaining("credential_sources"),
      }),
    );
    // The editor also fires a best-effort AgentGateway discovery
    // fetch on mount (see MCPServerEditor for the "Pick AgentGateway
    // target" picker). Find the actual create-server POST by URL
    // instead of relying on the call index — otherwise a future
    // ordering change would silently re-break this assertion.
    const calls = (global.fetch as jest.Mock).mock.calls;
    const createCall = calls.find(
      ([url, init]: [string, RequestInit | undefined]) =>
        url === "/api/mcp-servers" && init?.method === "POST",
    );
    expect(createCall).toBeDefined();
    expect(createCall?.[1]?.body).toContain("conn-1");
  });

  it("sends AgentGateway routing metadata for custom HTTP MCP servers", async () => {
    const user = userEvent.setup();
    render(<MCPServerEditor server={null} onSave={jest.fn()} onCancel={jest.fn()} />);

    await user.type(screen.getByLabelText(/server id/i), "custom");
    await user.type(screen.getByLabelText(/display name/i), "Custom MCP");
    await user.click(screen.getByRole("button", { name: /HTTP/i }));
    await user.type(screen.getByLabelText(/endpoint url/i), "https://mcp.example.com/mcp");
    await user.click(screen.getByLabelText(/route through agentgateway/i));
    await user.click(screen.getByRole("button", { name: /create server/i }));

    const calls = (global.fetch as jest.Mock).mock.calls;
    const createCall = calls.find(
      ([url, init]: [string, RequestInit | undefined]) =>
        url === "/api/mcp-servers" && init?.method === "POST",
    );
    expect(createCall).toBeDefined();
    const body = JSON.parse(String(createCall?.[1]?.body));
    expect(body).toEqual(
      expect.objectContaining({
        id: "custom",
        transport: "http",
        endpoint: "https://mcp.example.com/mcp",
        route_through_agentgateway: true,
        agentgateway_target_endpoint: "https://mcp.example.com/mcp",
      }),
    );
  });
});
