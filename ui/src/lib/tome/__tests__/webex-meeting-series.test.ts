import {
  downloadMeetingTranscript,
  meetingSeriesMatches,
  meetingSeriesHostEligibility,
  meetingSeriesSlug,
  normalizeMeetingSeries,
  readMcpToolJson,
  resolveOccurrenceMeetingId,
  resolveOccurrenceMeeting,
  webexMcpToolArguments,
} from "../webex-meeting-series";

jest.mock("@/lib/mcp-http-server-client", () => ({
  invokeDirectHttpMcpTool: jest.fn(),
  invokeHttpMcpTool: jest.fn(),
}));
jest.mock("@/lib/mcp-credential-headers", () => ({
  resolveMcpHeaderCredentials: jest.fn(),
}));
jest.mock("@/lib/mongodb", () => ({ getCollection: jest.fn() }));
jest.mock("@/lib/projects/onboarding-providers", () => ({
  collectForwardedCredentials: jest.fn(),
}));

describe("Webex recurring meeting discovery", () => {
  const now = new Date("2026-09-01T12:00:00Z");

  it("creates a stable wiki path segment", () => {
    expect(meetingSeriesSlug("Design Review (EMEA)", "series-1")).toBe("design-review-emea");
    expect(meetingSeriesSlug("✨", "series-1")).toMatch(/^meeting-/);
  });

  it("merges public Meetings and User Hub occurrences into one durable series", () => {
    const result = normalizeMeetingSeries({
      meetingSeries: {
        items: [
          {
            id: "series-1",
            meetingType: "meetingSeries",
            title: "Platform sync",
            hostEmail: "host@example.com",
            webLink: "https://cisco.webex.com/meet/platform-sync",
          },
        ],
      },
      scheduledMeetings: {
        items: [
          {
            id: "scheduled-1",
            meetingSeriesId: "series-1",
            meetingType: "scheduledMeeting",
            title: "Platform sync",
            start: "2026-09-02T10:00:00Z",
            end: "2026-09-02T11:00:00Z",
            webLink: "https://cisco.webex.com/meet/platform-sync",
          },
        ],
      },
      meetingInstances: {
        items: [
          {
            id: "actual-1",
            scheduledMeetingId: "scheduled-1",
            meetingType: "meeting",
            title: "Platform sync",
            start: "2026-09-02T10:00:00Z",
            end: "2026-09-02T11:00:00Z",
            webLink: "https://cisco.webex.com/meet/platform-sync",
          },
        ],
      },
      userHubCalendar: {
        siteUrl: "https://primary.webex.com",
        items: [
          {
            id: "calendar-occurrence",
            seriesId: "calendar-series",
            subject: "Platform sync",
            start: "2026-09-02T10:00:00Z",
            end: "2026-09-02T11:00:00Z",
            webLink: "https://cisco.webex.com/meet/platform-sync?foo=bar",
          },
        ],
      },
      now,
    });

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      seriesKey: "webex:series-1",
      sources: ["meetings_api", "userhub_calendar"],
      sourceRefs: {
        meetingSeriesId: "series-1",
        scheduledMeetingId: "scheduled-1",
        userHubSeriesId: "calendar-series",
      },
      hostEmail: "host@example.com",
      siteUrl: "https://primary.webex.com",
    });
    expect(result[0].occurrences).toHaveLength(1);
    expect(result[0].occurrences[0].meetingId).toBe("actual-1");
  });

  it("merges an early actual meeting with its nearby scheduled User Hub occurrence", () => {
    const result = normalizeMeetingSeries({
      meetingSeries: {
        items: [
          {
            id: "series-1",
            meetingType: "meetingSeries",
            title: "Happy Testing Weekly Meeting",
            hostEmail: "host@example.test",
          },
        ],
      },
      scheduledMeetings: { items: [] },
      meetingInstances: {
        items: [
          {
            id: "actual-1",
            meetingSeriesId: "series-1",
            meetingType: "meeting",
            title: "Happy Testing Weekly Meeting",
            start: "2026-09-03T12:31:24Z",
            end: "2026-09-03T12:32:49Z",
          },
        ],
      },
      userHubCalendar: {
        items: [
          {
            id: "calendar-1",
            seriesId: "calendar-series-1",
            subject: "Happy Testing Weekly Meeting",
            organizerEmail: "host@example.test",
            start: "2026-09-03T12:35:00Z",
            end: "2026-09-03T12:45:00Z",
          },
        ],
      },
      now,
    });

    expect(result).toHaveLength(1);
    expect(result[0].occurrences).toEqual([
      expect.objectContaining({
        occurrenceKey: "actual-1",
        meetingId: "actual-1",
        start: "2026-09-03T12:31:24Z",
        source: "meetings_api",
      }),
    ]);
  });

  it("keeps distinct series that reuse the same personal-room link and meeting number", () => {
    const shared = {
      meetingNumber: "123456789",
      webLink: "https://cisco.webex.com/meet/shared-personal-room",
      hostEmail: "host@example.com",
    };
    const result = normalizeMeetingSeries({
      meetingSeries: {
        items: [
          { ...shared, id: "series-1", meetingType: "meetingSeries", title: "First sync" },
          { ...shared, id: "series-2", meetingType: "meetingSeries", title: "Second sync" },
        ],
      },
      scheduledMeetings: {
        items: [
          {
            ...shared,
            id: "scheduled-1",
            meetingSeriesId: "series-1",
            meetingType: "scheduledMeeting",
            title: "First sync",
            start: "2026-09-02T10:00:00Z",
            end: "2026-09-02T11:00:00Z",
          },
          {
            ...shared,
            id: "scheduled-2",
            meetingSeriesId: "series-2",
            meetingType: "scheduledMeeting",
            title: "Second sync",
            start: "2026-09-02T12:00:00Z",
            end: "2026-09-02T13:00:00Z",
          },
        ],
      },
      meetingInstances: { items: [] },
      userHubCalendar: { items: [] },
      now,
    });

    expect(result).toHaveLength(2);
    expect(result.map((item) => item.title)).toEqual(["First sync", "Second sync"]);
    expect(
      meetingSeriesMatches(result[0], {
        seriesKey: "webex:other",
        sourceRefs: {
          meetingSeriesId: "series-2",
          meetingNumber: shared.meetingNumber,
          webLink: shared.webLink,
        },
      }),
    ).toBe(false);
  });

  it("keeps a recurring series found only in User Hub and ignores one-off calendar rows", () => {
    const result = normalizeMeetingSeries({
      meetingSeries: { items: [] },
      scheduledMeetings: { items: [] },
      meetingInstances: { items: [] },
      userHubCalendar: {
        items: [
          {
            id: "recurring-1",
            seriesId: "hub-series-1",
            subject: "Design review",
            start: "2026-09-03T10:00:00Z",
            end: "2026-09-03T11:00:00Z",
            webLink: "https://cisco.webex.com/meet/design-review",
          },
          {
            id: "one-off",
            subject: "One-off",
            start: "2026-09-03T12:00:00Z",
            end: "2026-09-03T13:00:00Z",
          },
        ],
      },
      now,
    });

    expect(result).toHaveLength(1);
    expect(result[0].seriesKey).toBe("userhub:hub-series-1");
    expect(
      meetingSeriesMatches(result[0], {
        seriesKey: "old-key",
        sourceRefs: { webLink: "https://cisco.webex.com/meet/design-review/" },
      }),
    ).toBe(true);
  });

  it("uses an unmarked User Hub occurrence when the public series template is expired", () => {
    const result = normalizeMeetingSeries({
      meetingSeries: {
        items: [
          {
            id: "expired-series",
            meetingType: "meetingSeries",
            title: "OpenClaw UCL MSc Student Project Weekly Sync",
            hostEmail: "suwhang@cisco.com",
          },
        ],
      },
      scheduledMeetings: { items: [] },
      meetingInstances: { items: [] },
      userHubCalendar: {
        items: [
          {
            id: "calendar-occurrence-today",
            subject: "OpenClaw UCL MSc Student Project Weekly Sync",
            organizerEmail: "suwhang@cisco.com",
            start: "2026-09-01T17:00:00Z",
            end: "2026-09-01T18:00:00Z",
          },
        ],
      },
      now,
    });

    expect(result).toHaveLength(1);
    expect(result[0].sources).toEqual(["meetings_api", "userhub_calendar"]);
    expect(result[0].nextOccurrence).toMatchObject({
      occurrenceKey: "calendar-occurrence-today",
      start: "2026-09-01T17:00:00Z",
      end: "2026-09-01T18:00:00Z",
      source: "userhub_calendar",
    });
  });

  it("rejects timezone-less User Hub times instead of treating local wall time as UTC", () => {
    const result = normalizeMeetingSeries({
      meetingSeries: {
        items: [
          {
            id: "series-1",
            meetingType: "meetingSeries",
            title: "Example weekly",
            hostEmail: "host@example.test",
          },
        ],
      },
      scheduledMeetings: {
        items: [
          {
            id: "scheduled-1",
            meetingSeriesId: "series-1",
            meetingType: "scheduledMeeting",
            title: "Example weekly",
            start: "2026-09-03T12:30:00Z",
            end: "2026-09-03T13:00:00Z",
          },
        ],
      },
      meetingInstances: { items: [] },
      userHubCalendar: {
        items: [
          {
            id: "calendar-occurrence",
            subject: "Example weekly",
            organizerEmail: "host@example.test",
            start: "2026-09-03 05:30:00",
            end: "2026-09-03 06:00:00",
          },
        ],
      },
      now,
    });

    expect(result[0].occurrences).toHaveLength(1);
    expect(result[0].nextOccurrence).toMatchObject({
      occurrenceKey: "scheduled-1",
      start: "2026-09-03T12:30:00Z",
      end: "2026-09-03T13:00:00Z",
      source: "meetings_api",
    });
  });

  it("unwraps structured and text MCP tool responses", () => {
    expect(
      readMcpToolJson({
        jsonrpc: "2.0",
        result: { structuredContent: { result: { items: [{ id: "1" }] } } },
      }),
    ).toEqual({ items: [{ id: "1" }] });
    expect(
      readMcpToolJson({
        result: { content: [{ type: "text", text: '{"items":[{"id":"2"}]}' }] },
      }),
    ).toEqual({ items: [{ id: "2" }] });
  });

  it("wraps typed Webex MCP inputs in the FastMCP args parameter", () => {
    expect(webexMcpToolArguments({ meeting_type: "meetingSeries", max_results: 100 })).toEqual({
      args: { meeting_type: "meetingSeries", max_results: 100 },
    });
  });

  it("resolves a scheduled occurrence to an actual meeting before transcript lookup", async () => {
    const invoke = jest.fn().mockResolvedValue({
      items: [
        {
          id: "scheduled-1",
          meetingType: "scheduledMeeting",
          start: "2026-09-02T10:00:00Z",
        },
        {
          id: "actual-1",
          meetingType: "meeting",
          start: "2026-09-02T10:00:00Z",
        },
      ],
    });

    await expect(
      resolveOccurrenceMeetingId(invoke, {
        occurrenceKey: "scheduled-1",
        title: "Platform sync",
        start: "2026-09-02T10:00:00Z",
        end: "2026-09-02T11:00:00Z",
        webLink: "https://cisco.webex.com/meet/platform-sync",
        cancelled: false,
        source: "meetings_api",
      }),
    ).resolves.toBe("actual-1");
  });

  it("recognizes an official missed scheduled meeting without expecting a transcript", async () => {
    const invoke = jest.fn(async () => ({
      items: [
        {
          id: "scheduled-1",
          meetingType: "scheduledMeeting",
          state: "missed",
          start: "2026-09-01T10:00:00Z",
        },
      ],
    }));

    await expect(
      resolveOccurrenceMeeting(invoke, {
        occurrenceKey: "calendar-1",
        title: "Platform sync",
        start: "2026-09-01T10:00:00Z",
        end: "2026-09-01T11:00:00Z",
        webLink: "https://example.webex.com/meet/example",
        cancelled: false,
        source: "userhub_calendar",
      }),
    ).resolves.toEqual({ meetingId: null, missed: true });
  });

  it("downloads and merges every transcript segment in start-time order", async () => {
    const invoke = jest.fn().mockResolvedValue({
      items: [
        {
          id: "transcript-late",
          startTime: "2026-09-02T10:05:00Z",
          body: "Second segment",
        },
        {
          id: "transcript-early",
          startTime: "2026-09-02T10:00:00Z",
          body: "First segment",
        },
        {
          id: "transcript-processing",
          startTime: "2026-09-02T10:30:00Z",
          body: null,
        },
      ],
    });

    await expect(downloadMeetingTranscript(invoke, "meeting-1")).resolves.toEqual({
      transcript:
        "--- Webex transcript segment 1 of 2 · 2026-09-02T10:00:00Z ---\nFirst segment\n\n" +
        "--- Webex transcript segment 2 of 2 · 2026-09-02T10:05:00Z ---\nSecond segment",
      meetingId: "meeting-1",
      transcriptId: "transcript-early",
      transcriptIds: ["transcript-early", "transcript-late"],
      listedTranscriptIds: [
        "transcript-early",
        "transcript-late",
        "transcript-processing",
      ],
      listedCount: 3,
      downloadedCount: 2,
    });
    expect(invoke).toHaveBeenCalledWith("webex_list_transcripts", {
      meeting_id: "meeting-1",
      max_results: 100,
      download: true,
      download_format: "txt",
    });
  });

  it("locates a User Hub transcript by series occurrence when no instance id exists", async () => {
    const invoke = jest.fn().mockResolvedValue({
      items: [
        {
          id: "recording-1",
          meetingId: "resolved-instance-1",
          startTime: "2026-09-02T10:00:00Z",
          body: "Shared transcript",
        },
      ],
    });

    await expect(
      downloadMeetingTranscript(invoke, {
        meetingId: null,
        title: "Weekly sync",
        start: "2026-09-02T10:00:00Z",
        siteUrl: "https://primary.webex.com",
      }),
    ).resolves.toMatchObject({
      transcript: "Shared transcript",
      meetingId: "resolved-instance-1",
    });
    expect(invoke).toHaveBeenCalledWith("webex_list_transcripts", {
      meeting_title: "Weekly sync",
      meeting_start: "2026-09-02T10:00:00Z",
      site_url: "https://primary.webex.com",
      max_results: 100,
      download: true,
      download_format: "txt",
    });
  });

  it("allows only the meeting host to configure transcript auto-ingest", () => {
    const [candidate] = normalizeMeetingSeries({
      meetingSeries: {
        items: [
          {
            id: "series-1",
            meetingType: "meetingSeries",
            title: "Platform sync",
            hostEmail: "Host@Example.com",
          },
        ],
      },
      scheduledMeetings: { items: [] },
      meetingInstances: { items: [] },
      userHubCalendar: { items: [] },
      now,
    });

    expect(meetingSeriesHostEligibility(candidate, "host@example.com")).toEqual({
      canAutoIngest: true,
    });
    expect(meetingSeriesHostEligibility(candidate, "attendee@example.com")).toMatchObject({
      canAutoIngest: false,
    });
  });
});
