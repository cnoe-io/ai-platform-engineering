import { shouldAwaitIngestReview } from "../ingest-review";

describe("shouldAwaitIngestReview", () => {
  it("auto-completes a run when review is explicitly skipped", () => {
    expect(
      shouldAwaitIngestReview({
        skipReview: true,
        draftPaths: ["charter.md"],
      }),
    ).toBe(false);
  });

  it("auto-completes a run when the configured review mode produced no drafts", () => {
    expect(
      shouldAwaitIngestReview({
        skipReview: false,
        draftPaths: [],
      }),
    ).toBe(false);
  });

  it("waits for review when the run produced drafts", () => {
    expect(
      shouldAwaitIngestReview({
        skipReview: false,
        draftPaths: ["charter.md"],
      }),
    ).toBe(true);
  });
});
