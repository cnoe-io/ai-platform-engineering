import { getCollection } from "@/lib/mongodb";
import {
  deleteExactOpenFgaTuples,
  readOpenFgaTuples,
  writeOpenFgaTuples,
} from "@/lib/rbac/openfga";
import {
  grantTomeAdminByEmail,
  listDirectTomeAdmins,
  revokeDirectTomeAdmin,
} from "@/lib/rbac/tome-admin-members";

jest.mock("@/lib/mongodb", () => ({
  getCollection: jest.fn(),
}));

jest.mock("@/lib/rbac/openfga", () => ({
  deleteExactOpenFgaTuples: jest.fn(),
  readOpenFgaTuples: jest.fn(),
  writeOpenFgaTuples: jest.fn(),
}));

const mockGetCollection = getCollection as jest.MockedFunction<typeof getCollection>;
const mockReadTuples = readOpenFgaTuples as jest.MockedFunction<typeof readOpenFgaTuples>;
const mockWriteTuples = writeOpenFgaTuples as jest.MockedFunction<typeof writeOpenFgaTuples>;
const mockDeleteTuples =
  deleteExactOpenFgaTuples as jest.MockedFunction<typeof deleteExactOpenFgaTuples>;

function mockUsersCollection(options?: {
  records?: Array<Record<string, unknown>>;
  found?: Record<string, unknown> | null;
}) {
  const toArray = jest.fn().mockResolvedValue(options?.records ?? []);
  const project = jest.fn().mockReturnValue({ toArray });
  const find = jest.fn().mockReturnValue({ project });
  const findOne = jest.fn().mockResolvedValue(options?.found ?? null);
  mockGetCollection.mockResolvedValue({ find, findOne } as never);
  return { find, findOne };
}

describe("Tome admin members", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockReadTuples.mockResolvedValue({ tuples: [] });
    mockWriteTuples.mockResolvedValue({ enabled: true, writes: 1, deletes: 0 });
    mockDeleteTuples.mockResolvedValue({ enabled: true, writes: 0, deletes: 1 });
  });

  it("lists only direct user manager grants and resolves their profiles", async () => {
    mockReadTuples.mockResolvedValue({
      tuples: [
        {
          key: {
            user: "user:alice-sub",
            relation: "manager",
            object: "admin_surface:tome",
          },
        },
        {
          key: {
            user: "organization:caipe#admin",
            relation: "manager",
            object: "admin_surface:tome",
          },
        },
        {
          key: {
            user: "user:bootstrap-without-profile",
            relation: "manager",
            object: "admin_surface:tome",
          },
        },
      ],
    });
    mockUsersCollection({
      records: [
        {
          email: "alice@example.com",
          name: "Alice",
          keycloak_sub: "alice-sub",
          metadata: {},
        },
      ],
    });

    await expect(listDirectTomeAdmins()).resolves.toEqual([
      {
        subject: "alice-sub",
        email: "alice@example.com",
        name: "Alice",
        avatar_url: null,
      },
    ]);
  });

  it("grants the base manager relation for an existing user", async () => {
    mockUsersCollection({
      found: {
        email: "alice@example.com",
        name: "Alice",
        keycloak_sub: "alice-sub",
        metadata: {},
      },
    });

    await grantTomeAdminByEmail("Alice@Example.com");

    expect(mockWriteTuples).toHaveBeenCalledWith({
      writes: [
        {
          user: "user:alice-sub",
          relation: "manager",
          object: "admin_surface:tome",
        },
      ],
      deletes: [],
    });
  });

  it("blocks self-removal", async () => {
    await expect(revokeDirectTomeAdmin("alice-sub", "alice-sub")).rejects.toThrow(
      "cannot remove your own",
    );
    expect(mockDeleteTuples).not.toHaveBeenCalled();
  });

  it("removes an exact direct grant while another direct admin remains", async () => {
    mockReadTuples.mockResolvedValue({
      tuples: [
        {
          key: {
            user: "user:alice-sub",
            relation: "manager",
            object: "admin_surface:tome",
          },
        },
        {
          key: {
            user: "user:bob-sub",
            relation: "manager",
            object: "admin_surface:tome",
          },
        },
      ],
    });

    await revokeDirectTomeAdmin("bob-sub", "alice-sub");

    expect(mockDeleteTuples).toHaveBeenCalledWith([
      {
        user: "user:bob-sub",
        relation: "manager",
        object: "admin_surface:tome",
      },
    ]);
  });
});
