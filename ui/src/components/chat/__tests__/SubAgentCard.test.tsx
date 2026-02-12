/**
 * Unit tests for SubAgentCard component
 *
 * Tests:
 * - Renders agent name
 * - Collapse/expand functionality
 * - Displays content when expanded
 * - Hides content when collapsed
 * - Shows tool count or notifications
 * - Handles click to toggle
 * - isRealSubAgent, groupEventsByAgent, getAgentDisplayOrder
 */

import React from "react";
import { render, screen, fireEvent } from "@testing-library/react";

// ============================================================================
// Mocks — must be before imports
// ============================================================================

jest.mock("react-markdown", () => {
  return function MockReactMarkdown({ children }: { children?: React.ReactNode }) {
    return <div data-testid="markdown">{children}</div>;
  };
});
jest.mock("remark-gfm", () => () => {});

jest.mock("@/components/shared/AgentLogos", () => ({
  AgentLogo: ({ agent }: { agent: string }) => (
    <div data-testid={`agent-logo-${agent}`}>{agent}</div>
  ),
}));

jest.mock("@/lib/utils", () => ({
  cn: (...args: unknown[]) => args.filter(Boolean).join(" "),
}));

// ============================================================================
// Imports — after mocks
// ============================================================================

import {
  SubAgentCard,
  isRealSubAgent,
  groupEventsByAgent,
  getAgentDisplayOrder,
} from "../SubAgentCard";
import type { A2AEvent } from "@/types/a2a";

// ============================================================================
// Helpers
// ============================================================================

function createEvent(
  content: string,
  agent = "argocd",
  type: A2AEvent["type"] = "artifact"
): A2AEvent {
  return {
    id: `evt-${Math.random()}`,
    timestamp: new Date(),
    type,
    raw: {} as A2AEvent["raw"],
    displayName: "Test",
    displayContent: content,
    color: "#000",
    icon: "icon",
    sourceAgent: agent,
  };
}

// ============================================================================
// Tests — SubAgentCard
// ============================================================================

describe("SubAgentCard", () => {
  it("renders agent name", () => {
    const events = [
      createEvent("Hello from ArgoCD", "argocd"),
    ];
    render(<SubAgentCard agentName="argocd" events={events} />);
    expect(screen.getByText("Argo CD Agent")).toBeInTheDocument();
  });

  it("shows collapse/expand functionality", () => {
    const events = [createEvent("Content here", "github")];
    render(<SubAgentCard agentName="github" events={events} />);
    expect(screen.getByText("Content here")).toBeInTheDocument();
    fireEvent.click(screen.getByText("GitHub Agent"));
    expect(screen.queryByText("Content here")).not.toBeInTheDocument();
  });

  it("displays content when expanded", () => {
    const events = [createEvent("Expanded content", "jira")];
    render(<SubAgentCard agentName="jira" events={events} />);
    expect(screen.getByText("Expanded content")).toBeInTheDocument();
  });

  it("hides content when collapsed", () => {
    const events = [createEvent("Hidden content", "aws")];
    render(<SubAgentCard agentName="aws" events={events} />);
    fireEvent.click(screen.getByText("AWS Agent"));
    expect(screen.queryByText("Hidden content")).not.toBeInTheDocument();
  });

  it("shows streaming status when isStreaming", () => {
    // Use only artifact events (no tool_start/tool_end) so latestStatus = "streaming"
    const events = [createEvent("Result", "argocd", "artifact")];
    render(<SubAgentCard agentName="argocd" events={events} isStreaming />);
    expect(screen.getByText("Argo CD Agent")).toBeInTheDocument();
    expect(screen.getByText("Streaming raw output")).toBeInTheDocument();
  });

  it("handles click to toggle", () => {
    const events = [createEvent("Toggle me", "rag")];
    render(<SubAgentCard agentName="rag" events={events} />);
    const header = screen.getByText("RAG Agent").closest("div");
    expect(header).toBeInTheDocument();
    fireEvent.click(header!);
    expect(screen.queryByText("Toggle me")).not.toBeInTheDocument();
    fireEvent.click(screen.getByText("RAG Agent").closest("div")!);
    expect(screen.getByText("Toggle me")).toBeInTheDocument();
  });

  it("returns null when no content and not streaming", () => {
    const events = [
      createEvent("", "argocd", "tool_start"),
      createEvent("", "argocd", "tool_end"),
    ];
    const { container } = render(
      <SubAgentCard agentName="argocd" events={events} />
    );
    expect(container.firstChild).toBeNull();
  });

  it("shows streaming placeholder when streaming with no content", () => {
    const events: A2AEvent[] = [];
    render(
      <SubAgentCard agentName="argocd" events={events} isStreaming />
    );
    expect(screen.getByText("Waiting for response...")).toBeInTheDocument();
  });

  it("shows copy button when content exists", () => {
    const events = [createEvent("Copyable content", "github")];
    render(<SubAgentCard agentName="github" events={events} />);
    const copyBtn = screen.getByTitle("Copy response");
    expect(copyBtn).toBeInTheDocument();
  });

  it("displays unknown agent with formatted name", () => {
    const events = [createEvent("From custom agent", "customagent")];
    render(<SubAgentCard agentName="customagent" events={events} />);
    expect(screen.getByText("Customagent Agent")).toBeInTheDocument();
  });
});

// ============================================================================
// Tests — isRealSubAgent, groupEventsByAgent, getAgentDisplayOrder
// ============================================================================

describe("SubAgentCard utilities", () => {
  it("isRealSubAgent excludes write_todos", () => {
    expect(isRealSubAgent("write_todos")).toBe(false);
  });

  it("isRealSubAgent includes argocd", () => {
    expect(isRealSubAgent("argocd")).toBe(true);
  });

  it("groupEventsByAgent groups by sourceAgent", () => {
    const events: A2AEvent[] = [
      createEvent("a", "argocd"),
      createEvent("b", "argocd"),
      createEvent("c", "github"),
    ];
    const groups = groupEventsByAgent(events);
    expect(groups.get("argocd")).toHaveLength(2);
    expect(groups.get("github")).toHaveLength(1);
  });

  it("getAgentDisplayOrder returns real sub-agents only", () => {
    const events: A2AEvent[] = [
      createEvent("a", "argocd"),
      createEvent("b", "write_todos"),
      createEvent("c", "github"),
    ];
    const order = getAgentDisplayOrder(events);
    expect(order).toContain("argocd");
    expect(order).toContain("github");
    expect(order).not.toContain("write_todos");
  });
});
