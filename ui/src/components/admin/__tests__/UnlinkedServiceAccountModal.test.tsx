/**
 * @jest-environment jsdom
 *
 * B2 — UnlinkedServiceAccountModal
 *
 * Tests:
 *  1. Renders scopes returned by the resolver endpoint for an admin.
 *  2. Renders read-only notice and hides edit controls for non-admins.
 *  3. Shows "Add a scope" section for admins.
 *  4. Sends correct POST to /api/admin/service-accounts/[id]/scopes on add.
 *  5. Shows error banner on failed add (single occurrence).
 *  6. Shows remove-confirm flow before DELETE.
 *  7. Error from resolver is displayed (404/error case).
 *  8. Close button calls onOpenChange(false).
 */

import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { UnlinkedServiceAccountModal } from "../UnlinkedServiceAccountModal";

// ── shared fixtures ──

// QUAL-10: sa_sub removed from BFF response — only id/name/scopes
const ANON_SA = {
  id: "anon-sub-abc",
  name: "unlinked",
  scopes: [
    { type: "agent", ref: "hello-world" },
    { type: "tool", ref: "jira/search" },
  ],
};

const GRANTABLE = {
  agents: [
    { ref: "hello-world", name: "Hello World Agent" },
    { ref: "sre-agent", name: "SRE Agent" },
  ],
  tools: [{ ref: "jira/search", name: "Jira: search" }],
};

function mockFetch({
  sa = { success: true, data: ANON_SA },
  grantable = { success: true, data: GRANTABLE },
  scopePost = { success: true, data: { added: { type: "agent", ref: "sre-agent" } } },
  scopeDelete = { success: true, data: { removed: { type: "agent", ref: "hello-world" } } },
}: {
  sa?: object;
  grantable?: object;
  scopePost?: object;
  scopeDelete?: object;
} = {}) {
  global.fetch = jest.fn((url: RequestInfo | URL, init?: RequestInit) => {
    const href = String(url);
    const method = init?.method?.toUpperCase() ?? "GET";

    if (href.includes("/api/admin/service-accounts/unlinked")) {
      return Promise.resolve({
        ok: (sa as Record<string, unknown>).success !== false,
        json: () => Promise.resolve(sa),
      } as Response);
    }
    if (href.includes("/api/admin/service-accounts/grantable")) {
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve(grantable),
      } as Response);
    }
    if (href.includes("/scopes") && method === "POST") {
      return Promise.resolve({
        ok: (scopePost as Record<string, unknown>).success !== false,
        json: () => Promise.resolve(scopePost),
      } as Response);
    }
    if (href.includes("/scopes") && method === "DELETE") {
      return Promise.resolve({
        ok: (scopeDelete as Record<string, unknown>).success !== false,
        json: () => Promise.resolve(scopeDelete),
      } as Response);
    }
    return Promise.reject(new Error(`Unexpected fetch: ${href} [${method}]`));
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  mockFetch();
});

describe("UnlinkedServiceAccountModal", () => {
  it("renders scopes returned by the resolver for an admin", async () => {
    render(
      <UnlinkedServiceAccountModal open isAdmin onOpenChange={jest.fn()} />,
    );

    // Use data-testid to avoid cross-element text matching issues
    await waitFor(() => {
      expect(screen.getByTestId("scope-agent-hello-world")).toBeInTheDocument();
    });
    expect(screen.getByTestId("scope-tool-jira/search")).toBeInTheDocument();
  });

  it("shows the Add a scope section for admins", async () => {
    render(
      <UnlinkedServiceAccountModal open isAdmin onOpenChange={jest.fn()} />,
    );

    await waitFor(() => {
      expect(screen.getByText(/add a scope/i)).toBeInTheDocument();
    });
  });

  it("hides Add a scope and shows read-only notice for non-admins", async () => {
    render(
      <UnlinkedServiceAccountModal open isAdmin={false} onOpenChange={jest.fn()} />,
    );

    await waitFor(() => {
      expect(screen.getByTestId("scope-agent-hello-world")).toBeInTheDocument();
    });
    expect(screen.queryByText(/add a scope/i)).not.toBeInTheDocument();
    expect(screen.getByText(/read-only/i)).toBeInTheDocument();
  });

  it("shows 'No scopes' when the SA has no scopes", async () => {
    mockFetch({
      sa: { success: true, data: { ...ANON_SA, scopes: [] } },
    });

    render(
      <UnlinkedServiceAccountModal open isAdmin onOpenChange={jest.fn()} />,
    );

    await waitFor(() => {
      expect(screen.getByText(/no scopes/i)).toBeInTheDocument();
    });
  });

  it("sends POST to /scopes with the correct SA id and scope on add", async () => {
    render(
      <UnlinkedServiceAccountModal open isAdmin onOpenChange={jest.fn()} />,
    );

    await waitFor(() => screen.getByText(/add a scope/i));

    // sre-agent is not in ANON_SA.scopes so it should appear in the ref picker.
    const refSelect = screen.getByRole("combobox", { name: /scope ref/i });
    fireEvent.change(refSelect, { target: { value: "sre-agent" } });
    fireEvent.click(screen.getByRole("button", { name: /^add$/i }));

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith(
        `/api/admin/service-accounts/${encodeURIComponent(ANON_SA.id)}/scopes`,
        expect.objectContaining({
          method: "POST",
          body: JSON.stringify({ type: "agent", ref: "sre-agent" }),
        }),
      );
    });
  });

  it("shows a single error banner when the POST fails", async () => {
    mockFetch({
      scopePost: { success: false, error: "You cannot grant a scope you do not hold" },
    });

    render(
      <UnlinkedServiceAccountModal open isAdmin onOpenChange={jest.fn()} />,
    );

    await waitFor(() => screen.getByText(/add a scope/i));

    const refSelect = screen.getByRole("combobox", { name: /scope ref/i });
    fireEvent.change(refSelect, { target: { value: "sre-agent" } });
    fireEvent.click(screen.getByRole("button", { name: /^add$/i }));

    await waitFor(() => {
      const errors = screen.getAllByTestId("unlinked-modal-error");
      expect(errors).toHaveLength(1);
      expect(errors[0]).toHaveTextContent(/cannot grant a scope you do not hold/i);
    });
  });

  it("shows confirm flow before DELETE and sends DELETE on confirm", async () => {
    render(
      <UnlinkedServiceAccountModal open isAdmin onOpenChange={jest.fn()} />,
    );

    await waitFor(() => {
      expect(screen.getByLabelText(/remove agent hello-world/i)).toBeInTheDocument();
    });

    // Click the remove button to enter confirm flow
    fireEvent.click(screen.getByLabelText(/remove agent hello-world/i));
    expect(screen.getByText(/remove\?/i)).toBeInTheDocument();

    // Confirm the removal
    fireEvent.click(screen.getByRole("button", { name: /^confirm$/i }));

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith(
        `/api/admin/service-accounts/${encodeURIComponent(ANON_SA.id)}/scopes`,
        expect.objectContaining({
          method: "DELETE",
          body: JSON.stringify({ type: "agent", ref: "hello-world" }),
        }),
      );
    });
  });

  it("shows an error when the resolver returns an error", async () => {
    mockFetch({
      sa: {
        success: false,
        error: "Unlinked service account not found or not yet bootstrapped",
      },
    });

    render(
      <UnlinkedServiceAccountModal open isAdmin onOpenChange={jest.fn()} />,
    );

    await waitFor(() => {
      expect(screen.getByTestId("unlinked-modal-error")).toHaveTextContent(
        /unlinked service account not found/i,
      );
    });
  });

  it("calls onOpenChange(false) when the Close button in the footer is clicked", async () => {
    const onOpenChange = jest.fn();
    render(
      <UnlinkedServiceAccountModal open isAdmin onOpenChange={onOpenChange} />,
    );

    await waitFor(() => screen.getByTestId("scope-agent-hello-world"));

    // Use data-testid to get the specific footer Close button
    const closeBtn = screen.getByTestId("unlinked-modal-close");
    fireEvent.click(closeBtn);
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });
});

