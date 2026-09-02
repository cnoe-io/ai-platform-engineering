/** @jest-environment node */

import { NextRequest } from "next/server";

const mockDiscoverMeetingSeries = jest.fn();
const mockInteractiveWebexMeetingInvoker = jest.fn();

jest.mock("@/lib/api-middleware", () => {
  const actual = jest.requireActual("@/lib/api-middleware");
  return {
    ...actual,
    getAuthFromBearerOrSession: jest.fn(async () => ({
      user: { email: "creator@example.test" },
      session: { sub: "creator-subject", user: { email: "creator@example.test" } },
    })),
  };
});

jest.mock("@/lib/mongodb", () => ({ isMongoDBConfigured: true }));
jest.mock("@/lib/tome/guard", () => ({ isTomeServerEnabled: () => true }));
jest.mock("@/lib/tome/principal", () => ({ requireInteractiveTomePrincipal: jest.fn() }));
jest.mock("@/lib/tome/webex-meeting-series", () => ({
  discoverMeetingSeries: (...args: unknown[]) => mockDiscoverMeetingSeries(...args),
  interactiveWebexMeetingInvoker: (...args: unknown[]) =>
    mockInteractiveWebexMeetingInvoker(...args),
  meetingSeriesHostEligibility: (candidate: { hostEmail?: string }, callerEmail: string) => ({
    canAutoIngest: candidate.hostEmail?.toLowerCase() === callerEmail.toLowerCase(),
  }),
  webexMeetingSeriesDiscoveryWindow: () => ({
    from: new Date("2026-09-01T00:00:00Z"),
    to: new Date("2026-12-01T00:00:00Z"),
    now: new Date("2026-09-03T00:00:00Z"),
  }),
}));

import { GET } from "../route";

describe("GET /api/tome/webex-meeting-series", () => {
  it("discovers pre-create candidates and marks host eligibility", async () => {
    mockInteractiveWebexMeetingInvoker.mockResolvedValue(jest.fn());
    mockDiscoverMeetingSeries.mockResolvedValue([
      {
        seriesKey: "hosted-series",
        title: "Platform weekly",
        hostEmail: "creator@example.test",
        sourceRefs: {},
        sources: ["meetings_api"],
        occurrences: [],
      },
      {
        seriesKey: "guest-series",
        title: "Customer update",
        hostEmail: "host@example.test",
        sourceRefs: {},
        sources: ["userhub_calendar"],
        occurrences: [],
      },
    ]);

    const response = await GET(
      new NextRequest("http://example.test/api/tome/webex-meeting-series"),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data.candidates).toEqual([
      expect.objectContaining({ seriesKey: "hosted-series", canAutoIngest: true }),
      expect.objectContaining({ seriesKey: "guest-series", canAutoIngest: false }),
    ]);
  });
});
