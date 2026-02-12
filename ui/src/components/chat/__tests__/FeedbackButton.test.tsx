/**
 * Unit tests for FeedbackButton component
 *
 * Tests:
 * - Renders thumbs up/down
 * - onFeedbackChange with type like/dislike
 * - Same thumb deselects (type=null)
 * - Like/dislike reasons, Other textarea
 * - Submit disabled without reason
 * - submitFeedback, onFeedbackSubmit
 * - traceId fallback, conversationId
 * - disabled prop
 * - Liked/disliked styling
 * - Popover closes after submit
 */

import React from "react";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

// ============================================================================
// Mocks — must be before imports
// ============================================================================

const mockSubmitFeedback = jest.fn().mockResolvedValue({ success: true });

jest.mock("@/lib/langfuse", () => ({
  submitFeedback: (data: unknown) => mockSubmitFeedback(data),
}));

jest.mock("framer-motion", () => ({
  motion: {
    div: React.forwardRef(
      ({ children, ...props }: { children?: React.ReactNode } & Record<string, unknown>, ref: React.Ref<HTMLDivElement>) => (
        <div ref={ref} {...props}>
          {children}
        </div>
      )
    ),
  },
  AnimatePresence: ({ children }: { children?: React.ReactNode }) => <>{children}</>,
}));

jest.mock("lucide-react", () => ({
  ThumbsUp: (props: { className?: string }) => <span data-testid="icon-thumbs-up" {...props} />,
  ThumbsDown: (props: { className?: string }) => <span data-testid="icon-thumbs-down" {...props} />,
  Loader2: () => <span data-testid="icon-loader" />,
}));

jest.mock("@/components/ui/button", () => ({
  Button: React.forwardRef(
    (
      { children, onClick, disabled, ...props }: { children?: React.ReactNode; onClick?: () => void; disabled?: boolean } & Record<string, unknown>,
      ref: React.Ref<HTMLButtonElement>
    ) => (
      <button ref={ref} onClick={onClick} disabled={disabled} {...props}>
        {children}
      </button>
    )
  ),
}));

jest.mock("@/components/ui/popover", () => ({
  Popover: ({ children }: { children?: React.ReactNode }) => (
    <div data-testid="popover">{children}</div>
  ),
  PopoverTrigger: ({ children, asChild }: { children?: React.ReactNode; asChild?: boolean }) => (
    <div data-testid="popover-trigger">
      {asChild && React.isValidElement(children) ? children : <div>{children}</div>}
    </div>
  ),
  PopoverContent: ({ children }: { children?: React.ReactNode }) => (
    <div data-testid="popover-content">{children}</div>
  ),
}));

jest.mock("@/lib/utils", () => ({
  cn: (...args: unknown[]) => args.filter(Boolean).join(" "),
}));

// ============================================================================
// Imports — after mocks
// ============================================================================

import { FeedbackButton } from "../FeedbackButton";

// ============================================================================
// Tests
// ============================================================================

