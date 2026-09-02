/** @jest-environment node */

const mockIsAttached = jest.fn();
const mockRecordIssueEvent = jest.fn();
const mockEmitLabelChangeToFeed = jest.fn();

jest.mock("@/lib/github-webhooks/tome-issue-cache", () => ({
  isRepositoryAttachedToTome: (...args: unknown[]) => mockIsAttached(...args),
  isTomeIssueCacheEvent: (eventType: string) => eventType === "issues",
  recordTomeIssueCacheEvent: (...args: unknown[]) => mockRecordIssueEvent(...args),
}));
jest.mock("@/lib/tome/source-feed/webhook", () => ({
  emitLabelChangeToFeed: (...args: unknown[]) => mockEmitLabelChangeToFeed(...args),
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

describe("CAIPE TOME feed label-change subscriber", () => {
  const labeledIssueEvent: CaipeEvent = {
    _id: "github:delivery-2",
    specversion: "1.0",
    source: "github",
    type: "github.issues.labeled",
    subject: "example/service#42",
    time: new Date("2026-08-28T00:00:00Z"),
    received_at: new Date("2026-08-28T00:00:01Z"),
    expires_at: new Date("2026-09-04T00:00:00Z"),
    data: {
      github_event: "issues",
      action: "labeled",
      repository_id: 123,
      repository_full_name: "example/service",
      delivery_id: "delivery-2",
      issue: {
        number: 42,
        title: "Example issue",
        url: "https://github.com/example/service/issues/42",
        labels: ["status:in-progress"],
      },
      label_name: "status:in-progress",
      sender_login: "test-user",
    },
  };

  function findSubscriber(): (typeof caipeEventSubscribers)[number] {
    const subscriber = caipeEventSubscribers.find(
      (candidate) => candidate.id === "tome.feed.label-change.v1",
    );
    if (!subscriber) throw new Error("subscriber not registered");
    return subscriber;
  }

  beforeEach(() => {
    jest.clearAllMocks();
    mockEmitLabelChangeToFeed.mockResolvedValue(undefined);
  });

  it("matches labeled/unlabeled issues and pull_request events only", () => {
    const subscriber = findSubscriber();
    expect(subscriber.matches(labeledIssueEvent)).toBe(true);
    expect(
      subscriber.matches({
        ...labeledIssueEvent,
        data: { ...labeledIssueEvent.data, github_event: "pull_request" },
      }),
    ).toBe(true);
    expect(
      subscriber.matches({
        ...labeledIssueEvent,
        data: { ...labeledIssueEvent.data, action: "edited" },
      }),
    ).toBe(false);
    expect(
      subscriber.matches({ ...labeledIssueEvent, source: "webex" }),
    ).toBe(false);
  });

  it("posts a Feed entry for a labeled issue", async () => {
    await findSubscriber().handle(labeledIssueEvent);

    expect(mockEmitLabelChangeToFeed).toHaveBeenCalledWith({
      repoId: 123,
      repoFullName: "example/service",
      action: "labeled",
      artifact: "issue",
      number: 42,
      title: "Example issue",
      url: "https://github.com/example/service/issues/42",
      labels: ["status:in-progress"],
      labelName: "status:in-progress",
      actor: "test-user",
      ts: "2026-08-28T00:00:00.000Z",
    });
  });

  it("reads the pull_request snapshot for a pull_request event", async () => {
    await findSubscriber().handle({
      ...labeledIssueEvent,
      type: "github.pull_request.unlabeled",
      data: {
        github_event: "pull_request",
        action: "unlabeled",
        repository_id: 123,
        repository_full_name: "example/service",
        delivery_id: "delivery-3",
        pull_request: {
          number: 7,
          title: "Add retry to the sync job",
          url: "https://github.com/example/service/pull/7",
          labels: [],
        },
        label_name: "status:in-progress",
        sender_login: "test-user",
      },
    });

    expect(mockEmitLabelChangeToFeed).toHaveBeenCalledWith(
      expect.objectContaining({
        artifact: "pr",
        number: 7,
        action: "unlabeled",
        labelName: "status:in-progress",
      }),
    );
  });

  it("no-ops when the event carries no usable issue/PR snapshot", async () => {
    await findSubscriber().handle({
      ...labeledIssueEvent,
      data: { ...labeledIssueEvent.data, issue: undefined },
    });

    expect(mockEmitLabelChangeToFeed).not.toHaveBeenCalled();
  });
});
