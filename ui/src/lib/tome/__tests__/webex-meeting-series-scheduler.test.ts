const projectUpdate = jest.fn();
const enqueueRun = jest.fn();
const isIngestRunning = jest.fn();
const claimOwnerCheck = jest.fn();
const scheduleOwnerCheck = jest.fn();
const backgroundInvoker = jest.fn();
const discoverMeetingSeries = jest.fn();
const downloadMeetingTranscript = jest.fn();
const resolveOccurrenceMeeting = jest.fn();
const runFindOne = jest.fn();

interface TestOccurrence {
  _id?: unknown;
  project_id?: unknown;
  subscription_id?: unknown;
  status?: unknown;
  attempts?: number;
  [key: string]: unknown;
}

interface TestOccurrenceQuery {
  _id?: unknown | { $in?: unknown[] };
  project_id?: unknown;
  subscription_id?: { $in: unknown[] };
  status?: string | { $in: unknown[] };
}

interface TestOccurrenceUpdate {
  $setOnInsert?: TestOccurrence;
  $set?: TestOccurrence;
  $inc?: { attempts?: number };
}

let occurrences: TestOccurrence[] = [];

const occurrenceCollection = {
  updateMany: jest.fn(async () => ({ modifiedCount: 0 })),
  updateOne: jest.fn(async (filter: TestOccurrenceQuery, update: TestOccurrenceUpdate) => {
    const index = occurrences.findIndex((item) => item._id === filter._id);
    if (index < 0 && update.$setOnInsert) {
      occurrences.push({ ...update.$setOnInsert });
      return { upsertedCount: 1, modifiedCount: 0 };
    }
    if (index >= 0) {
      occurrences[index] = {
        ...occurrences[index],
        ...(update.$set ?? {}),
        attempts: (occurrences[index].attempts ?? 0) + (update.$inc?.attempts ?? 0),
      };
      return { upsertedCount: 0, modifiedCount: 1 };
    }
    return { upsertedCount: 0, modifiedCount: 0 };
  }),
  findOneAndUpdate: jest.fn(async (filter: TestOccurrenceQuery, update: TestOccurrenceUpdate) => {
    const index = occurrences.findIndex((item) => item._id === filter._id);
    if (index < 0) return null;
    occurrences[index] = { ...occurrences[index], ...(update.$set ?? {}) };
    return occurrences[index];
  }),
  find: jest.fn((query: TestOccurrenceQuery) => {
    const selected = occurrences.filter((item) => {
      if (query.project_id && item.project_id !== query.project_id) return false;
      if (typeof query.status === "string") return item.status === query.status;
      if (typeof query.status !== "string" && query.status?.$in && !query.status.$in.includes(item.status)) {
        return false;
      }
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
  deleteOne: jest.fn(async (filter: TestOccurrenceQuery) => {
    const index = occurrences.findIndex((item) => item._id === filter._id);
    if (index < 0) return { deletedCount: 0 };
    occurrences.splice(index, 1);
    return { deletedCount: 1 };
  }),
  deleteMany: jest.fn(async (filter: TestOccurrenceQuery) => {
    const ids =
      typeof filter._id === "object" && filter._id !== null && "$in" in filter._id
        ? filter._id.$in ?? []
        : [];
    const before = occurrences.length;
    occurrences = occurrences.filter((item) => !ids.includes(item._id));
    return { deletedCount: before - occurrences.length };
  }),
};

jest.mock("@/lib/mongodb", () => ({
  getCollection: async (name: string) =>
    name === "tome_webex_meeting_occurrences"
      ? occurrenceCollection
      : { updateOne: projectUpdate },
}));
jest.mock("mongodb", () => ({
  ObjectId: class MockObjectId {
    static isValid() {
      return false;
    }
  },
}));
jest.mock("../mongo-collections", () => ({
  getTomeIngestRunsCollection: async () => ({ findOne: runFindOne }),
}));
jest.mock("../ingest-runner", () => ({
  enqueueRun: (...args: unknown[]) => enqueueRun(...args),
  isIngestRunning: (...args: unknown[]) => isIngestRunning(...args),
}));
jest.mock("../auto-ingest/cursor", () => ({
  claimWebexMeetingOwnerCheck: (...args: unknown[]) => claimOwnerCheck(...args),
  scheduleWebexMeetingOwnerCheck: (...args: unknown[]) => scheduleOwnerCheck(...args),
}));
jest.mock("../webex-meeting-series", () => ({
  backgroundWebexMeetingInvoker: (...args: unknown[]) => backgroundInvoker(...args),
  discoverMeetingSeries: (...args: unknown[]) => discoverMeetingSeries(...args),
  downloadMeetingTranscript: (...args: unknown[]) => downloadMeetingTranscript(...args),
  meetingSeriesMatches: () => true,
  resolveOccurrenceMeeting: (...args: unknown[]) => resolveOccurrenceMeeting(...args),
}));

import {
  tickWebexMeetingSeriesScheduler,
  webexTranscriptMaxRetryPeriodMs,
} from "../auto-ingest/webex-meeting-series-scheduler";
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
    claimOwnerCheck.mockResolvedValue(true);
    scheduleOwnerCheck.mockResolvedValue(undefined);
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
    resolveOccurrenceMeeting.mockResolvedValue({ meetingId: "actual-1", missed: false });
    downloadMeetingTranscript.mockResolvedValue({
      transcript: "A decision was made.",
      transcriptId: "transcript-1",
      transcriptIds: ["transcript-1"],
      listedTranscriptIds: ["transcript-1"],
      listedCount: 1,
      downloadedCount: 1,
    });
    isIngestRunning.mockResolvedValue(false);
    runFindOne.mockResolvedValue(null);
    enqueueRun.mockResolvedValue("run-1");
  });

  it("uses a two-hour max retry period by default and accepts an override", () => {
    expect(webexTranscriptMaxRetryPeriodMs(undefined)).toBe(2 * 60 * 60 * 1000);
    expect(webexTranscriptMaxRetryPeriodMs("3600000")).toBe(60 * 60 * 1000);
    expect(webexTranscriptMaxRetryPeriodMs("invalid")).toBe(2 * 60 * 60 * 1000);
  });

  it("queues one transcript-backed ingest with stable series identity", async () => {
    await tickWebexMeetingSeriesScheduler(now, [project]);

    expect(enqueueRun).not.toHaveBeenCalled();
    expect(occurrences[0]).toMatchObject({
      status: "waiting_transcript",
      transcript_ids: ["transcript-1"],
      transcript_observed_at: now,
    });

    await tickWebexMeetingSeriesScheduler(new Date(now.getTime() + 15 * 60_000), [project]);

    expect(backgroundInvoker).toHaveBeenCalledWith("owner-sub");
    expect(enqueueRun).toHaveBeenCalledWith(
      project,
      expect.objectContaining({
        sub: "owner-sub",
        triggeredBy: "auto",
        dispatch: expect.objectContaining({
          endpoint: "/ingest",
          sourceScope: "webex_meetings",
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
    expect(scheduleOwnerCheck).toHaveBeenCalledWith(
      "owner-sub",
      "",
      now,
      new Date("2026-09-02T12:00:00Z"),
    );
  });

  it("shows a pending transcript state and stops after the default two-hour retry period", async () => {
    resolveOccurrenceMeeting.mockResolvedValue({ meetingId: null, missed: false });
    downloadMeetingTranscript.mockResolvedValue(null);

    await tickWebexMeetingSeriesScheduler(now, [project]);

    expect(occurrences[0]).toMatchObject({
      status: "waiting_transcript",
      last_error: "Waiting for meeting transcript.",
    });

    await tickWebexMeetingSeriesScheduler(new Date("2026-09-01T13:31:00Z"), [project]);

    expect(occurrences[0]).toMatchObject({
      status: "skipped",
      last_error:
        "No accessible recording or transcript became available before the retry period ended.",
    });
  });

  it("uses the series occurrence to retrieve a transcript without a public instance id", async () => {
    resolveOccurrenceMeeting.mockResolvedValue({ meetingId: null, missed: false });
    downloadMeetingTranscript.mockResolvedValue({
      transcript: "A shared decision was made.",
      meetingId: "userhub-instance-1",
      transcriptId: "recording-1",
      transcriptIds: ["recording-1"],
      listedTranscriptIds: ["recording-1"],
      listedCount: 1,
      downloadedCount: 1,
    });

    await tickWebexMeetingSeriesScheduler(now, [project]);

    expect(downloadMeetingTranscript).toHaveBeenCalledWith(expect.any(Function), {
      meetingId: null,
      title: "Platform sync",
      start: "2026-09-01T10:30:00.000Z",
      siteUrl: undefined,
    });
    expect(occurrences[0]).toMatchObject({
      status: "waiting_transcript",
      meeting_id: "userhub-instance-1",
      transcript_id: "recording-1",
    });
  });

  it("consolidates duplicate source rows that resolve to the same meeting instance", async () => {
    discoverMeetingSeries.mockResolvedValueOnce([
      {
        seriesKey: "webex:series-1",
        title: "Platform sync",
        sourceRefs: { meetingSeriesId: "series-1" },
        sources: ["meetings_api", "userhub_calendar"],
        occurrences: [
          {
            occurrenceKey: "actual-1",
            meetingId: "actual-1",
            title: "Platform sync",
            start: "2026-09-01T10:25:00Z",
            end: "2026-09-01T10:35:00Z",
            cancelled: false,
            source: "meetings_api",
          },
          {
            occurrenceKey: "calendar-1",
            title: "Platform sync",
            start: "2026-09-01T10:30:00Z",
            end: "2026-09-01T11:30:00Z",
            cancelled: false,
            source: "userhub_calendar",
          },
        ],
      },
    ]);
    resolveOccurrenceMeeting.mockResolvedValue({ meetingId: "actual-1", missed: false });

    await tickWebexMeetingSeriesScheduler(now, [project]);

    expect(occurrences).toHaveLength(1);
    expect(occurrences[0]).toMatchObject({
      meeting_id: "actual-1",
      occurrence_key: "actual-1",
      start: new Date("2026-09-01T10:25:00Z"),
      source: "meetings_api",
      status: "waiting_transcript",
    });
    expect(enqueueRun).not.toHaveBeenCalled();
  });

  it("removes an unprocessed duplicate when the same meeting already has a run", async () => {
    claimOwnerCheck.mockResolvedValueOnce(false);
    occurrences = [
      {
        _id: "actual-row",
        project_id: "project-1",
        subscription_id: "subscription-1",
        occurrence_key: "actual-1",
        meeting_id: "actual-1",
        title: "Platform sync",
        start: new Date("2026-09-01T10:25:00Z"),
        end: new Date("2026-09-01T10:35:00Z"),
        source: "meetings_api",
        status: "failed",
        attempts: 0,
        next_attempt_at: now,
        run_id: "existing-run",
        last_error: "Existing ingest failed.",
      },
      {
        _id: "calendar-row",
        project_id: "project-1",
        subscription_id: "subscription-1",
        occurrence_key: "calendar-1",
        meeting_id: "actual-1",
        title: "Platform sync",
        start: new Date("2026-09-01T10:30:00Z"),
        end: new Date("2026-09-01T11:30:00Z"),
        source: "userhub_calendar",
        status: "waiting_transcript",
        attempts: 0,
        next_attempt_at: now,
      },
    ];

    await tickWebexMeetingSeriesScheduler(now, [project]);

    expect(occurrences).toHaveLength(1);
    expect(occurrences[0]).toMatchObject({ _id: "actual-row", run_id: "existing-run" });
    expect(enqueueRun).not.toHaveBeenCalled();
    expect(projectUpdate).toHaveBeenCalledWith(
      { _id: "project-1" },
      expect.objectContaining({
        $set: expect.objectContaining({
          "autoIngest.webexMeetingSeries.$[series].lastRunId": "existing-run",
          "autoIngest.webexMeetingSeries.$[series].lastStatus": "failed",
          "autoIngest.webexMeetingSeries.$[series].lastError": "Existing ingest failed.",
        }),
      }),
      expect.any(Object),
    );
  });

  it("checks User Hub before skipping an occurrence Webex reports as missed", async () => {
    resolveOccurrenceMeeting.mockResolvedValue({ meetingId: null, missed: true });
    downloadMeetingTranscript.mockResolvedValue(null);

    await tickWebexMeetingSeriesScheduler(now, [project]);

    expect(occurrences[0]).toMatchObject({
      status: "waiting_transcript",
      last_error: "Waiting for meeting transcript.",
    });
    expect(downloadMeetingTranscript).toHaveBeenCalled();

    await tickWebexMeetingSeriesScheduler(new Date("2026-09-01T13:31:00Z"), [project]);

    expect(occurrences[0]).toMatchObject({
      status: "skipped",
      last_error:
        "No accessible recording or transcript became available before the retry period ended.",
    });
  });

  it("resets settling when another transcript segment appears", async () => {
    downloadMeetingTranscript
      .mockResolvedValueOnce({
        transcript: "First segment",
        transcriptId: "transcript-1",
        transcriptIds: ["transcript-1"],
        listedTranscriptIds: ["transcript-1"],
        listedCount: 1,
        downloadedCount: 1,
      })
      .mockResolvedValue({
        transcript: "First segment\n\nSecond segment",
        transcriptId: "transcript-1",
        transcriptIds: ["transcript-1", "transcript-2"],
        listedTranscriptIds: ["transcript-1", "transcript-2"],
        listedCount: 2,
        downloadedCount: 2,
      });

    await tickWebexMeetingSeriesScheduler(now, [project]);
    await tickWebexMeetingSeriesScheduler(new Date(now.getTime() + 15 * 60_000), [project]);

    expect(enqueueRun).not.toHaveBeenCalled();
    expect(occurrences[0]).toMatchObject({
      status: "waiting_transcript",
      transcript_ids: ["transcript-1", "transcript-2"],
      transcript_observed_at: new Date(now.getTime() + 15 * 60_000),
    });

    await tickWebexMeetingSeriesScheduler(new Date(now.getTime() + 30 * 60_000), [project]);

    expect(enqueueRun).toHaveBeenCalledWith(
      project,
      expect.objectContaining({
        dispatch: expect.objectContaining({
          webexMeetings: [
            expect.objectContaining({ transcript: "First segment\n\nSecond segment" }),
          ],
        }),
      }),
    );
  });

  it("uses one discovery sweep for every series owned by the same user and site", async () => {
    const secondProject = {
      ...project,
      _id: "project-2",
      slug: "project-two",
      autoIngest: {
        ...project.autoIngest,
        webexMeetingSeries: [
          {
            ...project.autoIngest!.webexMeetingSeries![0],
            id: "subscription-2",
            seriesKey: "webex:series-2",
          },
        ],
      },
    } as ProjectDocument & { _id: string };

    await tickWebexMeetingSeriesScheduler(now, [project, secondProject]);

    expect(claimOwnerCheck).toHaveBeenCalledTimes(1);
    expect(backgroundInvoker).toHaveBeenCalledTimes(1);
    expect(discoverMeetingSeries).toHaveBeenCalledTimes(1);
    expect(scheduleOwnerCheck).toHaveBeenCalledTimes(1);
  });

  it("does not call Webex before the user-level calendar check is due", async () => {
    claimOwnerCheck.mockResolvedValueOnce(false);

    await tickWebexMeetingSeriesScheduler(now, [project]);

    expect(backgroundInvoker).not.toHaveBeenCalled();
    expect(discoverMeetingSeries).not.toHaveBeenCalled();
    expect(scheduleOwnerCheck).not.toHaveBeenCalled();
  });

  it("wakes after the earliest upcoming meeting instead of waiting for the daily refresh", async () => {
    discoverMeetingSeries.mockResolvedValueOnce([
      {
        seriesKey: "webex:series-1",
        title: "Platform sync",
        sourceRefs: { meetingSeriesId: "series-1" },
        sources: ["meetings_api"],
        nextOccurrence: {
          occurrenceKey: "scheduled-2",
          title: "Platform sync",
          start: "2026-09-02T10:00:00Z",
          end: "2026-09-02T11:00:00Z",
          cancelled: false,
          source: "meetings_api",
        },
        occurrences: [],
      },
    ]);

    await tickWebexMeetingSeriesScheduler(now, [project]);

    expect(scheduleOwnerCheck).toHaveBeenCalledWith(
      "owner-sub",
      "",
      now,
      new Date("2026-09-02T11:10:00Z"),
    );
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
