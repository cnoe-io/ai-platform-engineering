// assisted-by Codex Codex-sonnet-4-6

import { fireEvent, render, screen, waitFor } from "@testing-library/react";

import { AgentTimeline } from "../DynamicAgentTimeline";
import type { TimelineData } from "@/types/dynamic-agent-timeline";

jest.mock("@/components/shared/timeline", () => ({
  CollapsibleSection: ({ children }: { children: React.ReactNode }) => <section>{children}</section>,
  MarkdownRenderer: ({ content }: { content: string }) => <div>{content}</div>,
  TaskList: () => null,
}));

jest.mock("@/components/dynamic-agents/AgentAvatar", () => ({
  AgentAvatar: () => <span data-testid="agent-avatar" />,
}));

jest.mock("@/components/dynamic-agents/FileTree", () => ({
  FileTree: () => null,
}));

jest.mock("../WorkflowRunCard", () => ({
  WorkflowRunCard: () => null,
}));

function renderTimeline(data: TimelineData) {
  return render(
    <AgentTimeline
      data={data}
      files={[]}
      tasks={[]}
      isLatestMessage={true}
    />,
  );
}

describe("AgentTimeline", () => {
  it("keeps completed turns with warnings expanded until the user collapses them", async () => {
    const data: TimelineData = {
      isStreaming: false,
      hasTools: true,
      finalAnswer: "Ready now.",
      segments: [
        {
          type: "warning",
          id: "warning-1",
          message: "MCP server is starting up and not ready yet.",
        },
        {
          type: "status",
          id: "status-1",
          status: "done",
        },
      ],
    };

    renderTimeline(data);

    const toggle = screen.getByRole("button", { name: /view execution details/i });
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByText(/MCP server is starting up/i)).toBeInTheDocument();

    fireEvent.click(toggle);

    await waitFor(() => {
      expect(toggle).toHaveAttribute("aria-expanded", "false");
    });
  });
});
