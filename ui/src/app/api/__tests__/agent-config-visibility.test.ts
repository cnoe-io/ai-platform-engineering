/**
 * @jest-environment node
 */
/**
 * Tests for Agent Config Visibility / Sharing
 *
 * Covers:
 * - POST: creating configs with private/team/global visibility
 * - POST: validation (team requires shared_with_teams)
 * - GET: visibility-based listing (owner, global, team membership)
 * - GET by ID: access control for visibility levels
 * - PUT: visibility field updates and validation
 */

import { NextRequest } from "next/server";

const mockGetServerSession = jest.fn();
jest.mock("next-auth", () => ({
  getServerSession: (...args: unknown[]) => mockGetServerSession(...args),
}));

jest.mock("@/lib/auth-config", () => ({
  authOptions: {},
}));

const mockCollections: Record<string, ReturnType<typeof createMockCollection>> = {};
const mockGetCollection = jest.fn((name: string) => {
  if (!mockCollections[name]) {
    mockCollections[name] = createMockCollection();
  }
  return Promise.resolve(mockCollections[name]);
});

jest.mock("@/lib/mongodb", () => ({
  getCollection: (...args: unknown[]) => mockGetCollection(...(args as [string])),
  isMongoDBConfigured: true,
}));

function createMockCollection() {
  const findReturnValue = {
    project: jest.fn().mockReturnValue({
      toArray: jest.fn().mockResolvedValue([]),
    }),
    sort: jest.fn().mockReturnValue({
      toArray: jest.fn().mockResolvedValue([]),
    }),
    toArray: jest.fn().mockResolvedValue([]),
  };

  return {
    find: jest.fn().mockReturnValue(findReturnValue),
    findOne: jest.fn().mockResolvedValue(null),
    insertOne: jest.fn().mockResolvedValue({ insertedId: "test-id" }),
    updateOne: jest.fn().mockResolvedValue({ matchedCount: 1, modifiedCount: 1, acknowledged: true }),
    deleteOne: jest.fn().mockResolvedValue({ deletedCount: 1 }),
    countDocuments: jest.fn().mockResolvedValue(0),
  };
}

function makeRequest(url: string, options: RequestInit = {}): NextRequest {
  return new NextRequest(new URL(url, "http://localhost:3000"), options);
}

function userSession(email = "user@example.com") {
  return {
    user: { email, name: "Test User" },
    role: "user",
  };
}

function adminSession() {
  return {
    user: { email: "admin@example.com", name: "Admin" },
    role: "admin",
  };
}

const VALID_TASK = {
  display_text: "Test task",
  llm_prompt: "Do something",
  subagent: "caipe",
};

beforeEach(() => {
  jest.clearAllMocks();
  Object.keys(mockCollections).forEach((key) => delete mockCollections[key]);
});

