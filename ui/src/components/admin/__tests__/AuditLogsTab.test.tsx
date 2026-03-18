/**
 * Unit tests for AuditLogsTab component
 *
 * Tests:
 * - Auto-loads audit logs on mount (no manual Search click needed)
 * - Conversation links include ?from=audit-logs query parameter
 * - Shows results table after auto-load
 * - Search button triggers new fetch
 * - Reset clears results and filters
 * - Empty state only after explicit reset
 */

import React from "react";
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";

// ============================================================================
// Mocks — must be before imports
// ============================================================================

const mockFetch = jest.fn();
global.fetch = mockFetch;

jest.mock("lucide-react", () => ({
  Search: () => <span data-testid="icon-search" />,
  Loader2: ({ className }: { className?: string }) => (
    <span data-testid="icon-loader" className={className} />
  ),
  ChevronLeft: () => <span data-testid="icon-chevron-left" />,
  ChevronRight: () => <span data-testid="icon-chevron-right" />,
  FileText: () => <span data-testid="icon-file-text" />,
  RotateCcw: () => <span data-testid="icon-rotate" />,
  ExternalLink: () => <span data-testid="icon-external" />,
  Copy: () => <span data-testid="icon-copy" />,
  Check: () => <span data-testid="icon-check" />,
  Download: () => <span data-testid="icon-download" />,
  ChevronsUpDown: () => <span data-testid="icon-chevrons" />,
  X: () => <span data-testid="icon-x" />,
}));

jest.mock("@/components/ui/card", () => ({
  Card: ({ children }: { children?: React.ReactNode }) => (
    <div data-testid="card">{children}</div>
  ),
  CardContent: ({ children }: { children?: React.ReactNode }) => (
    <div data-testid="card-content">{children}</div>
  ),
  CardDescription: ({ children }: { children?: React.ReactNode }) => (
    <p>{children}</p>
  ),
  CardHeader: ({ children }: { children?: React.ReactNode }) => (
    <div>{children}</div>
  ),
  CardTitle: ({ children }: { children?: React.ReactNode }) => (
    <h3>{children}</h3>
  ),
}));

jest.mock("@/components/ui/button", () => ({
  Button: React.forwardRef(
    (
      { children, onClick, disabled, type, ...props }: any,
      ref: React.Ref<HTMLButtonElement>
    ) => (
      <button ref={ref} onClick={onClick} disabled={disabled} type={type} {...props}>
        {children}
      </button>
    )
  ),
}));

jest.mock("@/components/ui/input", () => ({
  Input: React.forwardRef((props: any, ref: any) => <input ref={ref} {...props} />),
}));

jest.mock("@/components/ui/badge", () => ({
  Badge: ({ children, ...props }: any) => <span {...props}>{children}</span>,
}));

jest.mock("@/components/admin/ConversationDetailDialog", () => ({
  ConversationDetailDialog: () => <div data-testid="conversation-detail-dialog" />,
}));

// ============================================================================
// Imports — after mocks
// ============================================================================

import { AuditLogsTab } from "../AuditLogsTab";

// ============================================================================
// Helpers
// ============================================================================

const MOCK_CONVERSATION = {
  _id: "conv-abc12345-test",
  title: "Test Conversation",
  owner_id: "user@example.com",
  message_count: 5,
  status: "active",
  created_at: "2026-03-01T00:00:00Z",
  updated_at: "2026-03-15T00:00:00Z",
};

function mockAuditLogsResponse(items = [MOCK_CONVERSATION], total = 1) {
  return {
    ok: true,
    json: async () => ({
      success: true,
      data: {
        items,
        total,
        page: 1,
        page_size: 20,
        has_more: false,
      },
    }),
  };
}

function mockOwnersResponse(owners: string[] = []) {
  return {
    ok: true,
    json: async () => ({
      success: true,
      data: { owners },
    }),
  };
}

// ============================================================================
// Tests
// ============================================================================

