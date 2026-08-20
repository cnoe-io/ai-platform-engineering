import { buildUserFeedbackTitle } from "@/lib/feedback-ticket-title";

describe("buildUserFeedbackTitle", () => {
  it("builds the canonical user feedback title", () => {
    expect(buildUserFeedbackTitle({
      description: "  The button\n  does not work.  ",
      area: "TOME",
      type: "Bug",
    })).toBe("[User Feedback][TOME][Bug]: The button does not work.");
  });

  it("caps the complete provider title at 240 characters", () => {
    const title = buildUserFeedbackTitle({
      description: "x".repeat(300),
      area: "Chat",
      type: "Enhancement",
    });

    expect(title).toHaveLength(240);
    expect(title.endsWith("…")).toBe(true);
  });
});
