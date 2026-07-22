/**
 * @jest-environment node
 */

const mockFindOne = jest.fn();

jest.mock("@/lib/mongodb", () => ({
  getCollection: jest.fn(async () => ({ findOne: mockFindOne })),
}));

import {
  getResolvedPlatformDefaultAgentId,
  normalizePlatformDefaultAgentId,
  PLATFORM_CONFIG_ID,
} from "../platform-default-agent";

const originalDefaultAgentId = process.env.DEFAULT_AGENT_ID;

beforeEach(() => {
  jest.clearAllMocks();
  delete process.env.DEFAULT_AGENT_ID;
});

afterAll(() => {
  if (originalDefaultAgentId === undefined) delete process.env.DEFAULT_AGENT_ID;
  else process.env.DEFAULT_AGENT_ID = originalDefaultAgentId;
});

it("prefers the stored platform default", async () => {
  process.env.DEFAULT_AGENT_ID = "env-agent";
  mockFindOne.mockResolvedValue({ default_agent_id: "db-agent" });

  await expect(getResolvedPlatformDefaultAgentId()).resolves.toBe("db-agent");
  expect(mockFindOne).toHaveBeenCalledWith({ _id: PLATFORM_CONFIG_ID });
});

it("falls back to deployment configuration when the stored value is empty", async () => {
  process.env.DEFAULT_AGENT_ID = "env-agent";
  mockFindOne.mockResolvedValue({ default_agent_id: null });

  await expect(getResolvedPlatformDefaultAgentId()).resolves.toBe("env-agent");
});

it("normalizes valid values and rejects invalid values", () => {
  expect(normalizePlatformDefaultAgentId("  agent-1  ")).toBe("agent-1");
  expect(normalizePlatformDefaultAgentId(null)).toBeNull();
  expect(() => normalizePlatformDefaultAgentId("../agent")).toThrow(
    /valid/i,
  );
});
