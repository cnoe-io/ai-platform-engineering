import {
  meetingSeriesMatches,
  meetingSeriesSlug,
  normalizeMeetingSeries,
  readMcpToolJson,
  webexMcpToolArguments,
} from "../webex-meeting-series";

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
    });
    expect(result[0].occurrences).toHaveLength(1);
    expect(result[0].occurrences[0].meetingId).toBe("actual-1");
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
});
