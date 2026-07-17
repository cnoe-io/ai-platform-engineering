/**
 * @jest-environment jsdom
 *
 * McpConnectDialog — progressive disclosure + key lifecycle (#171):
 *  1. Client config tabs are hidden until a key is generated.
 *  2. Generating a key reveals the config tabs and the one-time token.
 *  3. An existing active key is surfaced before generating a new one.
 */

import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

import { McpConnectDialog } from "../McpConnectDialog";

beforeEach(() => {
  global.fetch = jest.fn();
});

afterEach(() => {
  jest.restoreAllMocks();
});

function mockFetchImpl(opts: { hasActiveKey?: boolean; expiresAt?: string } = {}) {
  (global.fetch as jest.Mock).mockImplementation((url: string, init?: RequestInit) => {
    if (!init || init.method === undefined) {
      // GET /api/skills/token status check
      return Promise.resolve({
        ok: true,
        json: async () => ({
          has_active_key: !!opts.hasActiveKey,
          expires_at: opts.expiresAt,
        }),
      });
    }
    // POST /api/skills/token generate
    return Promise.resolve({
      ok: true,
      json: async () => ({ token: "generated-token-value", token_type: "Bearer", expires_in: 7776000 }),
    });
  });
}

describe("McpConnectDialog", () => {
  it("hides client config tabs until a key is generated", async () => {
    mockFetchImpl();
    render(<McpConnectDialog initialOpen />);

    expect(screen.queryByText("Client configuration")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /generate key/i }));

    await waitFor(() => expect(screen.getByText("Client configuration")).toBeInTheDocument());
    expect(screen.getByText("generated-token-value")).toBeInTheDocument();
  });

  it("surfaces an existing active key before generating a new one", async () => {
    mockFetchImpl({ hasActiveKey: true, expiresAt: "2026-12-01T00:00:00.000Z" });
    render(<McpConnectDialog initialOpen />);

    await waitFor(() =>
      expect(screen.getByText(/you already have an active key/i)).toBeInTheDocument(),
    );
    expect(screen.getByRole("button", { name: /regenerate/i })).toBeInTheDocument();
  });
});
