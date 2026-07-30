jest.mock("@/lib/projects/onboarding-providers", () => ({
  collectForwardedCredentials: jest.fn(),
}));
jest.mock("../bhag", () => ({
  resolveAreaChildren: jest.fn(),
  resolveBhagChildren: jest.fn(),
}));
jest.mock("../access", () => ({
  listReadableTomeProjects: jest.fn(),
}));
jest.mock("../data-steward", () => ({
  tomeSessionSubject: jest.fn(),
}));
jest.mock("../page-store", () => ({
  getPageStore: jest.fn(),
}));

import { buildSnapshotFromProject } from "../agent-proxy";
import type { ProjectDocument, ProjectType } from "@/types/projects";

function synthesizedProject(type: ProjectType): ProjectDocument & { _id: string } {
  return {
    _id: `${type}-id`,
    type,
    slug: `${type}-example`,
    name: `${type} example`,
    title: `${type} example`,
    description: "Example synthesis",
    team_id: "team-id",
    team_slug: "example-team",
    team_name: "Example team",
    owner_id: "test-user@example.com",
    member_ids: [],
    domain: "example",
    labels: {},
    tags: [],
    status: "active",
    catalog: {} as ProjectDocument["catalog"],
    components: [],
    onboarding: {},
    integrations: {},
    sources: {
      repos: ["example/repository"],
      confluence_url: "https://example.atlassian.net/wiki/spaces/EXAMPLE",
      webex_rooms: [
        {
          slug: "example-room",
          name: "Example room",
          room_id: "room-id",
        },
      ],
    },
    source: "manual",
    created_at: new Date(),
    updated_at: new Date(),
  };
}

describe.each(["bhag", "area"] as const)(
  "buildSnapshotFromProject(%s)",
  (type) => {
    it("preserves directly attached sources for synthesis", () => {
      const snapshot = buildSnapshotFromProject(synthesizedProject(type));

      expect(snapshot.repos).toEqual([
        {
          slug: "repository",
          url: "https://github.com/example/repository",
          default_branch: "main",
        },
      ]);
      expect(snapshot.confluence_spaces).toEqual([
        {
          slug: "example",
          name: "EXAMPLE",
          space_key: "EXAMPLE",
          base_url: "https://example.atlassian.net",
        },
      ]);
      expect(snapshot.webex_rooms).toEqual([
        {
          slug: "example-room",
          name: "Example room",
          room_id: "room-id",
        },
      ]);
    });
  },
);

it("forwards a Confluence page-tree scope to the agent snapshot", () => {
  const project = synthesizedProject("project");
  project.sources = {
    ...project.sources,
    confluence_url:
      "https://example.atlassian.net/wiki/spaces/EXAMPLE/pages/123/Overview",
    confluence_page_scope: {
      page_id: "123",
      page_title: "Overview",
      space_key: "EXAMPLE",
      include_descendants: true,
    },
  };

  expect(buildSnapshotFromProject(project).confluence_spaces).toEqual([
    {
      slug: "example",
      name: "EXAMPLE",
      space_key: "EXAMPLE",
      base_url: "https://example.atlassian.net",
      root_page_id: "123",
      root_page_title: "Overview",
      include_descendants: true,
      page_scopes: [
        {
          page_id: "123",
          page_title: "Overview",
          include_descendants: true,
        },
      ],
    },
  ]);
});

it("forwards multiple Confluence page roots to one space snapshot", () => {
  const project = synthesizedProject("project");
  project.sources = {
    ...project.sources,
    confluence_url: "https://example.atlassian.net/wiki/spaces/EXAMPLE",
    confluence_page_scopes: [
      {
        page_id: "123",
        page_title: "Overview",
        space_key: "EXAMPLE",
        include_descendants: true,
      },
      {
        page_id: "456",
        page_title: "Runbook",
        space_key: "EXAMPLE",
        include_descendants: false,
      },
    ],
  };

  expect(buildSnapshotFromProject(project).confluence_spaces).toEqual([
    expect.objectContaining({
      slug: "example",
      page_scopes: [
        {
          page_id: "123",
          page_title: "Overview",
          include_descendants: true,
        },
        {
          page_id: "456",
          page_title: "Runbook",
          include_descendants: false,
        },
      ],
    }),
  ]);
});
