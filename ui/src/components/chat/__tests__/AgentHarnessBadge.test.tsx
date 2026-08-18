import { render,screen } from "@testing-library/react";

import { AgentHarnessBadge } from "../AgentHarnessBadge";

describe("AgentHarnessBadge", () => {
  it("shows the selected provider harness", () => {
    render(<AgentHarnessBadge harnessId="agentcore" />);

    expect(screen.getByText("Amazon Bedrock AgentCore")).toBeInTheDocument();
    expect(
      screen.getByLabelText("Execution harness: Amazon Bedrock AgentCore"),
    ).toBeInTheDocument();
  });

  it("shows the default runtime for legacy agents", () => {
    render(<AgentHarnessBadge compact />);

    expect(screen.getByText("Deep Agents")).toBeInTheDocument();
    expect(
      screen.getByLabelText("Execution harness: LangChain Deep Agents"),
    ).toBeInTheDocument();
  });
});
