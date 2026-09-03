const findOne = jest.fn();
const updateOne = jest.fn();
const insertOne = jest.fn();

jest.mock("@/lib/mongodb", () => ({
  getCollection: async () => ({ findOne, updateOne, insertOne }),
}));

import {
  claimWebexMeetingOwnerCheck,
  requestWebexMeetingOwnerCheck,
} from "../auto-ingest/cursor";

describe("Webex meeting owner scheduler cursor", () => {
  const now = new Date("2026-09-01T12:00:00Z");

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("does not claim a future user-level check", async () => {
    findOne.mockResolvedValue({
      _id: "cursor",
      next_webex_check_at: new Date("2026-09-02T12:00:00Z"),
    });

    await expect(
      claimWebexMeetingOwnerCheck(
        "owner-sub",
        "https://cisco.webex.com",
        now,
        new Date("2026-09-01T12:10:00Z"),
      ),
    ).resolves.toBe(false);
    expect(updateOne).not.toHaveBeenCalled();
  });

  it("claims a requested refresh without breaking the existing schedule", async () => {
    findOne.mockResolvedValue({
      _id: "cursor",
      next_webex_check_at: new Date("2026-09-02T12:00:00Z"),
      webex_refresh_requested_at: now,
    });
    updateOne.mockResolvedValue({ modifiedCount: 1 });

    await expect(
      claimWebexMeetingOwnerCheck(
        "owner-sub",
        "https://cisco.webex.com",
        now,
        new Date("2026-09-01T12:10:00Z"),
      ),
    ).resolves.toBe(true);
    expect(updateOne).toHaveBeenCalledWith(
      expect.objectContaining({ webex_refresh_requested_at: now }),
      expect.objectContaining({ $unset: { webex_refresh_requested_at: "" } }),
    );
  });

  it("records a user-requested fresh discovery", async () => {
    updateOne.mockResolvedValue({ modifiedCount: 1 });

    await requestWebexMeetingOwnerCheck("owner-sub", "https://cisco.webex.com", now);

    expect(updateOne).toHaveBeenCalledWith(
      expect.any(Object),
      expect.objectContaining({
        $set: expect.objectContaining({ webex_refresh_requested_at: now }),
      }),
      { upsert: true },
    );
  });
});
