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
