const backgroundInvoker = jest.fn();
const discoverMeetingSeries = jest.fn();
const meetingSeriesMatches = jest.fn(() => true);
const findToArray = jest.fn();
const updateOne = jest.fn();

jest.mock("@/lib/mongodb", () => ({
  getCollection: async () => ({
    find: () => ({ toArray: findToArray }),
    updateOne,
  }),
}));

jest.mock("../webex-meeting-series", () => ({
  backgroundWebexMeetingInvoker: (...args: unknown[]) => backgroundInvoker(...args),
  discoverMeetingSeries: (...args: unknown[]) => discoverMeetingSeries(...args),
  meetingSeriesMatches: (...args: unknown[]) => meetingSeriesMatches(...args),
}));

import type { ProjectDocument, WebexMeetingSeriesSubscription } from "@/types/projects";
import {
  previewWebexMeetingSeriesBackfill,
  queueWebexMeetingSeriesBackfill,
  webexMeetingOccurrenceId,
  webexMeetingSeriesBackfillLookbackDays,
} from "../auto-ingest/webex-meeting-series-backfill";

describe("Webex meeting-series historical sync", () => {
  const now = new Date("2026-09-03T12:00:00Z");
  const project = {
    _id: "project-1",
    slug: "example-project",
  } as ProjectDocument & { _id: string };
  const subscription = {
    id: "subscription-1",
    enabled: true,
    seriesKey: "webex:series-1",
    seriesSlug: "weekly-sync",
    title: "Weekly sync",
    siteUrl: "https://example.webex.test",
    sourceRefs: { meetingSeriesId: "series-1" },
    credentialOwner: {
      subject: "owner-subject",
      email: "owner@example.test",
      name: "Owner",
      confirmedAt: "2026-08-01T00:00:00Z",
    },
    createdAt: "2026-09-01T00:00:00Z",
  } satisfies WebexMeetingSeriesSubscription;

  beforeEach(() => {
    jest.clearAllMocks();
    backgroundInvoker.mockResolvedValue(jest.fn());
    findToArray.mockResolvedValue([]);
    updateOne.mockResolvedValue({ upsertedCount: 1 });
  });

  it("uses a configurable, bounded lookback", () => {
    expect(webexMeetingSeriesBackfillLookbackDays(undefined)).toBe(30);
    expect(webexMeetingSeriesBackfillLookbackDays("14.9")).toBe(14);
    expect(webexMeetingSeriesBackfillLookbackDays("999")).toBe(365);
    expect(webexMeetingSeriesBackfillLookbackDays("0")).toBe(30);
  });

  it("returns only ended, untracked occurrences from a fresh owner lookup", async () => {
    const trackedStart = new Date("2026-08-25T10:00:00Z");
    findToArray.mockResolvedValue([
      {
        _id: "older-source-key",
        project_id: "project-1",
        subscription_id: "subscription-1",
        occurrence_key: "older-source-key",
        title: "Weekly sync",
        start: trackedStart,
        end: new Date("2026-08-25T11:00:00Z"),
        source: "userhub_calendar",
      },
    ]);
    discoverMeetingSeries.mockResolvedValue([
      {
        seriesKey: "webex:series-1",
        title: "Weekly sync",
        occurrences: [
          {
            occurrenceKey: "missing-meeting",
            meetingId: "meeting-1",
            title: "Weekly sync",
            start: "2026-09-01T10:00:00Z",
            end: "2026-09-01T11:00:00Z",
            cancelled: false,
            source: "meetings_api",
          },
          {
            occurrenceKey: "actual-key",
            meetingId: "meeting-tracked",
            title: "Weekly sync",
            start: "2026-08-25T10:10:00Z",
            end: "2026-08-25T11:00:00Z",
            cancelled: false,
            source: "meetings_api",
          },
          {
            occurrenceKey: "cancelled",
            title: "Weekly sync",
            start: "2026-08-20T10:00:00Z",
            end: "2026-08-20T11:00:00Z",
            cancelled: true,
            source: "meetings_api",
          },
          {
            occurrenceKey: "future",
            title: "Weekly sync",
            start: "2026-09-04T10:00:00Z",
            end: "2026-09-04T11:00:00Z",
            cancelled: false,
            source: "meetings_api",
          },
        ],
      },
    ]);

    const preview = await previewWebexMeetingSeriesBackfill(
      project,
      subscription,
      now,
      30,
    );

    expect(backgroundInvoker).toHaveBeenCalledWith("owner-subject");
    expect(discoverMeetingSeries).toHaveBeenCalledWith(
      expect.any(Function),
      expect.objectContaining({
        from: new Date("2026-08-04T12:00:00Z"),
        to: now,
        siteUrl: "https://example.webex.test",
      }),
    );
    expect(preview).toMatchObject({ foundCount: 2, trackedCount: 1 });
    expect(preview.missing.map((item) => item.occurrenceKey)).toEqual(["missing-meeting"]);
  });

  it("revalidates and inserts only explicitly selected occurrences", async () => {
    discoverMeetingSeries.mockResolvedValue([
      {
        seriesKey: "webex:series-1",
        title: "Weekly sync",
        occurrences: [
          {
            occurrenceKey: "selected",
            meetingId: "meeting-selected",
            title: "Weekly sync",
            start: "2026-09-01T10:00:00Z",
            end: "2026-09-01T11:00:00Z",
            webLink: "https://example.webex.test/meet/weekly",
            cancelled: false,
            source: "meetings_api",
          },
          {
            occurrenceKey: "not-selected",
            title: "Weekly sync",
            start: "2026-08-25T10:00:00Z",
            end: "2026-08-25T11:00:00Z",
            cancelled: false,
            source: "userhub_calendar",
          },
        ],
      },
    ]);

    const result = await queueWebexMeetingSeriesBackfill(
      project,
      subscription,
      ["selected", "not-returned"],
      now,
    );

    expect(result).toEqual({ queuedCount: 1, skippedCount: 1 });
    expect(updateOne).toHaveBeenCalledTimes(1);
    expect(updateOne).toHaveBeenCalledWith(
      {
        _id: webexMeetingOccurrenceId("project-1", "subscription-1", "selected"),
      },
      expect.objectContaining({
        $setOnInsert: expect.objectContaining({
          occurrence_key: "selected",
          meeting_id: "meeting-selected",
          web_link: "https://example.webex.test/meet/weekly",
          status: "pending",
          next_attempt_at: now,
        }),
      }),
      { upsert: true },
    );
  });
});
