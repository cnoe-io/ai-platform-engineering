/**
 * @jest-environment node
 *
 * #50 registry-wiring guard (reviewer-b finding): the team-tool-wildcard
 * migration's deletes are USERSET tuples (`team:<slug>#member` caller tool:…).
 * They MUST route through deleteExactOpenFgaTuples — NOT writeOpenFgaTuples,
 * whose read-back `/check` filter can't resolve a userset as the `user` and
 * would silently drop the deletes, orphaning the legacy `_*` tuples. The module
 * tests inject a mock writeTuples, so this gap lives only in the registry
 * apply-branch wiring — exercised here.
 */

const mockGetCollection = jest.fn();
const mockReadOpenFgaTuples = jest.fn();
const mockWriteOpenFgaTuples = jest.fn();
const mockDeleteExactOpenFgaTuples = jest.fn();

jest.mock("@/lib/mongodb", () => ({
  connectToDatabase: jest.fn(),
  getCollection: (...args: unknown[]) => mockGetCollection(...args),
}));
jest.mock("@/lib/rbac/openfga", () => ({
  readOpenFgaTuples: (...args: unknown[]) => mockReadOpenFgaTuples(...args),
  writeOpenFgaTuples: (...args: unknown[]) => mockWriteOpenFgaTuples(...args),
  deleteExactOpenFgaTuples: (...args: unknown[]) => mockDeleteExactOpenFgaTuples(...args),
}));

import { applyMigration } from "../registry";
import { TEAM_TOOL_WILDCARD_SLASH_CONFIRMATION } from "../team-tool-wildcard-slash";

/** A fake Mongo collection capturing updateOne calls. */
function fakeCollection(docs: Array<Record<string, unknown>> = []) {
  return {
    find: () => ({ toArray: async () => docs }),
    updateOne: jest.fn().mockResolvedValue({}),
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  mockWriteOpenFgaTuples.mockResolvedValue({ enabled: true, writes: 1, deletes: 0 });
  mockDeleteExactOpenFgaTuples.mockResolvedValue({ enabled: true, writes: 0, deletes: 1 });
});

it("routes USERSET deletes through deleteExactOpenFgaTuples, not writeOpenFgaTuples (#50)", async () => {
  // One team with a legacy underscore-wildcard tool grant in Mongo…
  const teamsCollection = fakeCollection([
    { _id: "team-sre", slug: "team-sre", resources: { tools: ["knowledge-base_*"] } },
  ]);
  // recordCompletedMigration also calls getCollection for schema_migrations +
  // data_schema_versions — hand back disposable fakes for those.
  mockGetCollection.mockImplementation((name: string) =>
    name === "teams" ? teamsCollection : fakeCollection(),
  );
  // …and the matching OpenFGA userset tuple to migrate.
  mockReadOpenFgaTuples.mockResolvedValue({
    tuples: [
      {
        key: {
          user: "team:team-sre#member",
          relation: "caller",
          object: "tool:knowledge-base_*",
        },
      },
    ],
    continuationToken: undefined,
  });

  await applyMigration({
    migrationId: "team_tool_wildcard_slash_v1",
    actor: "admin@example.com",
    confirmation: TEAM_TOOL_WILDCARD_SLASH_CONFIRMATION,
    now: "2026-06-08T00:00:00.000Z",
  });

  // The NEW slash tuple is written with NO deletes in the write call…
  expect(mockWriteOpenFgaTuples).toHaveBeenCalledTimes(1);
  const writeArg = mockWriteOpenFgaTuples.mock.calls[0][0];
  expect(writeArg.deletes).toEqual([]);
  expect(writeArg.writes).toEqual([
    { user: "team:team-sre#member", relation: "caller", object: "tool:knowledge-base/*" },
  ]);

  // …and the OLD underscore userset tuple is deleted via the exact-delete path.
  expect(mockDeleteExactOpenFgaTuples).toHaveBeenCalledTimes(1);
  expect(mockDeleteExactOpenFgaTuples.mock.calls[0][0]).toEqual([
    { user: "team:team-sre#member", relation: "caller", object: "tool:knowledge-base_*" },
  ]);

  // Mongo half rewritten too.
  expect(teamsCollection.updateOne).toHaveBeenCalledWith(
    { _id: "team-sre" },
    expect.objectContaining({
      $set: expect.objectContaining({ "resources.tools": ["knowledge-base/*"] }),
    }),
  );
});
