/**
 * @jest-environment node
 */

const mockCollection = {
  find: jest.fn(),
  updateOne: jest.fn(),
};

const mockGetCollection = jest.fn(async () => mockCollection);

jest.mock("@/lib/mongodb", () => ({
  isMongoDBConfigured: true,
  getCollection: (...args: unknown[]) => mockGetCollection(...args),
}));

import { relinkPinnedMcpCredentialSources } from "../relink-pinned-mcp-credentials";

describe("relinkPinnedMcpCredentialSources", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("updates pinned MCP credential_sources that reference superseded connection ids", async () => {
    mockCollection.updateOne.mockResolvedValue({ modifiedCount: 1 });
    mockCollection.find.mockReturnValue({
      toArray: async () => [
        {
          _id: "confluence",
          credential_sources: [
            {
              kind: "provider_connection",
              target: "header",
              name: "X-CAIPE-Provider-Token",
              connection_scope: "pinned",
              provider_connection_id: "conn-old",
            },
          ],
        },
      ],
    });

    const updated = await relinkPinnedMcpCredentialSources({
      owner: { type: "user", id: "alice-sub" },
      supersededConnectionIds: ["conn-old"],
      newConnectionId: "conn-new",
    });

    expect(updated).toBe(1);
    expect(mockGetCollection).toHaveBeenCalledWith("mcp_servers");
    expect(mockCollection.updateOne).toHaveBeenCalledWith(
      { _id: "confluence" },
      expect.objectContaining({
        $set: expect.objectContaining({
          credential_sources: [
            expect.objectContaining({
              connection_scope: "pinned",
              provider_connection_id: "conn-new",
            }),
          ],
        }),
      }),
    );
  });
});
