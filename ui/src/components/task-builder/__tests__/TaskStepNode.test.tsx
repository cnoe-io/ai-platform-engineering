/**
 * Unit tests for TaskStepNode component
 *
 * Tests:
 * - Renders with correct subagent badge (GitHub, Input, Jira)
 * - Displays display_text
 * - Shows step number
 * - Shows file I/O badges when llm_prompt contains file references
 * - Hides file badges when no file references
 * - Delete button calls onDelete with correct id
 * - Selected state applies primary ring
 * - Theme-aware: dark vs light styles
 * - Handles unknown subagent with default style
 */

import React from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import type { NodeProps } from "@xyflow/react";

// ============================================================================
// Mocks — must be before imports
// ============================================================================

let mockResolvedTheme = "dark";
jest.mock("next-themes", () => ({
  useTheme: () => ({ resolvedTheme: mockResolvedTheme }),
}));

jest.mock("@xyflow/react", () => ({
  Handle: ({ type }: { type: string }) => (
    <div data-testid={`handle-${type}`} />
  ),
  Position: { Top: "top", Bottom: "bottom" },
}));

jest.mock("@/lib/utils", () => ({
  cn: (...args: unknown[]) => args.filter(Boolean).join(" "),
}));

const mockExtractFileIO = jest.fn();
jest.mock("@/types/task-config", () => ({
  extractFileIO: (prompt: string) => mockExtractFileIO(prompt),
}));

// ============================================================================
// Imports — after mocks
// ============================================================================

import { TaskStepNode } from "../TaskStepNode";

// ============================================================================
// Helpers
// ============================================================================

function makeNodeProps(
  overrides?: Partial<TaskStepNodeData>
): NodeProps<{ stepIndex: number; display_text: string; llm_prompt: string; subagent: string }> {
  return {
    id: "step-0",
    type: "taskStep",
    data: {
      stepIndex: 0,
      display_text: "Test step",
      llm_prompt: "Do something",
      subagent: "github",
      onDelete: jest.fn(),
      ...overrides,
    },
    selected: false,
    isConnectable: true,
    zIndex: 1,
    positionAbsoluteX: 0,
    positionAbsoluteY: 0,
    dragging: false,
    measured: { width: 200, height: 80 },
    parentWidth: 400,
    parentHeight: 300,
    initialized: true,
    isParent: false,
    noDragClassName: "",
    noDropClassName: "",
    noPanClassName: "",
  } as unknown as NodeProps<{ stepIndex: number; display_text: string; llm_prompt: string; subagent: string }>;
}

// ============================================================================
// Tests
// ============================================================================

describe("TaskStepNode", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockResolvedTheme = "dark";
    mockExtractFileIO.mockReturnValue({ reads: [], writes: [] });
  });

  it("renders with GitHub subagent badge", () => {
    render(<TaskStepNode {...makeNodeProps({ subagent: "github" })} />);
    expect(screen.getByText("GitHub")).toBeInTheDocument();
  });

  it("renders with Input subagent badge for caipe", () => {
    render(<TaskStepNode {...makeNodeProps({ subagent: "caipe" })} />);
    expect(screen.getByText("Input")).toBeInTheDocument();
  });

  it("renders with Jira subagent badge", () => {
    render(<TaskStepNode {...makeNodeProps({ subagent: "jira" })} />);
    expect(screen.getByText("Jira")).toBeInTheDocument();
  });

  it("displays display_text", () => {
    render(
      <TaskStepNode
        {...makeNodeProps({ display_text: "Create GitHub repository" })}
      />
    );
    expect(screen.getByText("Create GitHub repository")).toBeInTheDocument();
  });

  it("shows Untitled step when display_text is empty", () => {
    render(<TaskStepNode {...makeNodeProps({ display_text: "" })} />);
    expect(screen.getByText("Untitled step")).toBeInTheDocument();
  });

  it("shows step number", () => {
    render(<TaskStepNode {...makeNodeProps({ stepIndex: 2 })} />);
    expect(screen.getByText("#3")).toBeInTheDocument();
  });

  it("shows file I/O badges when llm_prompt contains file references", () => {
    mockExtractFileIO.mockReturnValue({
      reads: ["/data/input.txt"],
      writes: ["/data/output.txt"],
    });
    render(<TaskStepNode {...makeNodeProps()} />);
    expect(screen.getByTitle("Reads /data/input.txt")).toBeInTheDocument();
    expect(screen.getByTitle("Writes /data/output.txt")).toBeInTheDocument();
    expect(screen.getByText("input.txt")).toBeInTheDocument();
    expect(screen.getByText("output.txt")).toBeInTheDocument();
  });

  it("hides file badges when no file references", () => {
    mockExtractFileIO.mockReturnValue({ reads: [], writes: [] });
    render(<TaskStepNode {...makeNodeProps()} />);
    expect(screen.queryByTitle(/Reads/)).not.toBeInTheDocument();
    expect(screen.queryByTitle(/Writes/)).not.toBeInTheDocument();
  });

  it("delete button calls onDelete with correct id", () => {
    const onDelete = jest.fn();
    render(
      <TaskStepNode
        {...makeNodeProps({ onDelete, data: { ...makeNodeProps().data, onDelete } })}
      />
    );
    const deleteBtn = screen
      .getByRole("button")
      .closest("button");
    expect(deleteBtn).toBeInTheDocument();
    fireEvent.click(deleteBtn!);
    expect(onDelete).toHaveBeenCalledWith("step-0");
  });

  it("does not render delete button when onDelete is not provided", () => {
    render(<TaskStepNode {...makeNodeProps({ onDelete: undefined })} />);
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("selected state applies primary ring", () => {
    const { container } = render(
      <TaskStepNode {...makeNodeProps()} selected={true} />
    );
    const node = container.firstChild as HTMLElement;
    expect(node.className).toContain("ring-primary");
  });

  it("uses dark styles when resolvedTheme is dark", () => {
    mockResolvedTheme = "dark";
    const { container } = render(
      <TaskStepNode {...makeNodeProps({ subagent: "github" })} />
    );
    expect(container.firstChild).toBeInTheDocument();
    expect((container.firstChild as HTMLElement).className).toContain("950");
  });

  it("uses light styles when resolvedTheme is light", () => {
    mockResolvedTheme = "light";
    const { container } = render(
      <TaskStepNode {...makeNodeProps({ subagent: "github" })} />
    );
    expect(container.firstChild).toBeInTheDocument();
    expect((container.firstChild as HTMLElement).className).toContain("50");
  });

  it("handles unknown subagent with default Custom style", () => {
    render(<TaskStepNode {...makeNodeProps({ subagent: "unknown-agent" })} />);
    expect(screen.getByText("Custom")).toBeInTheDocument();
  });
});
