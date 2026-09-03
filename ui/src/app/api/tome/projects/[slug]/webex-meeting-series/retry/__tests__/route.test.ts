/** @jest-environment node */

import { NextRequest } from "next/server";

const mockLoadTomeProject = jest.fn();
const mockRequireTomeEditor = jest.fn();
const mockGetCollection = jest.fn();
const mockGetTomeIngestRunsCollection = jest.fn();
const mockEnqueueRun = jest.fn();
const mockAuditTome = jest.fn();

jest.mock("@/lib/mongodb", () => ({
  getCollection: (...args: unknown[]) => mockGetCollection(...args),
}));

jest.mock("@/lib/tome/tome-api", () => ({
  loadTomeProject: (...args: unknown[]) => mockLoadTomeProject(...args),
  requireTomeEditor: (...args: unknown[]) => mockRequireTomeEditor(...args),
}));

jest.mock("@/lib/tome/agent-proxy", () => ({
  sessionSub: jest.fn(() => "retry-user-sub"),
}));

jest.mock("@/lib/tome/ingest-runner", () => ({
  enqueueRun: (...args: unknown[]) => mockEnqueueRun(...args),
}));

jest.mock("@/lib/tome/mongo-collections", () => ({
  getTomeIngestRunsCollection: (...args: unknown[]) =>
    mockGetTomeIngestRunsCollection(...args),
}));

jest.mock("@/lib/tome/audit", () => ({
  auditTome: (...args: unknown[]) => mockAuditTome(...args),
  tomeActorFromAuth: jest.fn(() => ({
    type: "user",
    id: "retry-user-sub",
    email: "editor@example.test",
  })),
}));

import { POST } from "../route";

const context = { params: Promise.resolve({ slug: "example-project" }) };

const occurrence = {
  _id: "occurrence-1",
  project_id: "project-1",
  project_slug: "example-project",
  subscription_id: "subscription-1",
  series_key: "series-1",
  series_title: "Weekly sync",
  occurrence_key: "meeting-1",
  meeting_id: "meeting-1",
  title: "Weekly sync",
  start: new Date("2026-09-01T10:00:00Z"),
  end: new Date("2026-09-01T11:00:00Z"),
  source: "meetings_api",
  status: "failed",
  attempts: 1,
  next_attempt_at: new Date("2026-09-01T11:15:00Z"),
  run_id: "failed-run-1",
  last_error: "Invalid GitHub repository source",
  created_at: new Date("2026-09-01T11:10:00Z"),
  updated_at: new Date("2026-09-01T11:20:00Z"),
};

describe("POST meeting-series retry", () => {
  const occurrenceFindOne = jest.fn();
  const occurrenceFindOneAndUpdate = jest.fn();
  const occurrenceUpdateOne = jest.fn();
  const projectUpdateOne = jest.fn();
  const runFindOne = jest.fn();

  beforeEach(() => {
    jest.clearAllMocks();
    mockLoadTomeProject.mockResolvedValue({
      projectId: "project-1",
      project: { _id: "project-1", slug: "example-project", type: "project" },
      canEdit: true,
      user: { email: "editor@example.test" },
      session: { sub: "retry-user-sub", user: { email: "editor@example.test" } },
    });
    occurrenceFindOne.mockResolvedValue(occurrence);
    occurrenceFindOneAndUpdate.mockResolvedValue({ ...occurrence, status: "processing" });
    occurrenceUpdateOne.mockResolvedValue({ modifiedCount: 1 });
    projectUpdateOne.mockResolvedValue({ modifiedCount: 1 });
    runFindOne.mockResolvedValue({
      _id: "failed-run-1",
      project_id: "project-1",
      status: "failed",
      dispatch: {
        endpoint: "/ingest",
        webexMeetings: [
          {
            id: "meeting-1",
            title: "Weekly sync",
            start: "2026-09-01T10:00:00Z",
            transcript: "Meeting transcript",
          },
        ],
      },
    });
    mockGetCollection.mockImplementation(async (name: string) =>
      name === "projects"
        ? { updateOne: projectUpdateOne }
        : {
            findOne: occurrenceFindOne,
            findOneAndUpdate: occurrenceFindOneAndUpdate,
            updateOne: occurrenceUpdateOne,
          },
    );
    mockGetTomeIngestRunsCollection.mockResolvedValue({ findOne: runFindOne });
    mockEnqueueRun.mockResolvedValue("retry-run-1");
  });

  it("replays a failed meeting run as a new meeting-only run", async () => {
    const response = await POST(
      new NextRequest(
        "http://example.test/api/tome/projects/example-project/webex-meeting-series/retry",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ occurrenceId: "occurrence-1" }),
        },
      ),
      context,
    );
    const body = await response.json();

    expect(response.status).toBe(202);
    expect(body.data).toMatchObject({
      occurrenceId: "occurrence-1",
      previousRunId: "failed-run-1",
      runId: "retry-run-1",
      status: "queued",
    });
    expect(mockEnqueueRun).toHaveBeenCalledWith(
      expect.objectContaining({ _id: "project-1" }),
      expect.objectContaining({
        sub: "retry-user-sub",
        email: "editor@example.test",
        triggeredBy: "manual",
        dispatch: expect.objectContaining({
          endpoint: "/ingest",
          sourceScope: "webex_meetings",
          mode: "quick",
          meetingOccurrenceId: "occurrence-1",
          webexMeetings: [expect.objectContaining({ transcript: "Meeting transcript" })],
        }),
      }),
    );
    expect(occurrenceUpdateOne).toHaveBeenCalledWith(
      expect.objectContaining({ _id: "occurrence-1", status: "processing" }),
      expect.objectContaining({
        $set: expect.objectContaining({
          status: "queued",
          run_id: "retry-run-1",
          last_error: "",
        }),
      }),
    );
    expect(mockAuditTome).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "tome.webex_meeting_series.retry",
        metadata: expect.objectContaining({
          previous_run_id: "failed-run-1",
          retry_run_id: "retry-run-1",
        }),
      }),
    );
  });

  it("does not retry a run that is not failed", async () => {
    runFindOne.mockResolvedValue(null);

    const response = await POST(
      new NextRequest(
        "http://example.test/api/tome/projects/example-project/webex-meeting-series/retry",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ occurrenceId: "occurrence-1" }),
        },
      ),
      context,
    );

    expect(response.status).toBe(409);
    expect(mockEnqueueRun).not.toHaveBeenCalled();
    expect(occurrenceFindOneAndUpdate).not.toHaveBeenCalled();
  });
});
