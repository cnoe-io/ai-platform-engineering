import { render, screen, waitFor } from "@testing-library/react";
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

  it("rotates credential references for AgentGateway-managed servers without sending route metadata", async () => {
    const user = userEvent.setup();
    render(
      <MCPServerEditor
        server={{
          _id: "rag",
          name: "RAG",
          transport: "http",
          endpoint: "http://agentgateway:4000/mcp",
          enabled: true,
          config_driven: true,
          source: "agentgateway",
          agentgateway_target_endpoint: "http://rag-server:9446/mcp",
          credential_sources: [
            {
              kind: "secret_ref",
              target: "header",
              name: "Authorization",
              secret_ref: "old-secret",
            },
          ],
          created_at: "2026-06-18T00:00:00.000Z",
          updated_at: "2026-06-18T00:00:00.000Z",
        }}
        managedByAgentGateway
        onSave={jest.fn()}
        onCancel={jest.fn()}
      />,
    );

    expect(screen.getByLabelText(/display name/i)).toBeDisabled();
    expect(screen.getByLabelText(/endpoint url/i)).toBeDisabled();

    const credentialReference = screen.getByLabelText(/credential reference/i);
    expect(credentialReference).not.toBeDisabled();
    await user.clear(credentialReference);
    await user.type(credentialReference, "rotated-secret");
    await user.click(screen.getByRole("button", { name: /save credential sources/i }));

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith(
        "/api/mcp-servers?id=rag",
        expect.objectContaining({ method: "PUT" }),
      );
    });

    const updateCall = (global.fetch as jest.Mock).mock.calls.find(
      ([url, init]: [string, RequestInit | undefined]) =>
        url === "/api/mcp-servers?id=rag" && init?.method === "PUT",
    );
    const body = JSON.parse(String(updateCall?.[1]?.body));

    expect(body).toEqual({
      credential_sources: [
        {
          kind: "secret_ref",
          target: "header",
          name: "Authorization",
          secret_ref: "rotated-secret",
        },
      ],
    });
    expect(body).not.toHaveProperty("endpoint");
    expect(body).not.toHaveProperty("agentgateway_target_endpoint");
  });

  it("adds a missing credential reference for AgentGateway-managed servers", async () => {
    const user = userEvent.setup();
    render(
      <MCPServerEditor
        server={{
          _id: "rag",
          name: "RAG",
          transport: "http",
          endpoint: "http://agentgateway:4000/mcp",
          enabled: true,
          config_driven: true,
          source: "agentgateway",
          created_at: "2026-06-18T00:00:00.000Z",
          updated_at: "2026-06-18T00:00:00.000Z",
        }}
        managedByAgentGateway
        onSave={jest.fn()}
        onCancel={jest.fn()}
      />,
    );

    await user.click(screen.getByRole("button", { name: /add credential/i }));
    await user.type(screen.getByLabelText(/credential name/i), "Authorization");
    await user.type(screen.getByLabelText(/credential reference/i), "secret-1");
    await user.click(screen.getByRole("button", { name: /save credential sources/i }));

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith(
        "/api/mcp-servers?id=rag",
        expect.objectContaining({ method: "PUT" }),
      );
    });

    const updateCall = (global.fetch as jest.Mock).mock.calls.find(
      ([url, init]: [string, RequestInit | undefined]) =>
        url === "/api/mcp-servers?id=rag" && init?.method === "PUT",
    );
    const body = JSON.parse(String(updateCall?.[1]?.body));

    expect(body.credential_sources).toEqual([
      {
        kind: "secret_ref",
        target: "header",
        name: "Authorization",
        secret_ref: "secret-1",
      },
    ]);
  });
});