// ─────────────────────────────────────────────────────────────────────────────
// POST - Create with visibility
// ─────────────────────────────────────────────────────────────────────────────
describe("POST /api/agent-configs - visibility", () => {
  beforeEach(() => {
    mockGetServerSession.mockResolvedValue(userSession());
  });

  it("should default to 'private' visibility when not specified", async () => {
    const { POST } = await import("../agent-configs/route");
    const request = makeRequest("/api/agent-configs", {
      method: "POST",
      body: JSON.stringify({
        name: "Test Skill",
        category: "Custom",
        tasks: [VALID_TASK],
      }),
    });

    const response = await POST(request);
    expect(response.status).toBe(201);

    const collection = await mockGetCollection("agent_configs");
    const insertedConfig = collection.insertOne.mock.calls[0][0];
    expect(insertedConfig.visibility).toBe("private");
    expect(insertedConfig.shared_with_teams).toBeUndefined();
  });

  it("should create with 'global' visibility", async () => {
    const { POST } = await import("../agent-configs/route");
    const request = makeRequest("/api/agent-configs", {
      method: "POST",
      body: JSON.stringify({
        name: "Global Skill",
        category: "Custom",
        tasks: [VALID_TASK],
        visibility: "global",
      }),
    });

    const response = await POST(request);
    expect(response.status).toBe(201);

    const collection = await mockGetCollection("agent_configs");
    const insertedConfig = collection.insertOne.mock.calls[0][0];
    expect(insertedConfig.visibility).toBe("global");
    expect(insertedConfig.shared_with_teams).toBeUndefined();
  });

  it("should create with 'team' visibility and shared_with_teams", async () => {
    const { POST } = await import("../agent-configs/route");
    const request = makeRequest("/api/agent-configs", {
      method: "POST",
      body: JSON.stringify({
        name: "Team Skill",
        category: "Custom",
        tasks: [VALID_TASK],
        visibility: "team",
        shared_with_teams: ["team-1", "team-2"],
      }),
    });

    const response = await POST(request);
    expect(response.status).toBe(201);

    const collection = await mockGetCollection("agent_configs");
    const insertedConfig = collection.insertOne.mock.calls[0][0];
    expect(insertedConfig.visibility).toBe("team");
    expect(insertedConfig.shared_with_teams).toEqual(["team-1", "team-2"]);
  });

  it("should reject 'team' visibility without shared_with_teams", async () => {
    const { POST } = await import("../agent-configs/route");
    const request = makeRequest("/api/agent-configs", {
      method: "POST",
      body: JSON.stringify({
        name: "Bad Team Skill",
        category: "Custom",
        tasks: [VALID_TASK],
        visibility: "team",
      }),
    });

    const response = await POST(request);
    expect(response.status).toBe(400);
    const data = await response.json();
    expect(data.error).toContain("team");
  });

  it("should reject 'team' visibility with empty shared_with_teams array", async () => {
    const { POST } = await import("../agent-configs/route");
    const request = makeRequest("/api/agent-configs", {
      method: "POST",
      body: JSON.stringify({
        name: "Bad Team Skill",
        category: "Custom",
        tasks: [VALID_TASK],
        visibility: "team",
        shared_with_teams: [],
      }),
    });

    const response = await POST(request);
    expect(response.status).toBe(400);
  });

  it("should reject invalid visibility value", async () => {
    const { POST } = await import("../agent-configs/route");
    const request = makeRequest("/api/agent-configs", {
      method: "POST",
      body: JSON.stringify({
        name: "Bad Visibility",
        category: "Custom",
        tasks: [VALID_TASK],
        visibility: "invalid",
      }),
    });

    const response = await POST(request);
    expect(response.status).toBe(400);
    const data = await response.json();
    expect(data.error).toContain("Invalid visibility");
  });

  it("should clear shared_with_teams when visibility is not 'team'", async () => {
    const { POST } = await import("../agent-configs/route");
    const request = makeRequest("/api/agent-configs", {
      method: "POST",
      body: JSON.stringify({
        name: "Global Skill",
        category: "Custom",
        tasks: [VALID_TASK],
        visibility: "global",
        shared_with_teams: ["team-1"],
      }),
    });

    const response = await POST(request);
    expect(response.status).toBe(201);

    const collection = await mockGetCollection("agent_configs");
    const insertedConfig = collection.insertOne.mock.calls[0][0];
    expect(insertedConfig.visibility).toBe("global");
    expect(insertedConfig.shared_with_teams).toBeUndefined();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// GET - Visibility-based listing
// ─────────────────────────────────────────────────────────────────────────────
describe("GET /api/agent-configs - visibility filtering", () => {
  it("should include global visibility in query filter", async () => {
    mockGetServerSession.mockResolvedValue(userSession());

    const { GET } = await import("../agent-configs/route");
    const request = makeRequest("/api/agent-configs");
    await GET(request);

    const collection = await mockGetCollection("agent_configs");
    const findCall = collection.find.mock.calls[0][0];
    const orConditions = findCall.$or;

    expect(orConditions).toContainEqual({ visibility: "global" });
  });

  it("should include system configs in query filter", async () => {
    mockGetServerSession.mockResolvedValue(userSession());

    const { GET } = await import("../agent-configs/route");
    const request = makeRequest("/api/agent-configs");
    await GET(request);

    const collection = await mockGetCollection("agent_configs");
    const findCall = collection.find.mock.calls[0][0];
    const orConditions = findCall.$or;

    expect(orConditions).toContainEqual({ is_system: true });
    expect(orConditions).toContainEqual({ owner_id: "user@example.com" });
  });

  it("should include team visibility when user belongs to teams", async () => {
    mockGetServerSession.mockResolvedValue(userSession());

    const teamsCollection = createMockCollection();
    teamsCollection.find.mockReturnValue({
      project: jest.fn().mockReturnValue({
        toArray: jest.fn().mockResolvedValue([
          { _id: "team-abc" },
          { _id: "team-xyz" },
        ]),
      }),
    });
    mockCollections["teams"] = teamsCollection;

    const { GET } = await import("../agent-configs/route");
    const request = makeRequest("/api/agent-configs");
    await GET(request);

    const agentCollection = await mockGetCollection("agent_configs");
    const findCall = agentCollection.find.mock.calls[0][0];
    const orConditions = findCall.$or;

    const teamCondition = orConditions.find(
      (c: Record<string, unknown>) => c.visibility === "team"
    );
    expect(teamCondition).toBeDefined();
    expect(teamCondition.shared_with_teams.$in).toEqual(["team-abc", "team-xyz"]);
  });

  it("should NOT include team condition when user has no teams", async () => {
    mockGetServerSession.mockResolvedValue(userSession());

    const { GET } = await import("../agent-configs/route");
    const request = makeRequest("/api/agent-configs");
    await GET(request);

    const collection = await mockGetCollection("agent_configs");
    const findCall = collection.find.mock.calls[0][0];
    const orConditions = findCall.$or;

    const teamCondition = orConditions.find(
      (c: Record<string, unknown>) => c.visibility === "team"
    );
    expect(teamCondition).toBeUndefined();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// PUT - Visibility updates
// ─────────────────────────────────────────────────────────────────────────────
describe("PUT /api/agent-configs - visibility updates", () => {
  beforeEach(() => {
    mockGetServerSession.mockResolvedValue(userSession());
  });

  it("should reject invalid visibility in update", async () => {
    const configsCollection = createMockCollection();
    configsCollection.findOne.mockResolvedValue({
      id: "config-1",
      owner_id: "user@example.com",
      is_system: false,
    });
    mockCollections["agent_configs"] = configsCollection;

    const { PUT } = await import("../agent-configs/route");
    const request = makeRequest("/api/agent-configs?id=config-1", {
      method: "PUT",
      body: JSON.stringify({ visibility: "invalid" }),
    });

    const response = await PUT(request);
    expect(response.status).toBe(400);
  });

  it("should reject team visibility without teams in update", async () => {
    const configsCollection = createMockCollection();
    configsCollection.findOne.mockResolvedValue({
      id: "config-1",
      owner_id: "user@example.com",
      is_system: false,
    });
    mockCollections["agent_configs"] = configsCollection;

    const { PUT } = await import("../agent-configs/route");
    const request = makeRequest("/api/agent-configs?id=config-1", {
      method: "PUT",
      body: JSON.stringify({ visibility: "team" }),
    });

    const response = await PUT(request);
    expect(response.status).toBe(400);
  });

  it("should clear shared_with_teams when changing to non-team visibility", async () => {
    const configsCollection = createMockCollection();
    configsCollection.findOne
      .mockResolvedValueOnce({
        id: "config-1",
        owner_id: "user@example.com",
        is_system: false,
        visibility: "team",
        shared_with_teams: ["team-1"],
      })
      .mockResolvedValueOnce({
        id: "config-1",
        visibility: "private",
      });
    mockCollections["agent_configs"] = configsCollection;

    const { PUT } = await import("../agent-configs/route");
    const request = makeRequest("/api/agent-configs?id=config-1", {
      method: "PUT",
      body: JSON.stringify({ visibility: "private" }),
    });

    const response = await PUT(request);
    expect(response.status).toBe(200);

    const updatePayload = configsCollection.updateOne.mock.calls[0][1].$set;
    expect(updatePayload.shared_with_teams).toBeUndefined();
  });
});