// ── TEST-11 / UX-5 ─────────────────────────────────────────────────────────

describe("UnlinkedServiceAccountModal — grantable fetch failure (TEST-11/UX-5)", () => {
  it("shows grantable-fetch failure banner when grantable fetch fails (not just empty)", async () => {
    mockFetch({
      grantable: { success: false, error: "Failed to load grantable scopes" },
    });

    render(
      <UnlinkedServiceAccountModal open isAdmin onOpenChange={jest.fn()} />,
    );

    await waitFor(() => {
      expect(screen.getByTestId("unlinked-modal-grantable-error")).toBeInTheDocument();
    });
    expect(screen.getByTestId("unlinked-modal-grantable-error")).toHaveTextContent(
      /failed to load grantable scopes/i,
    );
    // The grantable error banner must be distinct from the SA error banner
    expect(screen.queryByTestId("unlinked-modal-error")).not.toBeInTheDocument();
  });

  it("shows grantable-fetch failure when fetch throws (network error)", async () => {
    global.fetch = jest.fn((url: RequestInfo | URL) => {
      const href = String(url);
      if (href.includes("/api/admin/service-accounts/unlinked")) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ success: true, data: ANON_SA }),
        } as Response);
      }
      if (href.includes("/api/admin/service-accounts/grantable")) {
        return Promise.reject(new Error("Network error"));
      }
      return Promise.reject(new Error("Unexpected fetch"));
    });

    render(
      <UnlinkedServiceAccountModal open isAdmin onOpenChange={jest.fn()} />,
    );

    await waitFor(() => {
      expect(screen.getByTestId("unlinked-modal-grantable-error")).toBeInTheDocument();
    });
    expect(screen.getByTestId("unlinked-modal-grantable-error")).toHaveTextContent(
      /network error/i,
    );
  });

  it("UX-5: shows the platform-admin limitation note when grantable is empty (loaded OK)", async () => {
    mockFetch({
      grantable: { success: true, data: { agents: [], tools: [] } },
    });

    render(
      <UnlinkedServiceAccountModal open isAdmin onOpenChange={jest.fn()} />,
    );

    await waitFor(() => {
      expect(screen.getByTestId("unlinked-modal-grantable-empty-note")).toBeInTheDocument();
    });
    expect(screen.getByTestId("unlinked-modal-grantable-empty-note")).toHaveTextContent(
      /platform admin.*can only grant/i,
    );
    // Error banner must not be shown — this is a normal (empty) result, not a failure
    expect(screen.queryByTestId("unlinked-modal-grantable-error")).not.toBeInTheDocument();
  });

  it("does NOT show the limitation note when grantable has items", async () => {
    // Default mockFetch has GRANTABLE with agents
    render(
      <UnlinkedServiceAccountModal open isAdmin onOpenChange={jest.fn()} />,
    );

    await waitFor(() => screen.getByText(/add a scope/i));
    expect(screen.queryByTestId("unlinked-modal-grantable-empty-note")).not.toBeInTheDocument();
  });
});
