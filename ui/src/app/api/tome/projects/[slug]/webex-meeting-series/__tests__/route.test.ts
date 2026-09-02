/** @jest-environment node */

import { NextRequest } from "next/server";

const mockLoadTomeProject = jest.fn();
const mockRequireTomeEditor = jest.fn();
const mockGetCollection = jest.fn();
const mockDiscoverMeetingSeries = jest.fn();
const mockInteractiveWebexMeetingInvoker = jest.fn();
const mockRequestWebexMeetingOwnerCheck = jest.fn();
const mockAuditTome = jest.fn();

jest.mock("@/lib/mongodb", () => ({
  getCollection: (...args: unknown[]) => mockGetCollection(...args),
}));

jest.mock("@/lib/tome/tome-api", () => ({
  loadTomeProject: (...args: unknown[]) => mockLoadTomeProject(...args),
  requireTomeEditor: (...args: unknown[]) => mockRequireTomeEditor(...args),
}));

jest.mock("@/lib/tome/agent-proxy", () => ({
  sessionSub: jest.fn(() => "owner-subject"),
}));

jest.mock("@/lib/tome/audit", () => ({
  auditTome: (...args: unknown[]) => mockAuditTome(...args),
  tomeActorFromAuth: jest.fn(() => ({
    type: "user",
    id: "owner-subject",
    email: "owner@example.test",
  })),
}));

jest.mock("@/lib/tome/auto-ingest/cursor", () => ({
  requestWebexMeetingOwnerCheck: (...args: unknown[]) =>
    mockRequestWebexMeetingOwnerCheck(...args),
}));

jest.mock("@/lib/tome/webex-meeting-series", () => ({
  createWebexMeetingSeriesSubscription: jest.fn(
    ({ candidate, credentialOwner, now }: {
      candidate: { seriesKey: string; title: string; siteUrl?: string };
      credentialOwner: { subject: string; email: string; name: string; confirmedAt: string };
      now: Date;
    }) => ({
      id: "subscription-id",
      enabled: true,
      seriesKey: candidate.seriesKey,
      seriesSlug: "example-weekly",
      title: candidate.title,
      siteUrl: candidate.siteUrl,
      sourceRefs: {},
      credentialOwner,
      createdAt: now.toISOString(),
      lastStatus: "pending",
    }),
  ),
  discoverMeetingSeries: (...args: unknown[]) => mockDiscoverMeetingSeries(...args),
  interactiveWebexMeetingInvoker: (...args: unknown[]) =>
    mockInteractiveWebexMeetingInvoker(...args),
  meetingSeriesHostEligibility: jest.fn(() => ({ canAutoIngest: true })),
  meetingSeriesMatches: jest.fn(
    (candidate: { seriesKey: string }, subscription: { seriesKey: string }) =>
      candidate.seriesKey === subscription.seriesKey,
  ),
  webexMeetingSeriesDiscoveryWindow: jest.fn(() => ({
    from: new Date("2026-09-01T00:00:00Z"),
    to: new Date("2026-12-01T00:00:00Z"),
    now: new Date("2026-09-03T00:00:00Z"),
  })),
}));

import { POST } from "../route";

const context = { params: Promise.resolve({ slug: "example-project" }) };
const updateOne = jest.fn();

describe("POST /api/tome/projects/[slug]/webex-meeting-series", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    updateOne.mockResolvedValue({ modifiedCount: 1 });
    mockGetCollection.mockResolvedValue({ updateOne });
    mockRequestWebexMeetingOwnerCheck.mockResolvedValue(undefined);
    mockInteractiveWebexMeetingInvoker.mockResolvedValue(jest.fn());
    mockDiscoverMeetingSeries.mockResolvedValue([
      {
        seriesKey: "example-series",
        title: "Example weekly",
        siteUrl: "https://example.webex.test/",
      },
    ]);
    mockLoadTomeProject.mockResolvedValue({
      projectId: "project-id",
      project: {
        _id: "project-id",
        type: "project",
        slug: "example-project",
        autoIngest: {
          enabled: false,
          cron: "0 9 * * *",
          credentialOwner: null,
          webexMeetingSeries: [],
        },
      },
      canEdit: true,
      user: { email: "owner@example.test" },
      session: {
        sub: "owner-subject",
        user: { name: "Example Owner", email: "owner@example.test" },
      },
    });
  });

  it("requests an immediate owner/site refresh after persisting a new subscription", async () => {
    const response = await POST(
      new NextRequest(
        "http://example.test/api/tome/projects/example-project/webex-meeting-series",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ seriesKey: "example-series" }),
        },
      ),
      context,
    );

    expect(response.status).toBe(201);
    expect(updateOne).toHaveBeenCalledTimes(1);
    expect(mockRequestWebexMeetingOwnerCheck).toHaveBeenCalledWith(
      "owner-subject",
      "https://example.webex.test",
      expect.any(Date),
    );
    expect(updateOne.mock.invocationCallOrder[0]).toBeLessThan(
      mockRequestWebexMeetingOwnerCheck.mock.invocationCallOrder[0],
    );
  });
});
