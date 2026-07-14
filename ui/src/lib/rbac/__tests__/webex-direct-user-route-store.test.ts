const deleteMany = jest.fn(async () => ({ deletedCount: 0 }));
const updateOne = jest.fn(async () => ({ upsertedCount: 1 }));
const deleteOne = jest.fn(async () => ({ deletedCount: 1 }));
const toArray = jest.fn(async () => []);
const sort = jest.fn(() => ({ toArray }));
const find = jest.fn(() => ({ sort }));

jest.mock("../mongo-collections", () => ({
  getRbacCollection: jest.fn(async () => ({
    deleteMany,
    updateOne,
    deleteOne,
    find,
  })),
}));

import {
  deleteWebexDirectUserRoute,
  listWebexDirectUserRoutes,
  upsertWebexDirectUserRoute,
} from "../webex-direct-user-route-store";

describe("Webex direct-user route ownership", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    process.env.WEBEX_DEPLOYMENT_ID = "deployment-a";
  });

  it("uses independent resource keys for the same user on different bots", async () => {
    const common = {
      keycloakUserId: "user-1",
      userEmail: "user@example.com",
      expectedWebexEmail: "user@example.com",
      agentId: "agent-1",
      actor: "admin@example.com",
    };

    await upsertWebexDirectUserRoute({ ...common, botId: "primary" });
    await upsertWebexDirectUserRoute({ ...common, botId: "secondary" });

    expect(updateOne).toHaveBeenCalledTimes(2);
    expect(updateOne.mock.calls[0][0]).toEqual({ _id: '["deployment-a","primary","user-1"]' });
    expect(updateOne.mock.calls[1][0]).toEqual({ _id: '["deployment-a","secondary","user-1"]' });
    expect(updateOne.mock.calls[0][1].$set.bot_id).toBe("primary");
    expect(updateOne.mock.calls[1][1].$set.bot_id).toBe("secondary");
  });

  it("deletes legacy records instead of reading or migrating them", async () => {
    await listWebexDirectUserRoutes("primary");

    expect(deleteMany).toHaveBeenCalledWith({
      deployment_id: "deployment-a",
      ownership_schema_version: { $ne: 3 },
    });
    expect(find).toHaveBeenCalledWith({
      deployment_id: "deployment-a",
      ownership_schema_version: 3,
      bot_id: "primary",
    });
  });

  it("deletes only the selected bot route for a deployment user", async () => {
    await deleteWebexDirectUserRoute("secondary", "user-1");

    expect(deleteOne).toHaveBeenCalledWith({
      _id: '["deployment-a","secondary","user-1"]',
    });
  });
});