describe("AuditLogsTab", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();
    mockFetch.mockImplementation((url: string) => {
      if (url.includes("/api/admin/audit-logs/owners")) {
        return Promise.resolve(mockOwnersResponse());
      }
      if (url.includes("/api/admin/audit-logs")) {
        return Promise.resolve(mockAuditLogsResponse());
      }
      return Promise.resolve({ ok: true, json: async () => ({}) });
    });
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it("auto-loads audit logs on mount without clicking Search", async () => {
    await act(async () => {
      render(<AuditLogsTab isAdmin={true} />);
      jest.runAllTimers();
    });

    await waitFor(() => {
      const auditCalls = mockFetch.mock.calls.filter(
        ([url]: [string]) =>
          url.includes("/api/admin/audit-logs") &&
          !url.includes("/owners")
      );
      expect(auditCalls.length).toBeGreaterThanOrEqual(1);
    });
  });

  it("shows results after auto-load", async () => {
    await act(async () => {
      render(<AuditLogsTab isAdmin={true} />);
      jest.runAllTimers();
    });

    await waitFor(() => {
      expect(screen.getByText("Test Conversation")).toBeInTheDocument();
    });
  });

  it("does not show empty state prompt after auto-load", async () => {
    await act(async () => {
      render(<AuditLogsTab isAdmin={true} />);
      jest.runAllTimers();
    });

    await waitFor(() => {
      expect(screen.getByText("Test Conversation")).toBeInTheDocument();
    });

    expect(
      screen.queryByText(/Use the filters above and click Search/)
    ).not.toBeInTheDocument();
  });

  it("conversation links include ?from=audit-logs", async () => {
    await act(async () => {
      render(<AuditLogsTab isAdmin={true} />);
      jest.runAllTimers();
    });

    await waitFor(() => {
      expect(screen.getByText("Test Conversation")).toBeInTheDocument();
    });

    const link = screen.getByTitle("conv-abc12345-test");
    expect(link).toHaveAttribute(
      "href",
      "/chat/conv-abc12345-test?from=audit-logs"
    );
    expect(link).toHaveAttribute("target", "_blank");
  });

  it("Search button triggers a new fetch", async () => {
    await act(async () => {
      render(<AuditLogsTab isAdmin={true} />);
      jest.runAllTimers();
    });

    await waitFor(() => {
      expect(screen.getByText("Test Conversation")).toBeInTheDocument();
    });

    const initialCallCount = mockFetch.mock.calls.filter(
      ([url]: [string]) =>
        url.includes("/api/admin/audit-logs") && !url.includes("/owners")
    ).length;

    await act(async () => {
      fireEvent.click(screen.getByText("Search"));
    });

    await waitFor(() => {
      const newCallCount = mockFetch.mock.calls.filter(
        ([url]: [string]) =>
          url.includes("/api/admin/audit-logs") && !url.includes("/owners")
      ).length;
      expect(newCallCount).toBeGreaterThan(initialCallCount);
    });
  });

  it("Reset clears results and shows empty state", async () => {
    await act(async () => {
      render(<AuditLogsTab isAdmin={true} />);
      jest.runAllTimers();
    });

    await waitFor(() => {
      expect(screen.getByText("Test Conversation")).toBeInTheDocument();
    });

    await act(async () => {
      fireEvent.click(screen.getByText("Reset"));
    });

    expect(screen.queryByText("Test Conversation")).not.toBeInTheDocument();
    expect(
      screen.getByText(/Use the filters above and click Search/)
    ).toBeInTheDocument();
  });

  it("shows error message on fetch failure", async () => {
    mockFetch.mockImplementation((url: string) => {
      if (url.includes("/api/admin/audit-logs/owners")) {
        return Promise.resolve(mockOwnersResponse());
      }
      if (url.includes("/api/admin/audit-logs")) {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            success: false,
            error: "Database connection failed",
          }),
        });
      }
      return Promise.resolve({ ok: true, json: async () => ({}) });
    });

    await act(async () => {
      render(<AuditLogsTab isAdmin={true} />);
      jest.runAllTimers();
    });

    await waitFor(() => {
      expect(screen.getByText("Database connection failed")).toBeInTheDocument();
    });
  });

  it("displays conversation count after load", async () => {
    mockFetch.mockImplementation((url: string) => {
      if (url.includes("/api/admin/audit-logs/owners")) {
        return Promise.resolve(mockOwnersResponse());
      }
      if (url.includes("/api/admin/audit-logs")) {
        return Promise.resolve(mockAuditLogsResponse([MOCK_CONVERSATION], 1));
      }
      return Promise.resolve({ ok: true, json: async () => ({}) });
    });

    await act(async () => {
      render(<AuditLogsTab isAdmin={true} />);
      jest.runAllTimers();
    });

    await waitFor(() => {
      expect(screen.getByText("1 conversation found")).toBeInTheDocument();
    });
  });
});
