import type { IngestRun, WebexMeetingOccurrenceDocument } from "@/types/tome";

jest.mock("@/lib/mongodb", () => ({ getCollection: jest.fn() }));
jest.mock("@/lib/tome/mongo-collections", () => ({
  getTomeIngestRunsCollection: jest.fn(),
}));

import { summarizeWebexMeetingOccurrences } from "../webex-meeting-history";

function occurrence(
  overrides: Partial<WebexMeetingOccurrenceDocument>,
): WebexMeetingOccurrenceDocument {
  return {
    _id: "occurrence-1",
    project_id: "project-1",
    project_slug: "example-project",
    subscription_id: "subscription-1",
    series_key: "series-1",
    series_title: "Weekly sync",
    occurrence_key: "meeting-1",
    title: "Weekly sync",
    start: new Date("2026-08-31T10:00:00Z"),
    end: new Date("2026-08-31T11:00:00Z"),
    source: "meetings_api",
    status: "queued",
    attempts: 0,
    next_attempt_at: new Date("2026-08-31T11:10:00Z"),
    created_at: new Date("2026-08-31T11:10:00Z"),
    updated_at: new Date("2026-08-31T11:20:00Z"),
    ...overrides,
  };
}

describe("Webex meeting occurrence history", () => {
  it("reports every transcript segment and the joined ingest review state", () => {
    const rows = summarizeWebexMeetingOccurrences(
      [
        occurrence({
          transcript_id: "legacy-transcript",
          run_id: "run-older",
        }),
        occurrence({
          _id: "occurrence-2",
          occurrence_key: "meeting-2",
          start: new Date("2026-09-01T10:00:00Z"),
          end: new Date("2026-09-01T11:00:00Z"),
          transcript_ids: ["transcript-1", "transcript-2"],
          run_id: "run-newer",
        }),
      ],
      [
        {
          _id: "run-older",
          project_id: "project-1",
          status: "succeeded",
          greenfield: false,
          log: ["done"],
          started_at: new Date("2026-08-31T11:20:00Z"),
        },
        {
          _id: "run-newer",
          project_id: "project-1",
          report_id: "report-2",
          status: "awaiting_review",
          greenfield: false,
          log: ["one", "two"],
          started_at: new Date("2026-09-01T11:20:00Z"),
        },
      ] as IngestRun[],
    );

    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({
      id: "occurrence-2",
      transcriptFound: true,
      transcriptCount: 2,
      runId: "run-newer",
      runStatus: "awaiting_review",
      reportId: "report-2",
      logLines: 2,
    });
    expect(rows[1]).toMatchObject({
      transcriptFound: true,
      transcriptCount: 1,
      runStatus: "succeeded",
    });
  });
});
