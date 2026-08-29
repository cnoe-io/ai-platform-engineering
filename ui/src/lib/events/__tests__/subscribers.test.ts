/** @jest-environment node */

const mockIsAttached = jest.fn();
const mockRecordIssueEvent = jest.fn();

jest.mock("@/lib/github-webhooks/tome-issue-cache", () => ({
  isRepositoryAttachedToTome: (...args: unknown[]) => mockIsAttached(...args),
  isTomeIssueCacheEvent: (eventType: string) => eventType === "issues",
  recordTomeIssueCacheEvent: (...args: unknown[]) => mockRecordIssueEvent(...args),
}));
import { caipeEventSubscribers } from "@/lib/events/subscribers";
import type { CaipeEvent } from "@/lib/events/types";

describe("CAIPE TOME issue-cache subscriber", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockIsAttached.mockResolvedValue(true);
    mockRecordIssueEvent.mockResolvedValue(undefined);
  });

  it("commits the issue cache update for Mongo-polled SSE consumers", async () => {
    const event: CaipeEvent = {
      _id: "github:delivery-1",
      specversion: "1.0",
      source: "github",
      type: "github.issues.labeled",
      subject: "example/service#42",
      time: new Date("2026-08-28T00:00:00Z"),
      received_at: new Date("2026-08-28T00:00:01Z"),
      expires_at: new Date("2026-09-04T00:00:00Z"),
      data: {
        github_event: "issues",
        repository_id: 123,
        repository_full_name: "example/service",
        delivery_id: "delivery-1",
        issue: { number: 42 },
      },
    };
    const subscriber = caipeEventSubscribers[0];

    await subscriber.handle(event);

    expect(mockRecordIssueEvent).toHaveBeenCalledWith(expect.objectContaining({
      fullName: "example/service",
      eventType: "issues",
      issue: { number: 42 },
    }));
  });
});
