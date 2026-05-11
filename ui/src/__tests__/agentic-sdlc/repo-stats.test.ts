jest.mock("@/lib/agentic-sdlc/mongo-collections", () => ({
  getAgenticSdlcArtifactsCollection: jest.fn(),
  getAgenticSdlcEventsCollection: jest.fn(),
}));

import { _internal } from "@/lib/agentic-sdlc/repo-stats";

describe("repo-stats agent persona helpers", () => {
  it.each([
    [["agent:architect"], "Architect", "agent:architect"],
    [["agent:deep-think"], "Deep Think", "agent:deep-think"],
    [["agent:coder"], "Coder", "agent:coder"],
    [["agent:reviewer"], "Reviewer", "agent:reviewer"],
    [["agent:tester"], "Tester", "agent:tester"],
    [["agent:deployer"], "Deployer", "agent:deployer"],
  ])("derives %s persona labels for swim lanes", (labels, name, label) => {
    expect(_internal.deriveAgentPersona(labels)).toEqual({
      agent_label: label,
      agent_name: name,
    });
  });

  it("prefers higher-level owner labels over generic legacy agent labels", () => {
    expect(
      _internal.deriveAgentPersona(["agent:tasks", "agent:deep-think"]),
    ).toEqual({
      agent_label: "agent:deep-think",
      agent_name: "Deep Think",
    });
  });
});
