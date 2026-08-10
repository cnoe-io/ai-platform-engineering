jest.mock("@/lib/mongodb", () => ({ getCollection: jest.fn() }));

import { getCollection } from "@/lib/mongodb";
import { listResourceTypeDefinitions } from "../resource-model";
import { listRebacCatalog } from "../resource-catalog";

const mockGetCollection = getCollection as jest.Mock;

function collection(rows: unknown[]) {
  return {
    find: jest.fn(() => ({
      sort: jest.fn(() => ({
        limit: jest.fn(() => ({
          toArray: jest.fn(async () => rows),
        })),
      })),
    })),
  };
}

describe("ReBAC resource catalog", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetCollection.mockImplementation(async (name: string) => {
      if (name === "channel_team_mappings") {
        return collection([
          {
            slack_workspace_id: "T123",
            slack_channel_id: "C123",
            channel_name: "#incidents",
          },
        ]);
      }
      if (name === "webex_space_team_mappings") {
        return collection([
          {
            workspace_id: "WEBEX",
            space_id: "space-1",
            space_name: "War Room",
          },
          {
            webex_workspace_id: "Cisco",
            webex_space_id: "space-2",
            space_name: "Grid Test",
          },
        ]);
      }
      if (name === "conversations") {
        return collection([
          { _id: "conversation-1", title: "Customer Escalation" },
          { _id: "conversation-2", title: "Deploy Planning" },
        ]);
      }
      return collection([]);
    });
  });

  it("includes Webex resource definitions and OpenFGA-normalized messaging IDs", async () => {
    const resourceTypes = listResourceTypeDefinitions().map((definition) => definition.type);
    expect(resourceTypes).toEqual(expect.arrayContaining(["webex_workspace", "webex_space"]));

    const catalog = await listRebacCatalog();

    expect(catalog.resources).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: "slack_channel", id: "T123--C123" }),
        expect.objectContaining({ type: "webex_workspace", id: "WEBEX" }),
        expect.objectContaining({ type: "webex_space", id: "WEBEX--space-1" }),
        expect.objectContaining({ type: "webex_workspace", id: "Cisco" }),
        expect.objectContaining({
          type: "webex_space",
          id: "Cisco--space-2",
          display_name: "Grid Test",
        }),
      ]),
    );
    expect(catalog.resources).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ type: "webex_space", id: "Cisco--Grid Test" })]),
    );
  });

  it("does not seed the placeholder current-user resource that has no ReBAC relationships", async () => {
    const catalog = await listRebacCatalog();

    expect(catalog.resources).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: "user", id: "current-user" }),
        expect.objectContaining({ type: "user_profile", id: "current-user" }),
      ]),
    );
  });

  it("collapses conversation catalog entries to the typed wildcard", async () => {
    const catalog = await listRebacCatalog();

    expect(catalog.resources).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "conversation",
          id: "*",
          display_name: "All conversations",
        }),
      ]),
    );
    expect(catalog.resources).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: "conversation", id: "conversation-1" }),
        expect.objectContaining({ type: "conversation", id: "conversation-2" }),
      ]),
    );
  });
});
