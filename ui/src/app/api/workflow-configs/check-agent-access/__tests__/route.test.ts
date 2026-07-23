/**
 * @jest-environment node
 */

import { NextRequest } from "next/server";

const mockCheckOpenFgaTuple = jest.fn();
const mockGetCollection = jest.fn();

jest.mock("@/lib/api-middleware", () => ({
  withAuth: async (
    _request: NextRequest,
    handler: () => Promise<Response>,
  ): Promise<Response> => handler(),
}));

jest.mock("@/lib/rbac/openfga", () => ({
  checkOpenFgaTuple: (...args: unknown[]) => mockCheckOpenFgaTuple(...args),
}));

jest.mock("@/lib/mongodb", () => ({
  getCollection: (...args: unknown[]) => mockGetCollection(...args),
}));

import { POST } from "../route";

interface CheckTuple {
  user: string;
  relation: string;
  object: string;
}

function makeRequest(): NextRequest {
  return new NextRequest("http://localhost/api/workflow-configs/check-agent-access", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      visibility: "team",
      shared_with_teams: ["example-team"],
      steps: [{ type: "step", agent_id: "example-agent" }],
    }),
  });
}

describe("POST /api/workflow-configs/check-agent-access", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetCollection.mockResolvedValue({
      find: jest.fn().mockReturnValue({
        toArray: jest.fn().mockResolvedValue([
          { _id: "example-agent", name: "Example agent" },
        ]),
      }),
    });
  });

  it("does not report a team gap when the agent has global access", async () => {
    mockCheckOpenFgaTuple.mockImplementation(async (tuple: CheckTuple) => ({
      allowed: tuple.user === "user:*",
    }));

    const response = await POST(makeRequest());

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ gaps: [] });
    expect(mockCheckOpenFgaTuple).toHaveBeenCalledWith({
      user: "user:*",
      relation: "user",
      object: "agent:example-agent",
    });
    expect(mockCheckOpenFgaTuple).not.toHaveBeenCalledWith({
      user: "team:example-team#member",
      relation: "user",
      object: "agent:example-agent",
    });
  });

  it("falls back to the explicit team grant when the agent is not global", async () => {
    mockCheckOpenFgaTuple.mockImplementation(async (tuple: CheckTuple) => ({
      allowed: tuple.user === "team:example-team#member",
    }));

    const response = await POST(makeRequest());

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ gaps: [] });
    expect(mockCheckOpenFgaTuple).toHaveBeenNthCalledWith(1, {
      user: "user:*",
      relation: "user",
      object: "agent:example-agent",
    });
    expect(mockCheckOpenFgaTuple).toHaveBeenNthCalledWith(2, {
      user: "team:example-team#member",
      relation: "user",
      object: "agent:example-agent",
    });
  });
});
