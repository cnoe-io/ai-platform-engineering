import React from "react";
import { fireEvent,render,screen,waitFor } from "@testing-library/react";

jest.mock("@/components/ui/tooltip", () => ({
  TooltipProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  Tooltip: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  TooltipTrigger: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  TooltipContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

import { AgentPicker,AgentSelector } from "../AgentSelector";

const availableAgents = [
  {
    _id: "legacy-agent",
    name: "Legacy Agent",
    description: "Existing Dynamic Agent",
    enabled: true,
  },
  {
    _id: "provider-agent",
    name: "Provider Agent",
    description: "Harness Engine agent",
    enabled: true,
    execution_harness_id: "agentcore",
  },
];

beforeEach(() => {
  global.fetch = jest.fn().mockResolvedValue({
    ok: true,
    json: async () => ({ success: true,data: availableAgents }),
  } as Response);
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("AgentPicker", () => {
  it("shows legacy Dynamic Agents and Harness Engine agents in one picker", async () => {
    const onSelectAgent = jest.fn();
    render(
      <AgentPicker
        selectedAgentId="legacy-agent"
        onSelectAgent={onSelectAgent}
      />,
    );

    const trigger = await screen.findByRole("button", {
      name: "Choose agent. Current agent: Legacy Agent",
    });
    expect(screen.getByLabelText("Execution harness: LangChain Deep Agents")).toBeInTheDocument();

    fireEvent.click(trigger);

    expect(screen.getByText("Choose an agent")).toBeInTheDocument();
    expect(screen.getByText("Existing Dynamic Agent")).toBeInTheDocument();
    expect(screen.getByText("Harness Engine agent")).toBeInTheDocument();
    expect(screen.getAllByLabelText("Execution harness: LangChain Deep Agents")).toHaveLength(2);
    expect(screen.getByLabelText("Execution harness: Amazon Bedrock AgentCore")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /Provider Agent/ }));
    expect(onSelectAgent).toHaveBeenCalledWith("provider-agent");
  });

  it("preserves the AgentSelector export used by existing chat surfaces", async () => {
    render(<AgentSelector onSelectAgent={jest.fn()} />);

    await waitFor(() => {
      expect(
        screen.getByRole("button", {
          name: "Choose agent. Current agent: Legacy Agent",
        }),
      ).toBeInTheDocument();
    });
  });
});
