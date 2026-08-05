/**
 * @jest-environment jsdom
 *
 * McpConnectDialog — OAuth client setup:
 *  1. Client configuration is available without generating an API key.
 *  2. OAuth setup is provided for each supported MCP client.
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
    expect(screen.getByText(/all four sign in via oauth/i)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /generate|regenerate/i })).not.toBeInTheDocument();
    expect(screen.getByText(/codex mcp add tome --url/)).toBeInTheDocument();
    expect(screen.queryByText(/--oauth-client-id/)).not.toBeInTheDocument();
    expect(screen.getByText(/proxy or client ID is required/i)).toBeInTheDocument();
  });

  it("provides OAuth setup for Claude Desktop and Cursor", () => {
    render(<McpConnectDialog initialOpen />);

    fireEvent.mouseDown(screen.getByRole("tab", { name: "Claude Code" }), {
      button: 0,
      ctrlKey: false,
    });
    expect(screen.getByText(/claude mcp add --scope user/)).toBeInTheDocument();

    fireEvent.mouseDown(screen.getByRole("tab", { name: "Claude Desktop" }), {
      button: 0,
      ctrlKey: false,
    });
    expect(screen.getByText(/claude_desktop_config\.json/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /download mcp bundle/i })).toHaveAttribute(
      "href",
      "/api/tome/mcp/bundle",
    );

    fireEvent.mouseDown(screen.getByRole("tab", { name: "Cursor" }), {
      button: 0,
      ctrlKey: false,
    });
    expect(screen.getByText(/^\.cursor\/mcp\.json$/)).toBeInTheDocument();
    expect(screen.getByText(/"url": "http:\/\/localhost\/api\/tome\/mcp"/)).toBeInTheDocument();
    expect(screen.queryByText(/"CLIENT_ID"/)).not.toBeInTheDocument();
  });
});
