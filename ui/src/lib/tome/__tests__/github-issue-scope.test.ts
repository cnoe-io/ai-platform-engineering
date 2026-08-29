const mockGetCollection = jest.fn();
const mockResolveCredentialsForSub = jest.fn();

jest.mock("@/lib/mongodb", () => ({
  getCollection: (...args: unknown[]) => mockGetCollection(...args),
}));
jest.mock("@/lib/tome/access", () => ({
  filterReadableTomeProjects: jest.fn(),
}));
jest.mock("@/lib/tome/agent-proxy", () => ({
  resolveCredentialsForSub: (...args: unknown[]) =>
    mockResolveCredentialsForSub(...args),
  resolveForwardedCredentials: jest.fn(),
}));
jest.mock("@/lib/tome/data-steward", () => ({ tomeSessionSubject: jest.fn() }));

import {
  projectGitHubRepos,
  resolveTomeGitHubWriteCredential,
  selectTomeRollupProjects,
} from "@/lib/tome/github-issue-scope";
import type { TomeProjectContext } from "@/lib/tome/tome-api";
import type { ProjectDocument } from "@/types/projects";

function project(
  slug: string,
  options: Partial<ProjectDocument> = {},
): ProjectDocument & { _id: string } {
  return {
    _id: `${slug}-id`,
    slug,
    name: slug,
    title: slug,
    description: "",
    owner_id: "test-user",
    team_id: "primary",
    team_name: "Primary",
    team_slug: "primary",
    catalog: { entities: [] },
    components: [],
    onboarding: {},
    integrations: {},
    created_at: new Date("2026-01-01T00:00:00Z"),
    updated_at: new Date("2026-01-01T00:00:00Z"),
    ...options,
  } as ProjectDocument & { _id: string };
}

describe("github-issue-scope", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("prefers canonical repository metadata and normalizes legacy URLs", () => {
    expect(
      projectGitHubRepos(
        project("example", {
          sources: {
            github_repos: [
              {
                id: 42,
                full_name: "example/service",
                html_url: "https://github.com/example/service",
              },
            ],
            repos: ["https://github.com/stale/name"],
          },
        }),
      ),
    ).toEqual(["example/service"]);
    expect(
      projectGitHubRepos(
        project("legacy", {
          sources: { repos: ["https://github.com/example/legacy"] },
        }),
      ),
    ).toEqual(["example/legacy"]);
  });

  it("rolls an Area up to its tagged readable child projects", () => {
    const area = project("platform", { type: "area" });
    const child = project("service", { labels: { areas: ["platform"] } });
    const unrelated = project("other");
    expect(
      selectTomeRollupProjects(area, [area, child, unrelated]).map(
        (item) => item.slug,
      ),
    ).toEqual(["platform", "service"]);
  });

  it("rolls a BHAG through Areas and directly tagged projects", () => {
    const bhag = project("initiative", { type: "bhag" });
    const area = project("platform", {
      type: "area",
      labels: { initiatives: ["initiative"] },
    });
    const areaChild = project("service", { labels: { areas: ["platform"] } });
    const direct = project("direct", {
      labels: { initiatives: ["initiative"] },
    });
    expect(
      selectTomeRollupProjects(bhag, [bhag, area, areaChild, direct]).map(
        (item) => item.slug,
      ),
    ).toEqual(["initiative", "platform", "service", "direct"]);
  });

  it("resolves issue writes only from the assigned data steward", async () => {
    mockGetCollection.mockResolvedValue({
      findOne: jest.fn().mockResolvedValue({ keycloak_sub: "steward-sub" }),
    });
    mockResolveCredentialsForSub.mockResolvedValue({
      github: { access_token: "steward-token" },
    });
    const ctx = {
      project: project("example", {
        data_steward: {
          type: "user",
          id: "steward-sub",
          name: "Test Steward",
          email: "steward@example.test",
        },
      }),
    } as TomeProjectContext;

    await expect(resolveTomeGitHubWriteCredential(ctx)).resolves.toEqual({
      token: "steward-token",
      source: "data_steward",
      ownerEmail: "steward@example.test",
    });
    expect(mockResolveCredentialsForSub).toHaveBeenCalledWith("steward-sub");
  });
});
