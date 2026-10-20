import { fireEvent,render,screen } from "@testing-library/react";

import { AgentHarnessBadge } from "../AgentHarnessBadge";

describe("AgentHarnessBadge", () => {
  it.each([
    ["dynamic_agents", "LangChain Deep Agents", "deepagents.svg"],
    ["agentcore", "Amazon Bedrock AgentCore", "agentcore.svg"],
    ["claude_agent_sdk", "Claude Agent SDK", "claude.svg"],
  ])("shows a logo and names %s in its tooltip", async (harnessId, label, asset) => {
    render(<AgentHarnessBadge harnessId={harnessId} />);
    const logo = screen.getByRole("img", { name: `Execution harness: ${label}` });
    expect(logo.querySelector("img")).toHaveAttribute("src", `/provider-logos/${asset}`);
    expect(screen.queryByText(label)).not.toBeInTheDocument();
    fireEvent.mouseEnter(logo);
    expect(await screen.findByRole("tooltip")).toHaveTextContent(`Execution harness: ${label}`);
  });

  it("shows the default runtime for legacy agents", () => {
    render(<AgentHarnessBadge compact />);

    const logo = screen.getByRole("img", { name: "Execution harness: LangChain Deep Agents" });
    expect(logo.querySelector("img")).toHaveAttribute("src", "/provider-logos/deepagents.svg");
    expect(logo).toHaveClass("h-4", "w-4");
  });

  it("keeps custom harnesses identifiable without using another provider's logo", async () => {
    render(<AgentHarnessBadge harnessId="example_harness" className="ml-auto" />);
    const logo = screen.getByRole("img", { name: "Execution harness: example_harness" });
    expect(logo.querySelector("img")).toBeNull();
    expect(logo.querySelector("svg")).toBeInTheDocument();
    expect(logo.parentElement).toHaveClass("ml-auto");
    fireEvent.mouseEnter(logo);
    expect(await screen.findByRole("tooltip")).toHaveTextContent("Execution harness: example_harness");
  });
});
