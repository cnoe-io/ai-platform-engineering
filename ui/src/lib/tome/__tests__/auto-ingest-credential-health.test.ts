const getCollection = jest.fn();
const listConnections = jest.fn();
const refreshConnection = jest.fn();
const getProviderConnectionService = jest.fn(async () => ({
  listConnections,
  refreshConnection,
}));

jest.mock("@/lib/mongodb", () => ({
  getCollection: (...args: unknown[]) => getCollection(...args),
}));
jest.mock("@/lib/credentials/oauth-service-factory", () => ({
  getProviderConnectionService: () => getProviderConnectionService(),
}));

import {
  AUTO_INGEST_CREDENTIAL_HEALTH_COLLECTION,
  getAutoIngestCredentialHealth,
  refreshAutoIngestCredentialHealth,
  requiredAutoIngestProviders,
} from "../auto-ingest/credential-health";
import type { ProjectDocument } from "@/types/projects";

const now = new Date("2026-08-13T18:00:00.000Z");
const owner = {
  subject: "owner-subject",
  email: "owner@example.test",
  name: "Example Owner",
  confirmedAt: "2026-08-01T00:00:00.000Z",
};

function project(
  id: string,
  overrides: Partial<ProjectDocument> = {},
): ProjectDocument & { _id: string } {
  return {
    _id: id,
    slug: `project-${id}`,
    title: `Project ${id}`,
    description: "",
    team_id: "team-id",
    team_slug: "example-team",
    team_name: "Example Team",
    owner_id: "project-owner",
    member_ids: [],
    domain: "example",
    tags: [],
    status: "active",
    catalog: {} as ProjectDocument["catalog"],
    components: [],
    onboarding: {},
    integrations: {},
    autoIngest: { enabled: true, cron: "0 * * * *", credentialOwner: owner },
    created_at: new Date(0),
    updated_at: new Date(0),
    ...overrides,
  } as ProjectDocument & { _id: string };
}

interface StoredHealth {
  _id: string;
  [key: string]: unknown;
}

function collections(projects: ProjectDocument[] = []) {
  const healthRows: StoredHealth[] = [];
  const healthCollection = {
    updateOne: jest.fn(async (filter, update) => {
      const existing = healthRows.find((row) => row._id === filter._id);
      if (existing) Object.assign(existing, update.$set);
      else healthRows.push({ ...update.$setOnInsert, ...update.$set });
      return { modifiedCount: existing ? 1 : 0 };
    }),
    deleteMany: jest.fn(async (filter) => {
      const active = new Set(filter._id.$nin);
      for (let index = healthRows.length - 1; index >= 0; index -= 1) {
        if (!active.has(healthRows[index]._id)) healthRows.splice(index, 1);
      }
      return { deletedCount: 0 };
    }),
    find: jest.fn(() => ({ toArray: async () => healthRows })),
  };
  const projectsCollection = {
    find: jest.fn(() => ({ toArray: async () => projects })),
  };
  getCollection.mockImplementation(async (name: string) =>
    name === AUTO_INGEST_CREDENTIAL_HEALTH_COLLECTION
      ? healthCollection
      : projectsCollection,
  );
  return { healthRows, healthCollection };
}

beforeEach(() => {
  jest.clearAllMocks();
  listConnections.mockResolvedValue([]);
  refreshConnection.mockResolvedValue({ accessToken: "never-returned", expiresIn: 3600 });
});

describe("requiredAutoIngestProviders", () => {
  it("maps configured sources to their credential providers without duplicates", () => {
    expect(
      requiredAutoIngestProviders(
        project("one", {
          sources: {
            repos: ["https://github.example.test/example/repository"],
            github_repos: [
              {
                full_name: "example/repository",
                html_url: "https://github.example.test/example/repository",
              },
            ],
            confluence_spaces: [{ slug: "example", space_key: "EX", name: "Example" }],
            webex_rooms: [{ slug: "example", name: "Example", room_id: "room-id" }],
          },
        }),
      ),
    ).toEqual(["github", "atlassian", "webex"]);
  });
});

