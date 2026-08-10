import { render, screen, waitFor } from "@testing-library/react";

import type { StreamEvent } from "@/lib/streaming/types";
import type { WfStepRun } from "@/store/workflow-exec-store";
import { WorkflowStepTimeline } from "../WorkflowStepTimeline";

jest.mock("@/components/chat/DynamicAgentTimeline", () => ({
  AgentTimeline: ({ data }: { data: { finalAnswer: string | null } }) => (
    <div data-testid="agent-timeline">{data.finalAnswer}</div>
  ),
}));

jest.mock("@/components/chat/MetadataInputForm", () => ({
  MetadataInputForm: () => null,
}));

jest.mock("@/components/chat/ToolApprovalCard", () => ({
  ToolApprovalCard: () => null,
}));

jest.mock("@/components/dynamic-agents/AgentAvatar", () => ({
  AgentAvatar: () => <span data-testid="agent-avatar" />,
}));

jest.mock("@/components/shared/timeline", () => ({
  MarkdownRenderer: ({ content }: { content: string }) => (
    <div data-testid="markdown-renderer">{content}</div>
  ),
}));

jest.mock("@/components/ui/tooltip", () => ({
  Tooltip: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  TooltipContent: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  TooltipTrigger: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

const baseStep: WfStepRun = {
  type: "step",
  index: 0,
  display_text: "Do the work",
  agent_id: "agent-1",
  status: "completed",
  prompt_sent: "prompt",
  response: "RAW TOOL RESULT",
  started_at: "2026-06-29T10:00:00.000Z",
  completed_at: "2026-06-29T10:00:02.000Z",
  attempts: 1,
  error: null,
  interrupt: null,
};

const contentEvent: StreamEvent = {
  id: "event-1",
  timestamp: new Date("2026-06-29T10:00:01.000Z"),
  type: "content",
  raw: {},
  namespace: [],
  content: "Clean streamed answer",
};

describe("WorkflowStepTimeline", () => {
  it("does not render stored step.response before the timeline when stream events exist", async () => {
    render(
      <WorkflowStepTimeline
        step={baseStep}
        events={[contentEvent]}
        isActive={false}
        agentInfo={{ name: "Agent One" }}
      />,
    );

    expect(screen.queryByTestId("workflow-step-response")).not.toBeInTheDocument();

    await waitFor(() => {
      expect(screen.getByTestId("agent-timeline")).toHaveTextContent("Clean streamed answer");
    });
  });

  it("renders stored step.response as a markdown fallback when no stream events exist", () => {
    render(
      <WorkflowStepTimeline
        step={{ ...baseStep, response: "Fallback **answer**" }}
        events={[]}
        isActive={false}
        agentInfo={{ name: "Agent One" }}
      />,
    );

    expect(screen.getByTestId("workflow-step-response")).toBeInTheDocument();
    expect(screen.getByTestId("markdown-renderer")).toHaveTextContent("Fallback **answer**");
    expect(screen.queryByTestId("agent-timeline")).not.toBeInTheDocument();
  });
});
