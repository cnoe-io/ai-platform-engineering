import {
  filterConversationsByImplicitOrExplicitPermission,
  isImplicitConversationOwner,
  requireConversationResourcePermission,
} from "../conversation-implicit-authz";

jest.mock("../resource-authz", () => ({
  filterResourcesByPermission: jest.fn(async (_session, resources) =>
    resources.filter((resource: { _id: string }) => resource._id === "shared"),
  ),
  requireResourcePermission: jest.fn(async () => undefined),
}));

const { filterResourcesByPermission, requireResourcePermission } = jest.requireMock("../resource-authz") as {
  filterResourcesByPermission: jest.Mock;
  requireResourcePermission: jest.Mock;
};

describe("conversation implicit authorization", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("treats owner_subject and legacy owner_id as implicit ownership", () => {
    expect(
      isImplicitConversationOwner(
        { sub: "alice-sub" },
        "other@example.com",
        { owner_id: "legacy@example.com", owner_subject: "alice-sub" },
      ),
    ).toBe(true);
    expect(
      isImplicitConversationOwner(
        {},
        "legacy@example.com",
        { owner_id: "legacy@example.com", owner_subject: undefined },
      ),
    ).toBe(true);
  });

  it("skips OpenFGA checks for implicit owners and checks shared candidates", async () => {
    const visible = await filterConversationsByImplicitOrExplicitPermission(
      { sub: "alice-sub" },
      "legacy@example.com",
      [
        { _id: "owned-sub", owner_id: "other@example.com", owner_subject: "alice-sub" } as any,
        { _id: "owned-email", owner_id: "legacy@example.com" } as any,
        { _id: "shared", owner_id: "carol@example.com" } as any,
        { _id: "denied", owner_id: "dave@example.com" } as any,
      ],
    );

    expect(visible.map((conversation) => conversation._id)).toEqual(["owned-sub", "owned-email", "shared"]);
    expect(filterResourcesByPermission).toHaveBeenCalledWith(
      { sub: "alice-sub" },
      [
        { _id: "shared", owner_id: "carol@example.com" },
        { _id: "denied", owner_id: "dave@example.com" },
      ],
      expect.objectContaining({
        type: "conversation",
        action: "discover",
      }),
      { bypassForOrgAdmin: true },
    );
  });

  it("requires OpenFGA only when caller is not the implicit owner", async () => {
    await requireConversationResourcePermission(
      { sub: "alice-sub" },
      "alice@example.com",
      { _id: "owned", owner_id: "alice@example.com" } as any,
      "write",
    );
    expect(requireResourcePermission).not.toHaveBeenCalled();

    await requireConversationResourcePermission(
      { sub: "bob-sub" },
      "bob@example.com",
      { _id: "shared", owner_id: "alice@example.com" } as any,
      "write",
    );
    expect(requireResourcePermission).toHaveBeenCalledWith(
      { sub: "bob-sub" },
      { type: "conversation", id: "shared", action: "write" },
      { bypassForOrgAdmin: true },
    );
  });
});
