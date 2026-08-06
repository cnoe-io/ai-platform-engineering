jest.mock("@/lib/mongodb", () => ({ getCollection: jest.fn() }));
jest.mock("../page-store", () => ({ getPageStore: jest.fn() }));

import {
  obsoleteRepoPagePaths,
  reconcileGitHubSourcesForIngest,
  resolveCanonicalGitHubSources,
  type ReconciliationDependencies,
} from "../github-source-reconciliation";
import type { ProjectDocument } from "@/types/projects";

function project(): ProjectDocument & { _id: string } {
  return {
    _id: "project-id",
    type: "area",
    slug: "example-area",
    name: "Example Area",
    title: "Example Area",
    description: "Example description",
    team_id: "team-id",
    team_slug: "example-team",
    team_name: "Example Team",
    owner_id: "test-user",
    member_ids: [],
    domain: "example",
    tags: [],
    status: "active",
    catalog: {} as ProjectDocument["catalog"],
    components: [],
    onboarding: {},
    integrations: {},
    sources: {
      repos: ["https://github.com/example/old-repository"],
      github_repos: [
        {
          id: 42,
          full_name: "example/old-repository",
          html_url: "https://github.com/example/old-repository",
          default_branch: "main",
        },
      ],
    },
    created_at: new Date(),
    updated_at: new Date(),
  };
}

function githubResponse(): Response {
  return {
    ok: true,
    status: 200,
    json: async () => ({
      id: 42,
      node_id: "repository-node",
      full_name: "example/renamed-repository",
      html_url: "https://github.com/example/renamed-repository",
      default_branch: "trunk",
    }),
  } as Response;
}

it("resolves a renamed repository by stable GitHub ID", async () => {
  const fetchImpl = jest.fn(async () => githubResponse()) as jest.MockedFunction<
    typeof fetch
  >;

  await expect(
    resolveCanonicalGitHubSources(
      project().sources!.github_repos!,
      "github-token",
      fetchImpl,
    ),
  ).resolves.toEqual([
    {
      id: 42,
      node_id: "repository-node",
      full_name: "example/renamed-repository",
      html_url: "https://github.com/example/renamed-repository",
      default_branch: "trunk",
    },
  ]);
  expect(fetchImpl).toHaveBeenCalledWith(
    "https://api.github.com/repositories/42",
    expect.objectContaining({ redirect: "follow" }),
  );
});

it("persists canonical metadata and tombstones only obsolete repo pages", async () => {
  const deletePage = jest.fn(async () => undefined);
  const persistSources = jest.fn(async () => undefined);
  const dependencies: ReconciliationDependencies = {
    fetchImpl: jest.fn(async () => githubResponse()) as jest.MockedFunction<
      typeof fetch
    >,
    listPages: jest.fn(async () => ({
      "charter.md": "human charter",
      "repos/old-repository/overview.md": "stale",
      "repos/old-repository/activity.md": "stale",
      "repos/renamed-repository/overview.md": "current",
    })),
    deletePage,
    persistSources,
  };

  const result = await reconcileGitHubSourcesForIngest(
    project(),
    { github: { access_token: "github-token" } },
    dependencies,
  );

  expect(result.canonicalized).toEqual([
    { from: "example/old-repository", to: "example/renamed-repository" },
  ]);
  expect(result.tombstonedPaths).toEqual([
    "repos/old-repository/activity.md",
    "repos/old-repository/overview.md",
  ]);
  expect(deletePage.mock.calls).toEqual([
    ["project-id", "repos/old-repository/activity.md"],
    ["project-id", "repos/old-repository/overview.md"],
  ]);
  expect(persistSources).toHaveBeenCalledWith(
    "project-id",
    expect.objectContaining({
      repos: ["https://github.com/example/renamed-repository"],
      github_repos: [
        expect.objectContaining({
          id: 42,
          full_name: "example/renamed-repository",
          default_branch: "trunk",
        }),
      ],
    }),
  );
  expect(result.project.sources?.github_repos?.[0].id).toBe(42);
});

it("does not classify non-repo or canonical repo pages as obsolete", () => {
  expect(
    obsoleteRepoPagePaths(
      {
        "charter.md": "charter",
        "repos/current/overview.md": "current",
        "repos/removed/overview.md": "removed",
      },
      [
        {
          id: 1,
          full_name: "example/current",
          html_url: "https://github.com/example/current",
        },
      ],
    ),
  ).toEqual(["repos/removed/overview.md"]);
});

it("tombstones every repo page after the last GitHub source is removed", async () => {
  const removedProject = project();
  removedProject.sources = { repos: [], github_repos: [] };
  const deletePage = jest.fn(async () => undefined);
  const persistSources = jest.fn(async () => undefined);
  const dependencies: ReconciliationDependencies = {
    fetchImpl: jest.fn() as jest.MockedFunction<typeof fetch>,
    listPages: jest.fn(async () => ({
      "charter.md": "human charter",
      "repos/removed/overview.md": "stale",
    })),
    deletePage,
    persistSources,
  };

  const result = await reconcileGitHubSourcesForIngest(
    removedProject,
    {},
    dependencies,
  );

  expect(dependencies.fetchImpl).not.toHaveBeenCalled();
  expect(deletePage).toHaveBeenCalledWith(
    "project-id",
    "repos/removed/overview.md",
  );
  expect(persistSources).toHaveBeenCalledWith(
    "project-id",
    expect.objectContaining({ github_repos: [], repos: [] }),
  );
  expect(result.tombstonedPaths).toEqual(["repos/removed/overview.md"]);
});

it("fails clearly when GitHub cannot resolve a configured source", async () => {
  const fetchImpl = jest.fn(
    async () => ({ ok: false, status: 404 }) as Response,
  ) as jest.MockedFunction<typeof fetch>;

  await expect(
    resolveCanonicalGitHubSources(
      project().sources!.github_repos!,
      "github-token",
      fetchImpl,
    ),
  ).rejects.toThrow("stale wiki content was not treated as current");
});
