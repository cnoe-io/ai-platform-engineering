import { fireEvent, render, screen, waitFor } from "@testing-library/react";

import { WebexMeetingSeriesSettings } from "../WebexMeetingSeriesSettings";

describe("WebexMeetingSeriesSettings", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        success: true,
        data: {
          subscriptions: [
            {
              id: "subscription-1",
              enabled: true,
              seriesKey: "series-1",
              seriesSlug: "weekly-sync",
              title: "Weekly sync",
              sourceRefs: {},
              credentialOwner: {
                subject: "user-1",
                email: "owner@example.test",
                name: "Example Owner",
                confirmedAt: "2026-08-01T09:00:00Z",
              },
              createdAt: "2026-08-01T09:00:00Z",
              lastStatus: "waiting_transcript",
              lastError: "Webex has not exposed an official meeting occurrence yet.",
            },
          ],
          occurrences: [
            {
              id: "occurrence-1",
              subscriptionId: "subscription-1",
              title: "Weekly sync",
              start: "2026-09-01T10:00:00Z",
              end: "2026-09-01T11:00:00Z",
              status: "queued",
              transcriptFound: true,
              transcriptCount: 2,
              runId: "run-1",
              runStatus: "awaiting_review",
              reportId: "report-1",
              logLines: 12,
            },
          ],
        },
      }),
    }) as jest.Mock;
  });

  it("expands a series into occurrence transcript, review, and log details", async () => {
    render(<WebexMeetingSeriesSettings slug="example-project" canEdit />);

    const expand = await screen.findByRole("button", {
      name: "Expand occurrence history for Weekly sync",
    });
    expect(screen.queryByText("2 transcripts found")).not.toBeInTheDocument();
    expect(screen.getByText("Waiting for meeting transcript.")).toHaveClass("text-amber-600");
    expect(
      screen.queryByText("Webex has not exposed an official meeting occurrence yet."),
    ).not.toBeInTheDocument();

    fireEvent.click(expand);

    expect(screen.getByText("2 transcripts found")).toBeInTheDocument();
    expect(screen.getByText("Awaiting review")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Review/ })).toHaveAttribute(
      "href",
      "/projects/example-project/tome/ingest/run-1/review",
    );
    expect(screen.getByRole("link", { name: /Logs \(12\)/ })).toHaveAttribute(
      "href",
      "/projects/example-project/tome/ingest/run-1",
    );
    await waitFor(() => expect(global.fetch).toHaveBeenCalledTimes(1));
  });

  it("warns before adding a series hosted by someone else", async () => {
    (global.fetch as jest.Mock).mockImplementation(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if (init?.method === "POST") {
          return {
            ok: true,
            json: async () => ({
              success: true,
              data: {
                subscription: {
                  id: "subscription-guest",
                  enabled: true,
                  seriesKey: "series-guest",
                  seriesSlug: "guest-sync",
                  title: "Guest sync",
                  sourceRefs: {},
                  credentialOwner: {
                    subject: "user-1",
                    email: "attendee@example.test",
                    name: "Example Attendee",
                    confirmedAt: "2026-09-03T09:00:00Z",
                  },
                  createdAt: "2026-09-03T09:00:00Z",
                  lastStatus: "pending",
                },
              },
            }),
          };
        }
        return {
          ok: true,
          json: async () => ({
            success: true,
            data: url.includes("discover=1")
              ? {
                  subscriptions: [],
                  candidates: [
                    {
                      seriesKey: "series-guest",
                      title: "Guest sync",
                      hostEmail: "host@example.test",
                      sources: ["userhub_calendar"],
                      canAutoIngest: false,
                      unavailableReason: "Recording access is required.",
                    },
                  ],
                }
              : { subscriptions: [], occurrences: [] },
          }),
        };
      },
    );

    render(<WebexMeetingSeriesSettings slug="example-project" canEdit />);
    fireEvent.click(await screen.findByRole("button", { name: "Add series" }));
    fireEvent.click(await screen.findByRole("button", { name: "Add" }));

    expect(await screen.findByText("Recording access required")).toBeInTheDocument();
    expect(screen.getByText(/calendar invitation or attendance alone/i)).toBeInTheDocument();
    expect(
      (global.fetch as jest.Mock).mock.calls.filter(([, init]) => init?.method === "POST"),
    ).toHaveLength(0);

    fireEvent.click(screen.getByRole("button", { name: "Add with warning" }));

    await waitFor(() =>
      expect(
        (global.fetch as jest.Mock).mock.calls.filter(([, init]) => init?.method === "POST"),
      ).toHaveLength(1),
    );
  });

  it("disables adding a non-hosted series when the server policy is off", async () => {
    (global.fetch as jest.Mock).mockImplementation(async (input: RequestInfo | URL) => {
      const url = String(input);
      return {
        ok: true,
        json: async () => ({
          success: true,
          data: url.includes("discover=1")
            ? {
                subscriptions: [],
                allowNonHostSeries: false,
                candidates: [
                  {
                    seriesKey: "series-guest",
                    title: "Guest sync",
                    hostEmail: "host@example.test",
                    sources: ["userhub_calendar"],
                    canAutoIngest: false,
                  },
                ],
              }
            : { subscriptions: [], occurrences: [] },
        }),
      };
    });

    render(<WebexMeetingSeriesSettings slug="example-project" canEdit />);
    fireEvent.click(await screen.findByRole("button", { name: "Add series" }));

    expect(await screen.findByText("Disabled")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Add" })).toBeDisabled();
    expect(screen.queryByText("Recording access required")).not.toBeInTheDocument();
  });
});
