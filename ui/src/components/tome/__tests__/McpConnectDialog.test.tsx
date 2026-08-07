/**
 * @jest-environment jsdom
 *
 * McpConnectDialog — OAuth client setup:
 *  1. Client configuration is available without generating an API key.
 *  2. Native Streamable HTTP and the enterprise Desktop bridge are available.
 *  3. Every client has a connection check and a shared read-only test prompt.
 */

import React from "react";
import { fireEvent, render, screen } from "@testing-library/react";

import { McpConnectDialog } from "../McpConnectDialog";

afterEach(() => {
  jest.restoreAllMocks();
});

describe("McpConnectDialog", () => {
  it("shows OAuth client configuration without generating an API key", () => {
    render(<McpConnectDialog initialOpen />);

    expect(screen.getByText("Client configuration")).toBeInTheDocument();
    expect(
      screen.getByText(/native clients connect over streamable http/i),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /generate|regenerate/i }),
    ).not.toBeInTheDocument();
    expect(screen.getByText(/codex mcp add tome --url/)).toBeInTheDocument();
    expect(screen.queryByText(/--oauth-client-id/)).not.toBeInTheDocument();
  });

  it("provides native client setup and enterprise Claude Desktop config", () => {
    render(<McpConnectDialog initialOpen />);

    fireEvent.mouseDown(screen.getByRole("tab", { name: "Claude Code" }), {
      button: 0,
      ctrlKey: false,
    });
    expect(screen.getByText(/claude mcp add --scope user/)).toBeInTheDocument();
    expect(screen.queryByText(/claude mcp login/)).not.toBeInTheDocument();
    expect(screen.getByText(/^claude mcp list$/)).toBeInTheDocument();

    fireEvent.mouseDown(screen.getByRole("tab", { name: "Claude Desktop" }), {
      button: 0,
      ctrlKey: false,
    });
    expect(
      screen.getByText(/settings → developer → edit config/i),
    ).toBeInTheDocument();
    expect(screen.getByText(/claude_desktop_config\.json/)).toBeInTheDocument();
    expect(screen.getAllByText(/mcp-remote/)).not.toHaveLength(0);
    expect(screen.getByText(/"--transport"/)).toBeInTheDocument();
    expect(screen.getByText(/"http-only"/)).toBeInTheDocument();

    fireEvent.mouseDown(screen.getByRole("tab", { name: "Cursor" }), {
      button: 0,
      ctrlKey: false,
    });
    expect(screen.getByText(/^\.cursor\/mcp\.json$/)).toBeInTheDocument();
    expect(
      screen.getByText(/"url": "http:\/\/localhost\/api\/tome\/mcp"/),
    ).toBeInTheDocument();
    expect(screen.getByText(/cursor agent mcp login tome/)).toBeInTheDocument();
    expect(
      screen.getByText(/cursor agent mcp list-tools tome/),
    ).toBeInTheDocument();
    expect(screen.queryByText(/"CLIENT_ID"/)).not.toBeInTheDocument();

    fireEvent.mouseDown(screen.getByRole("tab", { name: "OpenCode" }), {
      button: 0,
      ctrlKey: false,
    });
    expect(screen.getByText(/opencode mcp add tome --url/)).toBeInTheDocument();
    expect(screen.getByText(/opencode mcp auth tome/)).toBeInTheDocument();
    expect(screen.getByText(/opencode mcp debug tome/)).toBeInTheDocument();
  });

  it("shows a shared read-only verification prompt and failure signals", () => {
    render(<McpConnectDialog initialOpen />);

    expect(screen.getByText("Confirm Tome is working")).toBeInTheDocument();
    expect(screen.getByText(/call tome_list_projects once/i)).toBeInTheDocument();
    expect(screen.getByText("Working")).toBeInTheDocument();
    expect(screen.getByText("Not working")).toBeInTheDocument();
    expect(screen.getByText("401").closest("li")).toHaveTextContent(
      /authentication was not completed/i,
    );
    expect(screen.getByText("403").closest("li")).toHaveTextContent(
      /firewall or WAF blocked DCR/i,
    );
  });
});
