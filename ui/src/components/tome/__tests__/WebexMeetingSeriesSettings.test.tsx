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
    expect(screen.queryByText("2 transcripts")).not.toBeInTheDocument();

    fireEvent.click(expand);

    expect(screen.getByText("2 transcripts")).toBeInTheDocument();
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
});