describe("FeedbackButton", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("renders thumbs up and down buttons", () => {
    render(<FeedbackButton messageId="msg-1" />);
    expect(screen.getByTestId("icon-thumbs-up")).toBeInTheDocument();
    expect(screen.getByTestId("icon-thumbs-down")).toBeInTheDocument();
  });

  it("clicking thumbs up calls onFeedbackChange with type=like", () => {
    const onFeedbackChange = jest.fn();
    render(
      <FeedbackButton messageId="msg-1" onFeedbackChange={onFeedbackChange} />
    );
    fireEvent.click(screen.getByTestId("icon-thumbs-up").closest("button")!);
    expect(onFeedbackChange).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "like",
        showFeedbackOptions: true,
      })
    );
  });

  it("clicking thumbs down calls onFeedbackChange with type=dislike", () => {
    const onFeedbackChange = jest.fn();
    render(
      <FeedbackButton messageId="msg-1" onFeedbackChange={onFeedbackChange} />
    );
    fireEvent.click(screen.getByTestId("icon-thumbs-down").closest("button")!);
    expect(onFeedbackChange).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "dislike",
        showFeedbackOptions: true,
      })
    );
  });

  it("clicking same thumb deselects (type=null)", () => {
    const onFeedbackChange = jest.fn();
    render(
      <FeedbackButton
        messageId="msg-1"
        feedback={{ type: "like", showFeedbackOptions: false }}
        onFeedbackChange={onFeedbackChange}
      />
    );
    fireEvent.click(screen.getByTestId("icon-thumbs-up").closest("button")!);
    expect(onFeedbackChange).toHaveBeenCalledWith(
      expect.objectContaining({
        type: null,
        showFeedbackOptions: false,
        submitted: false,
      })
    );
  });

  it("shows like reasons when liked", () => {
    render(
      <FeedbackButton
        messageId="msg-1"
        feedback={{ type: "like", showFeedbackOptions: true }}
      />
    );
    expect(screen.getByText("Very Helpful")).toBeInTheDocument();
    expect(screen.getByText("Accurate")).toBeInTheDocument();
    expect(screen.getByText("Simplified My Task")).toBeInTheDocument();
    expect(screen.getByText("Other")).toBeInTheDocument();
  });

  it("shows dislike reasons when disliked", () => {
    render(
      <FeedbackButton
        messageId="msg-1"
        feedback={{ type: "dislike", showFeedbackOptions: true }}
      />
    );
    expect(screen.getByText("Inaccurate")).toBeInTheDocument();
    expect(screen.getByText("Poorly Formatted")).toBeInTheDocument();
    expect(screen.getByText("Incomplete")).toBeInTheDocument();
    expect(screen.getByText("Off-topic")).toBeInTheDocument();
    expect(screen.getByText("Other")).toBeInTheDocument();
  });

  it("selecting reason calls onFeedbackChange with reason", () => {
    const onFeedbackChange = jest.fn();
    render(
      <FeedbackButton
        messageId="msg-1"
        feedback={{ type: "like", showFeedbackOptions: true }}
        onFeedbackChange={onFeedbackChange}
      />
    );
    fireEvent.click(screen.getByText("Very Helpful"));
    expect(onFeedbackChange).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "like",
        reason: "Very Helpful",
      })
    );
  });

  it("'Other' shows textarea", () => {
    render(
      <FeedbackButton
        messageId="msg-1"
        feedback={{ type: "like", reason: "Other", showFeedbackOptions: true }}
      />
    );
    expect(screen.getByPlaceholderText("Provide additional feedback")).toBeInTheDocument();
  });

  it("submit button disabled without reason", () => {
    render(
      <FeedbackButton
        messageId="msg-1"
        feedback={{ type: "like", showFeedbackOptions: true }}
      />
    );
    const submitBtn = screen.getByText("Submit Feedback").closest("button");
    expect(submitBtn).toBeDisabled();
  });

  it("submit calls submitFeedback with correct data", async () => {
    const onFeedbackSubmit = jest.fn();
    render(
      <FeedbackButton
        messageId="msg-1"
        traceId="trace-123"
        conversationId="conv-456"
        feedback={{ type: "like", reason: "Accurate", showFeedbackOptions: true }}
        onFeedbackSubmit={onFeedbackSubmit}
      />
    );
    fireEvent.click(screen.getByText("Submit Feedback"));
    await waitFor(() => {
      expect(mockSubmitFeedback).toHaveBeenCalledWith(
        expect.objectContaining({
          traceId: "trace-123",
          messageId: "msg-1",
          feedbackType: "like",
          reason: "Accurate",
          conversationId: "conv-456",
        })
      );
    });
  });

  it("submit calls onFeedbackSubmit", async () => {
    const onFeedbackSubmit = jest.fn();
    render(
      <FeedbackButton
        messageId="msg-1"
        feedback={{ type: "dislike", reason: "Inaccurate", showFeedbackOptions: true }}
        onFeedbackSubmit={onFeedbackSubmit}
      />
    );
    fireEvent.click(screen.getByText("Submit Feedback"));
    await waitFor(() => {
      expect(onFeedbackSubmit).toHaveBeenCalledWith(
        expect.objectContaining({
          type: "dislike",
          reason: "Inaccurate",
          submitted: true,
        })
      );
    });
  });

  it("includes traceId (falls back to messageId)", async () => {
    render(
      <FeedbackButton
        messageId="msg-1"
        feedback={{ type: "like", reason: "Very Helpful", showFeedbackOptions: true }}
      />
    );
    fireEvent.click(screen.getByText("Submit Feedback"));
    await waitFor(() => {
      expect(mockSubmitFeedback).toHaveBeenCalledWith(
        expect.objectContaining({
          traceId: "msg-1",
          messageId: "msg-1",
        })
      );
    });
  });

  it("includes conversationId", async () => {
    render(
      <FeedbackButton
        messageId="msg-1"
        conversationId="conv-789"
        feedback={{ type: "like", reason: "Accurate", showFeedbackOptions: true }}
      />
    );
    fireEvent.click(screen.getByText("Submit Feedback"));
    await waitFor(() => {
      expect(mockSubmitFeedback).toHaveBeenCalledWith(
        expect.objectContaining({
          conversationId: "conv-789",
        })
      );
    });
  });

  it("disabled prop prevents clicks", () => {
    const onFeedbackChange = jest.fn();
    render(
      <FeedbackButton messageId="msg-1" disabled onFeedbackChange={onFeedbackChange} />
    );
    fireEvent.click(screen.getByTestId("icon-thumbs-up").closest("button")!);
    expect(onFeedbackChange).not.toHaveBeenCalled();
  });

  it("liked state shows green styling", () => {
    render(
      <FeedbackButton
        messageId="msg-1"
        feedback={{ type: "like" }}
      />
    );
    const thumbsUpBtn = screen.getByTestId("icon-thumbs-up").closest("button");
    expect(thumbsUpBtn?.className).toMatch(/green/);
  });

  it("disliked state shows red styling", () => {
    render(
      <FeedbackButton
        messageId="msg-1"
        feedback={{ type: "dislike" }}
      />
    );
    const thumbsDownBtn = screen.getByTestId("icon-thumbs-down").closest("button");
    expect(thumbsDownBtn?.className).toMatch(/red/);
  });

  it("popover closes after submit", async () => {
    const onFeedbackChange = jest.fn();
    render(
      <FeedbackButton
        messageId="msg-1"
        feedback={{ type: "like", reason: "Accurate", showFeedbackOptions: true }}
        onFeedbackChange={onFeedbackChange}
      />
    );
    fireEvent.click(screen.getByText("Submit Feedback"));
    await waitFor(() => {
      expect(onFeedbackChange).toHaveBeenCalledWith(
        expect.objectContaining({
          showFeedbackOptions: false,
          submitted: true,
        })
      );
    });
  });
});