describe("refreshAutoIngestCredentialHealth", () => {
  it("refreshes a shared owner's provider once and records healthy metadata without a token", async () => {
    const { healthRows } = collections();
    const projects = [
      project("one", {
        data_steward: { type: "team", id: "example-team", name: "Example Team" },
        sources: { github_repos: [{ full_name: "example/one", html_url: "https://example.test/one" }] },
      }),
      project("two", {
        sources: { repos: ["https://example.test/two"] },
      }),
    ];
    listConnections.mockResolvedValue([
      {
        id: "connection-id",
        connectorId: "connector-id",
        provider: "github",
        owner: { type: "user", id: owner.subject },
        status: "connected",
        renewable: true,
      },
    ]);

    await refreshAutoIngestCredentialHealth(now, projects);

    expect(listConnections).toHaveBeenCalledTimes(1);
    expect(refreshConnection).toHaveBeenCalledTimes(1);
    expect(healthRows).toEqual([
      expect.objectContaining({
        _id: `github:${owner.subject}`,
        status: "healthy",
        connection_id: "connection-id",
        owner_email: "owner@example.test",
      }),
    ]);
    expect(JSON.stringify(healthRows)).not.toContain("never-returned");
  });

  it("records missing, reauthentication, and refresh failures independently", async () => {
    const { healthRows } = collections();
    const projects = [
      project("one", {
        sources: {
          github_repos: [{ full_name: "example/one", html_url: "https://example.test/one" }],
          confluence_url: "https://example.atlassian.net/wiki/spaces/EX",
          webex_rooms: [{ slug: "example", name: "Example", room_id: "room-id" }],
        },
      }),
    ];
    listConnections.mockResolvedValue([
      {
        id: "github-id",
        connectorId: "github-connector",
        provider: "github",
        owner: { type: "user", id: owner.subject },
        status: "needs_reauth",
      },
      {
        id: "webex-id",
        connectorId: "webex-connector",
        provider: "webex",
        owner: { type: "user", id: owner.subject },
        status: "connected",
        renewable: true,
      },
    ]);
    refreshConnection.mockRejectedValue(new Error("provider unavailable"));

    await refreshAutoIngestCredentialHealth(now, projects);

    expect(healthRows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ _id: `github:${owner.subject}`, status: "needs_reauth" }),
        expect.objectContaining({ _id: `atlassian:${owner.subject}`, status: "missing" }),
        expect.objectContaining({ _id: `webex:${owner.subject}`, status: "refresh_failed" }),
      ]),
    );
  });

  it("classifies an expired token as expired even if the provider fallback returns it", async () => {
    const { healthRows } = collections();
    listConnections.mockResolvedValue([
      {
        id: "connection-id",
        connectorId: "connector-id",
        provider: "github",
        owner: { type: "user", id: owner.subject },
        status: "connected",
        renewable: true,
        expiresAt: new Date("2026-08-13T17:59:00.000Z"),
      },
    ]);
    refreshConnection.mockResolvedValue({ accessToken: "expired", expiresIn: 0 });

    await refreshAutoIngestCredentialHealth(now, [
      project("one", { sources: { repos: ["https://example.test/one"] } }),
    ]);

    expect(healthRows[0]).toEqual(expect.objectContaining({ status: "expired" }));
  });

  it("reports a rejected refresh grant while its fallback token is still usable", async () => {
    const { healthRows } = collections();
    listConnections.mockResolvedValue([
      {
        id: "connection-id",
        connectorId: "connector-id",
        provider: "github",
        owner: { type: "user", id: owner.subject },
        status: "connected",
        renewable: true,
        expiresAt: new Date("2026-08-13T18:04:00.000Z"),
      },
    ]);
    refreshConnection.mockResolvedValue({
      accessToken: "temporary-fallback",
      expiresIn: 240,
      refreshFailed: true,
    });

    await refreshAutoIngestCredentialHealth(now, [
      project("one", { sources: { repos: ["https://example.test/one"] } }),
    ]);

    expect(healthRows[0]).toEqual(expect.objectContaining({ status: "refresh_failed" }));
    expect(JSON.stringify(healthRows)).not.toContain("temporary-fallback");
  });
});

describe("getAutoIngestCredentialHealth", () => {
  it("shows team stewardship separately from the person whose token runs ingestion", async () => {
    const projects = [
      project("one", {
        data_steward: { type: "team", id: "example-team", name: "Example Team" },
        sources: { repos: ["https://example.test/one"] },
      }),
    ];
    const { healthRows } = collections(projects);
    healthRows.push({
      _id: `github:${owner.subject}`,
      owner_subject: owner.subject,
      provider: "github",
      status: "healthy",
      last_attempt_at: now,
      last_success_at: now,
    });

    const snapshot = await getAutoIngestCredentialHealth(300_000, now);

    expect(snapshot.rows[0]).toMatchObject({
      dataSteward: "Example Team",
      dataStewardType: "team",
      credentialOwner: { email: "owner@example.test" },
      provider: "github",
      status: "healthy",
    });
    expect(snapshot.summary).toEqual({ projects: 1, healthy: 1, attention: 0, missing: 0 });
  });

  it("surfaces missing credential owners and source-free schedules", async () => {
    collections([
      project("one", {
        autoIngest: { enabled: true, cron: "0 * * * *", credentialOwner: null },
        sources: { repos: ["https://example.test/one"] },
      }),
      project("two", { sources: {} }),
    ]);

    const snapshot = await getAutoIngestCredentialHealth(300_000, now);

    expect(snapshot.rows.map((row) => row.status)).toEqual(["no_owner", "no_sources"]);
    expect(snapshot.summary).toMatchObject({ projects: 2, missing: 1, attention: 1 });
  });
});
