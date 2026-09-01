const projectUpdate = jest.fn();
const enqueueRun = jest.fn();
const isIngestRunning = jest.fn();
const claimPoll = jest.fn();
const backgroundInvoker = jest.fn();
const discoverMeetingSeries = jest.fn();
const downloadMeetingTranscript = jest.fn();
const resolveOccurrenceMeetingId = jest.fn();
const runFindOne = jest.fn();

let occurrences: Array<Record<string, any>> = [];

const occurrenceCollection = {
  updateMany: jest.fn(async () => ({ modifiedCount: 0 })),
  updateOne: jest.fn(async (filter: Record<string, any>, update: Record<string, any>) => {
    const index = occurrences.findIndex((item) => item._id === filter._id);
    if (index < 0 && update.$setOnInsert) {
      occurrences.push({ ...update.$setOnInsert });
      return { upsertedCount: 1, modifiedCount: 0 };
    }
    if (index >= 0) {
      occurrences[index] = {
        ...occurrences[index],
        ...(update.$set ?? {}),
        attempts: occurrences[index].attempts + (update.$inc?.attempts ?? 0),
      };
      return { upsertedCount: 0, modifiedCount: 1 };
    }
    return { upsertedCount: 0, modifiedCount: 0 };
  }),
  findOneAndUpdate: jest.fn(async (filter: Record<string, any>, update: Record<string, any>) => {
    const index = occurrences.findIndex((item) => item._id === filter._id);
    if (index < 0) return null;
    occurrences[index] = { ...occurrences[index], ...(update.$set ?? {}) };
    return occurrences[index];
  }),
  find: jest.fn((query: Record<string, any>) => {
    const selected = occurrences.filter((item) => {
      if (query.project_id && item.project_id !== query.project_id) return false;
      if (typeof query.status === "string") return item.status === query.status;
      if (query.status?.$in && !query.status.$in.includes(item.status)) return false;
      if (query.subscription_id?.$in && !query.subscription_id.$in.includes(item.subscription_id)) {
        return false;
      }
      return true;
    });
    const cursor = {
      sort: () => cursor,
      limit: () => cursor,
      toArray: async () => selected,
    };
    return cursor;
  }),
};

jest.mock("@/lib/mongodb", () => ({
  getCollection: async (name: string) =>
    name === "tome_webex_meeting_occurrences"
      ? occurrenceCollection
      : { updateOne: projectUpdate },
}));
jest.mock("../mongo-collections", () => ({
  getTomeIngestRunsCollection: async () => ({ findOne: runFindOne }),
}));
jest.mock("../ingest-runner", () => ({
  enqueueRun: (...args: unknown[]) => enqueueRun(...args),
  isIngestRunning: (...args: unknown[]) => isIngestRunning(...args),
}));
jest.mock("../auto-ingest/cursor", () => ({
  claimWebexMeetingSeriesPoll: (...args: unknown[]) => claimPoll(...args),
}));
jest.mock("../webex-meeting-series", () => ({
  backgroundWebexMeetingInvoker: (...args: unknown[]) => backgroundInvoker(...args),
  discoverMeetingSeries: (...args: unknown[]) => discoverMeetingSeries(...args),
  downloadMeetingTranscript: (...args: unknown[]) => downloadMeetingTranscript(...args),
  meetingSeriesMatches: () => true,
  resolveOccurrenceMeetingId: (...args: unknown[]) => resolveOccurrenceMeetingId(...args),
}));

import { tickWebexMeetingSeriesScheduler } from "../auto-ingest/webex-meeting-series-scheduler";
import type { ProjectDocument } from "@/types/projects";

describe("Webex meeting-series scheduler", () => {
  const now = new Date("2026-09-01T12:00:00Z");
  const owner = {
    subject: "owner-sub",
    email: "owner@example.test",
    name: "Owner",
    confirmedAt: "2026-09-01T09:00:00Z",
  };
  const project = {
    _id: "project-1",
    slug: "project-one",
    title: "Project one",
    autoIngest: {
      enabled: false,
      cron: "0 9 * * *",
      credentialOwner: null,
      webexMeetingSeries: [
        {
          id: "subscription-1",
          enabled: true,
          seriesKey: "webex:series-1",
          seriesSlug: "platform-sync",
          title: "Platform sync",
          sourceRefs: { meetingSeriesId: "series-1" },
          credentialOwner: owner,
          createdAt: "2026-09-01T10:00:00Z",
        },
      ],
    },
  } as ProjectDocument & { _id: string };

  beforeEach(() => {
    jest.clearAllMocks();
    occurrences = [];
    claimPoll.mockResolvedValue(true);
    backgroundInvoker.mockResolvedValue(jest.fn());
    discoverMeetingSeries.mockResolvedValue([
      {
        seriesKey: "webex:series-1",
        title: "Platform sync",
        siteUrl: "https://cisco.webex.com",
        sourceRefs: { meetingSeriesId: "series-1" },
        sources: ["meetings_api"],
        occurrences: [
          {
            occurrenceKey: "actual-1",
            meetingId: "actual-1",
            title: "Platform sync",
            start: "2026-09-01T10:30:00Z",
            end: "2026-09-01T11:30:00Z",
            cancelled: false,
            source: "meetings_api",
          },
        ],
      },
    ]);
    resolveOccurrenceMeetingId.mockResolvedValue("actual-1");
    downloadMeetingTranscript.mockResolvedValue({
      transcript: "A decision was made.",
      transcriptId: "transcript-1",
    });
    isIngestRunning.mockResolvedValue(false);
    runFindOne.mockResolvedValue(null);
    enqueueRun.mockResolvedValue("run-1");
  });

  it("queues one transcript-backed ingest with stable series identity", async () => {
    await tickWebexMeetingSeriesScheduler(now, [project]);

    expect(backgroundInvoker).toHaveBeenCalledWith("owner-sub");
    expect(enqueueRun).toHaveBeenCalledWith(
      project,
      expect.objectContaining({
        sub: "owner-sub",
        triggeredBy: "auto",
        dispatch: expect.objectContaining({
          endpoint: "/ingest",
          triggeredBy: "auto",
          meetingOccurrenceId: expect.any(String),
          webexMeetings: [
            expect.objectContaining({
              id: "actual-1",
              seriesKey: "webex:series-1",
              seriesSlug: "platform-sync",
              transcript: "A decision was made.",
            }),
          ],
        }),
      }),
    );
    expect(occurrences[0]).toMatchObject({ status: "queued", run_id: "run-1" });
  });

  it("does not backfill an occurrence that ended before subscription creation", async () => {
    discoverMeetingSeries.mockResolvedValueOnce([
      {
        seriesKey: "webex:series-1",
        sourceRefs: { meetingSeriesId: "series-1" },
        occurrences: [
          {
            occurrenceKey: "old",
            meetingId: "old",
            title: "Platform sync",
            start: "2026-09-01T08:00:00Z",
            end: "2026-09-01T09:00:00Z",
            cancelled: false,
            source: "meetings_api",
          },
        ],
      },
    ]);

    await tickWebexMeetingSeriesScheduler(now, [project]);

    expect(enqueueRun).not.toHaveBeenCalled();
    expect(occurrences).toHaveLength(0);
  });
});
