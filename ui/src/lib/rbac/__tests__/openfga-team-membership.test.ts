/**
 * @jest-environment node
 */

import {
  listUserTeamSlugs,
  __resetUserTeamCacheForTests,
} from "../openfga-team-membership";
import { listOpenFgaObjects } from "../openfga";

jest.mock("../openfga", () => ({
  listOpenFgaObjects: jest.fn(),
}));

const mockListOpenFgaObjects = listOpenFgaObjects as jest.MockedFunction<typeof listOpenFgaObjects>;

describe("listUserTeamSlugs", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    __resetUserTeamCacheForTests();
  });

  it("returns team slugs derived from openfga list-objects response", async () => {
    mockListOpenFgaObjects.mockResolvedValue({
      objects: ["team:platform", "team:eti-sre-admin"],
    });

    const slugs = await listUserTeamSlugs({ subject: "alice-sub" });

    expect(slugs).toEqual(["platform", "eti-sre-admin"]);
    expect(mockListOpenFgaObjects).toHaveBeenCalledWith({
      user: "user:alice-sub",
      relation: "member",
      type: "team",
    });
  });

  it("returns empty array when user has no team memberships", async () => {
    mockListOpenFgaObjects.mockResolvedValue({ objects: [] });
    const slugs = await listUserTeamSlugs({ subject: "alice-sub" });
    expect(slugs).toEqual([]);
  });

  it("filters out malformed entries that do not match team:<slug> shape", async () => {
    mockListOpenFgaObjects.mockResolvedValue({
      objects: ["team:platform", "weird", "team:", "team:eti-sre-admin"],
    });
    const slugs = await listUserTeamSlugs({ subject: "alice-sub" });
    expect(slugs).toEqual(["platform", "eti-sre-admin"]);
  });

  it("caches results per user for repeat calls within the TTL window", async () => {
    mockListOpenFgaObjects.mockResolvedValue({ objects: ["team:platform"] });

    const first = await listUserTeamSlugs({ subject: "alice-sub" });
    const second = await listUserTeamSlugs({ subject: "alice-sub" });

    expect(first).toEqual(["platform"]);
    expect(second).toEqual(["platform"]);
    expect(mockListOpenFgaObjects).toHaveBeenCalledTimes(1);
  });

  it("re-queries openfga for distinct subjects", async () => {
    mockListOpenFgaObjects
      .mockResolvedValueOnce({ objects: ["team:platform"] })
      .mockResolvedValueOnce({ objects: ["team:eti-sre-admin"] });

    const aliceTeams = await listUserTeamSlugs({ subject: "alice-sub" });
    const bobTeams = await listUserTeamSlugs({ subject: "bob-sub" });

    expect(aliceTeams).toEqual(["platform"]);
    expect(bobTeams).toEqual(["eti-sre-admin"]);
    expect(mockListOpenFgaObjects).toHaveBeenCalledTimes(2);
  });

  it("expires the cache after the configured TTL", async () => {
    jest.useFakeTimers();
    try {
      mockListOpenFgaObjects
        .mockResolvedValueOnce({ objects: ["team:platform"] })
        .mockResolvedValueOnce({ objects: ["team:platform", "team:eti-sre-admin"] });

      const first = await listUserTeamSlugs({ subject: "alice-sub" });
      expect(first).toEqual(["platform"]);

      // Advance just past the 60s TTL.
      jest.advanceTimersByTime(60_001);

      const second = await listUserTeamSlugs({ subject: "alice-sub" });
      expect(second).toEqual(["platform", "eti-sre-admin"]);
      expect(mockListOpenFgaObjects).toHaveBeenCalledTimes(2);
    } finally {
      jest.useRealTimers();
    }
  });

  it("propagates underlying openfga errors so callers can fail closed", async () => {
    mockListOpenFgaObjects.mockRejectedValue(new Error("PDP down"));
    await expect(listUserTeamSlugs({ subject: "alice-sub" })).rejects.toThrow(
      /PDP down/,
    );
  });

  it("does not cache negative (error) results", async () => {
    mockListOpenFgaObjects
      .mockRejectedValueOnce(new Error("transient"))
      .mockResolvedValueOnce({ objects: ["team:platform"] });

    await expect(listUserTeamSlugs({ subject: "alice-sub" })).rejects.toThrow(
      /transient/,
    );

    const recovered = await listUserTeamSlugs({ subject: "alice-sub" });
    expect(recovered).toEqual(["platform"]);
    expect(mockListOpenFgaObjects).toHaveBeenCalledTimes(2);
  });

  it("validates the subject argument", async () => {
    await expect(listUserTeamSlugs({ subject: "" })).rejects.toThrow(
      /subject/i,
    );
    await expect(
      listUserTeamSlugs({ subject: "bad subject!" }),
    ).rejects.toThrow(/subject/i);
    expect(mockListOpenFgaObjects).not.toHaveBeenCalled();
  });
});
