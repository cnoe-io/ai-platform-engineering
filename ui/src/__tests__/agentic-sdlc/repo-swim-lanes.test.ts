import { _internal } from "@/components/agentic-sdlc/RepoSwimLanes";
import type { AgenticSdlcStage, ArtifactKindStored } from "@/types/agentic-sdlc";

function item(overrides: {
  id: string;
  title: string;
  stage: AgenticSdlcStage;
  agentName?: string | null;
  actorKind?: "agent" | "human" | "system";
  escalationLabels?: string[];
}) {
  return {
    artifact_id: overrides.id,
    kind: "subtask" as ArtifactKindStored,
    title: overrides.title,
    current_stage: overrides.stage,
    actor_kind: overrides.actorKind ?? "agent",
    agent_label: overrides.agentName
      ? `agent:${overrides.agentName.toLowerCase().replace(" ", "-")}`
      : null,
    agent_name: overrides.agentName ?? null,
    status_label: null,
    escalation_labels: overrides.escalationLabels ?? [],
    github_url: "https://github.com/acme/repo/issues/1",
    last_event_at: "2026-05-11T00:00:00.000Z",
  };
}

describe("RepoSwimLanes persona board grouping", () => {
  it("groups expanded modal items by agent persona with human escalation fallback", () => {
    const columns = _internal.buildAgentPersonaColumns([
      {
        stage: "plan",
        items: [
          item({
            id: "a1",
            title: "Architecture plan",
            stage: "plan",
            agentName: "Architect",
          }),
          item({
            id: "d1",
            title: "Deep analysis",
            stage: "plan",
            agentName: "Deep Think",
          }),
        ],
      },
      {
        stage: "implement",
        items: [
          item({
            id: "c1",
            title: "Implement API",
            stage: "implement",
            agentName: "Coder",
          }),
          item({
            id: "h1",
            title: "Needs access",
            stage: "blocked",
            agentName: "Coder",
            escalationLabels: ["needs:repo-access"],
          }),
        ],
      },
      {
        stage: "review_hitl",
        items: [
          item({
            id: "r1",
            title: "Review PR",
            stage: "review_hitl",
            agentName: "Reviewer",
          }),
        ],
      },
    ]);

    expect(
      columns.find((column) => column.id === "architect")?.items.map((x) => x.title),
    ).toEqual(["Architecture plan"]);
    expect(
      columns.find((column) => column.id === "deep-think")?.items.map((x) => x.title),
    ).toEqual(["Deep analysis"]);
    expect(
      columns.find((column) => column.id === "coder")?.items.map((x) => x.title),
    ).toEqual(["Implement API"]);
    expect(
      columns.find((column) => column.id === "reviewer")?.items.map((x) => x.title),
    ).toEqual(["Review PR"]);
    expect(
      columns.find((column) => column.id === "human")?.items.map((x) => x.title),
    ).toEqual(["Needs access"]);
  });
});
