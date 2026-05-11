import {
  buildDemoPlan,
  parseDemoArgs,
  runDemoPlan,
} from "../../../scripts/agentic-sdlc-real-repo-demo";

describe("agentic-sdlc-real-repo-demo", () => {
  it("defaults to dry-run against the reference repo", () => {
    expect(parseDemoArgs([])).toMatchObject({
      apply: false,
      repo: "cnoe-io/ai-platform-engineering",
    });
  });

  it("plans an Epic, child tasks, spec files, and a PR for the target repo", () => {
    const plan = buildDemoPlan({
      repo: "acme/widgets",
      runId: "test-run",
    });

    expect(plan.owner).toBe("acme");
    expect(plan.repo).toBe("widgets");
    expect(plan.labels).toEqual(
      expect.arrayContaining(["epic", "agent:specify", "agentic-sdlc:demo"]),
    );
    expect(plan.epic.title).toMatch(/Agentic SDLC demo/i);
    expect(plan.tasks).toHaveLength(3);
    expect(plan.files.map((file) => file.path)).toEqual(
      expect.arrayContaining([
        "docs/docs/specs/test-run/spec.md",
        "docs/docs/specs/test-run/tasks.md",
      ]),
    );
    expect(plan.pullRequest.title).toMatch(/agentic sdlc demo/i);
  });

  it("does not mutate GitHub unless --apply is used", async () => {
    const plan = buildDemoPlan({
      repo: "acme/widgets",
      runId: "dry-run",
    });
    const octokit = {
      issues: { create: jest.fn() },
      repos: { createOrUpdateFileContents: jest.fn() },
      pulls: { create: jest.fn() },
    };

    const result = await runDemoPlan({ plan, apply: false, octokit });

    expect(result.applied).toBe(false);
    expect(result.operations).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/create epic issue/i),
        expect.stringMatching(/create child task issues/i),
        expect.stringMatching(/create spec files/i),
        expect.stringMatching(/create pull request/i),
      ]),
    );
    expect(octokit.issues.create).not.toHaveBeenCalled();
    expect(octokit.repos.createOrUpdateFileContents).not.toHaveBeenCalled();
    expect(octokit.pulls.create).not.toHaveBeenCalled();
  });
});
