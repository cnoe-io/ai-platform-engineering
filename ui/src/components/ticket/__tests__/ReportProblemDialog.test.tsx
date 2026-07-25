/**
 * Unit tests for ReportProblemDialog component
 *
 * Tests:
 * - Renders dialog with "Provide Feedback" title
 * - Issue Type + Area chips are shown and required before submit
 * - Submit button enabled when feedbackContext is provided (chips hidden, no area/type needed)
 * - Selecting TOME routes to the direct GitHub API path; other areas route to Jira
 * - Shows success state with ticket result
 * - Shows error state on failure
 * - Cancel during submission aborts the request
 * - Displays feedback context in combo flow
 * - Shows streaming debug log panel
 */

import React from "react";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

// ============================================================================
// Mocks — must be before imports
// ============================================================================

let mockGithubScreenshotsRepo: string | null = null;
jest.mock("@/lib/config", () => ({
  getConfig: (key: string) => {
    switch (key) {
      case "ticketProvider":
        return "jira";
      case "jiraTicketProject":
        return "OPENSD";
      case "jiraBaseUrl":
        return "https://org.atlassian.net";
      case "githubTicketRepo":
        return "org/repo";
      case "githubScreenshotsRepo":
        return mockGithubScreenshotsRepo;
      default:
        return null;
    }
  },
}));

const mockCreateTicket = jest.fn();

jest.mock("@/components/ui/toast", () => ({
  useToast: () => ({ toast: jest.fn() }),
}));

jest.mock("@/lib/ticket-client", () => ({
  createTicket: (opts: unknown) => mockCreateTicket(opts),
}));

jest.mock("next-auth/react", () => ({
  useSession: () => ({
    data: {
      user: { email: "test@example.com" },
      accessToken: "test-token",
    },
  }),
}));

jest.mock("next/navigation", () => ({
  usePathname: () => "/chat/test-uuid",
}));

jest.mock("framer-motion", () => ({
  motion: {
    // eslint-disable-next-line react/display-name
    div: React.forwardRef(
      (
        {
          children,
          ...props
        }: { children?: React.ReactNode } & Record<string, unknown>,
        ref: React.Ref<HTMLDivElement>
      ) => (
        <div ref={ref} {...props}>
          {children}
        </div>
      )
    ),
  },
  AnimatePresence: ({ children }: { children?: React.ReactNode }) => (
    <>{children}</>
  ),
}));

jest.mock("lucide-react", () => ({
  AlertCircle: () => <span data-testid="icon-alert" />,
  Camera: () => <span data-testid="icon-camera" />,
  CheckCircle2: () => <span data-testid="icon-check" />,
  ChevronDown: () => <span data-testid="icon-chevron-down" />,
  ChevronUp: () => <span data-testid="icon-chevron-up" />,
  Copy: () => <span data-testid="icon-copy" />,
  ExternalLink: () => <span data-testid="icon-external" />,
  GitBranch: () => <span data-testid="icon-git-branch" />,
  Loader2: () => <span data-testid="icon-loader" />,
  Monitor: () => <span data-testid="icon-monitor" />,
  RefreshCw: () => <span data-testid="icon-refresh" />,
  Square: () => <span data-testid="icon-square" />,
  Terminal: () => <span data-testid="icon-terminal" />,
  Upload: () => <span data-testid="icon-upload" />,
  X: () => <span data-testid="icon-x" />,
}));

jest.mock("@/components/ui/dialog", () => ({
  Dialog: ({
    children,
    open,
  }: {
    children?: React.ReactNode;
    open?: boolean;
  }) => (open ? <div data-testid="dialog">{children}</div> : null),
  DialogContent: ({ children }: { children?: React.ReactNode }) => (
    <div data-testid="dialog-content">{children}</div>
  ),
  DialogHeader: ({ children }: { children?: React.ReactNode }) => (
    <div data-testid="dialog-header">{children}</div>
  ),
  DialogTitle: ({ children }: { children?: React.ReactNode }) => (
    <h2 data-testid="dialog-title">{children}</h2>
  ),
  DialogDescription: ({ children }: { children?: React.ReactNode }) => (
    <p data-testid="dialog-description">{children}</p>
  ),
}));

