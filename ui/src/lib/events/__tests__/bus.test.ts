/** @jest-environment node */

const mockInsertOne = jest.fn();
const mockUpdateOne = jest.fn();
const mockKick = jest.fn();

jest.mock("@/lib/mongodb", () => ({
  getCollection: jest.fn(async (name: string) =>
    name === "caipe_events"
      ? { insertOne: (...args: unknown[]) => mockInsertOne(...args) }
      : { updateOne: (...args: unknown[]) => mockUpdateOne(...args) },
  ),
}));
jest.mock("@/lib/events/subscribers", () => ({
  caipeEventSubscribers: [
    {
      id: "test.subscriber.v1",
      matches: (event: { type: string }) => event.type.startsWith("github.issues."),
      handle: jest.fn(),
    },
  ],
}));
jest.mock("@/lib/events/worker", () => ({
  kickCaipeEventWorker: () => mockKick(),
}));

import { publishCaipeEvent } from "@/lib/events/bus";

const event = {
  _id: "github:delivery-1",
  specversion: "1.0" as const,
  source: "github",
  type: "github.issues.edited",
  subject: "example/service#42",
  time: new Date("2026-08-27T00:00:00Z"),
  received_at: new Date("2026-08-27T00:00:01Z"),
  data: { repository_full_name: "example/service" },
};

describe("CAIPE event bus", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockInsertOne.mockResolvedValue({ acknowledged: true });
    mockUpdateOne.mockResolvedValue({ acknowledged: true });
  });

  it("durably creates an idempotent delivery for each matching subscriber", async () => {
    await expect(publishCaipeEvent(event)).resolves.toEqual({
      duplicate: false,
      subscribers: ["test.subscriber.v1"],
    });

    expect(mockInsertOne).toHaveBeenCalledWith({
      ...event,
      expires_at: expect.any(Date),
    });
    expect(mockUpdateOne).toHaveBeenCalledWith(
      { _id: "github:delivery-1:test.subscriber.v1" },
      {
        $setOnInsert: expect.objectContaining({
          event_id: "github:delivery-1",
          subscriber_id: "test.subscriber.v1",
          status: "pending",
          attempts: 0,
        }),
      },
      { upsert: true },
    );
  });

  it("treats a provider redelivery as a duplicate without duplicating delivery state", async () => {
    mockInsertOne.mockRejectedValue({ code: 11000 });

    await expect(publishCaipeEvent(event)).resolves.toEqual({
      duplicate: true,
      subscribers: ["test.subscriber.v1"],
    });
    expect(mockUpdateOne).toHaveBeenCalledTimes(1);
  });
});
