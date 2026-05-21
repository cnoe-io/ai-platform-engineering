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
    expect((global.fetch as jest.Mock).mock.calls[0][1].body).toContain("conn-1");
  });
});