jest.mock("@/components/ui/button", () => ({
  // eslint-disable-next-line react/display-name
  Button: React.forwardRef(
    (
      {
        children,
        onClick,
        disabled,
        ...props
      }: {
        children?: React.ReactNode;
        onClick?: () => void;
        disabled?: boolean;
      } & Record<string, unknown>,
      ref: React.Ref<HTMLButtonElement>
    ) => (
      <button ref={ref} onClick={onClick} disabled={disabled} {...props}>
        {children}
      </button>
    )
  ),
}));

// ============================================================================
// Import after mocks
// ============================================================================

import { ReportProblemDialog } from "../ReportProblemDialog";

// ============================================================================
// Tests
// ============================================================================

describe("ReportProblemDialog", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGithubScreenshotsRepo = null;
  });

  it("renders dialog with 'Provide Feedback' title", () => {
    render(<ReportProblemDialog open={true} onOpenChange={jest.fn()} />);
    expect(screen.getByTestId("dialog-title")).toHaveTextContent(
      "Provide Feedback"
    );
  });

  it("renders Issue Type and Area chips", () => {
    render(<ReportProblemDialog open={true} onOpenChange={jest.fn()} />);
    expect(screen.getByText("Bug")).toBeInTheDocument();
    expect(screen.getByText("Enhancement")).toBeInTheDocument();
    expect(screen.getByText("TOME")).toBeInTheDocument();
    expect(screen.getByText("Chat")).toBeInTheDocument();
  });

  it("submit button is disabled until issue type, area, and description are all set", () => {
    render(<ReportProblemDialog open={true} onOpenChange={jest.fn()} />);
    const submitBtn = screen.getByText("Submit Report");
    expect(submitBtn).toBeDisabled();

    fireEvent.click(screen.getByText("Bug"));
    expect(submitBtn).toBeDisabled();

    fireEvent.click(screen.getByText("TOME"));
    expect(submitBtn).toBeDisabled();

    fireEvent.change(
      screen.getByPlaceholderText("What went wrong? Be as specific as you can."),
      { target: { value: "Something broke" } }
    );
    expect(submitBtn).not.toBeDisabled();
  });

  it("submit button is enabled when feedbackContext is provided (chips hidden)", () => {
    render(
      <ReportProblemDialog
        open={true}
        onOpenChange={jest.fn()}
        feedbackContext={{
          reason: "Inaccurate",
          feedbackType: "dislike",
        }}
      />
    );
    expect(screen.queryByText("Enhancement")).not.toBeInTheDocument();
    const submitBtn = screen.getByText("Submit Report");
    expect(submitBtn).not.toBeDisabled();
  });

  it("shows feedback context in combo flow", () => {
    render(
      <ReportProblemDialog
        open={true}
        onOpenChange={jest.fn()}
        feedbackContext={{
          reason: "Off-topic",
          additionalFeedback: "Response was unrelated",
          feedbackType: "dislike",
        }}
      />
    );
    expect(screen.getByText(/Off-topic/)).toBeInTheDocument();
    expect(screen.getByText(/Response was unrelated/)).toBeInTheDocument();
  });

  it("routes to GitHub (area: TOME) when TOME is selected", async () => {
    mockCreateTicket.mockResolvedValue({
      id: "#169",
      url: "https://github.com/org/repo/issues/169",
      provider: "github",
    });

    render(<ReportProblemDialog open={true} onOpenChange={jest.fn()} />);
    fireEvent.click(screen.getByText("Bug"));
    fireEvent.click(screen.getByText("TOME"));
    fireEvent.change(
      screen.getByPlaceholderText("What went wrong? Be as specific as you can."),
      { target: { value: "Something broke" } }
    );
    fireEvent.click(screen.getByText(/Submit GitHub Issue/));

    await waitFor(() => {
      expect(mockCreateTicket).toHaveBeenCalledWith(
        expect.objectContaining({ area: "TOME", issueType: "Bug" })
      );
    });
  });

  it("routes to Jira when a non-TOME area is selected", async () => {
    mockCreateTicket.mockResolvedValue({
      id: "OPENSD-123",
      url: "https://org.atlassian.net/browse/OPENSD-123",
      provider: "jira",
    });

    render(<ReportProblemDialog open={true} onOpenChange={jest.fn()} />);
    fireEvent.click(screen.getByText("Enhancement"));
    fireEvent.click(screen.getByText("Chat"));
    fireEvent.change(
      screen.getByPlaceholderText("What went wrong? Be as specific as you can."),
      { target: { value: "Something broke" } }
    );
    fireEvent.click(screen.getByText(/Submit Jira Ticket/));

    await waitFor(() => {
      expect(mockCreateTicket).toHaveBeenCalledWith(
        expect.objectContaining({ area: "Chat", issueType: "Enhancement" })
      );
    });
  });

  it("shows success state with ticket result", async () => {
    mockCreateTicket.mockResolvedValue({
      id: "OPENSD-456",
      url: "https://jira.example.com/browse/OPENSD-456",
      provider: "jira",
    });

    render(<ReportProblemDialog open={true} onOpenChange={jest.fn()} />);
    fireEvent.click(screen.getByText("Bug"));
    fireEvent.click(screen.getByText("Skills"));
    fireEvent.change(
      screen.getByPlaceholderText("What went wrong? Be as specific as you can."),
      { target: { value: "Something broke" } }
    );
    fireEvent.click(screen.getByText(/Submit Jira Ticket/));

    await waitFor(() => {
      expect(screen.getByText("OPENSD-456")).toBeInTheDocument();
    });
  });

  it("shows error state on failure", async () => {
    mockCreateTicket.mockRejectedValue(new Error("Request failed (401)"));

    render(<ReportProblemDialog open={true} onOpenChange={jest.fn()} />);
    fireEvent.click(screen.getByText("Bug"));
    fireEvent.click(screen.getByText("Skills"));
    fireEvent.change(
      screen.getByPlaceholderText("What went wrong? Be as specific as you can."),
      { target: { value: "Bug report" } }
    );
    fireEvent.click(screen.getByText(/Submit Jira Ticket/));

    await waitFor(() => {
      expect(screen.getByText("Request failed (401)")).toBeInTheDocument();
    });
  });

  it("does not render when not open", () => {
    render(<ReportProblemDialog open={false} onOpenChange={jest.fn()} />);
    expect(screen.queryByTestId("dialog")).not.toBeInTheDocument();
  });

  it("preselects area from preselectedArea prop", () => {
    render(
      <ReportProblemDialog
        open={true}
        onOpenChange={jest.fn()}
        preselectedArea="TOME"
      />
    );
    expect(screen.getByText(/GitHub issue in org\/repo/)).toBeInTheDocument();
  });

  it("hides screenshot capture for TOME (GitHub) when no screenshots repo is configured", () => {
    mockGithubScreenshotsRepo = null;
    render(<ReportProblemDialog open={true} onOpenChange={jest.fn()} preselectedArea="TOME" />);
    expect(screen.queryByText("Auto-capture screen")).not.toBeInTheDocument();
    expect(screen.queryByText("Upload image")).not.toBeInTheDocument();
  });

  it("shows screenshot capture for TOME (GitHub) when a screenshots repo is configured", () => {
    mockGithubScreenshotsRepo = "org/screenshots";
    render(<ReportProblemDialog open={true} onOpenChange={jest.fn()} preselectedArea="TOME" />);
    expect(screen.getByText("Auto-capture screen")).toBeInTheDocument();
    expect(screen.getByText("Upload image")).toBeInTheDocument();
  });

  it("always shows screenshot capture for non-TOME (Jira) areas", () => {
    render(<ReportProblemDialog open={true} onOpenChange={jest.fn()} />);
    fireEvent.click(screen.getByText("Chat"));
    expect(screen.getByText("Auto-capture screen")).toBeInTheDocument();
  });
});
