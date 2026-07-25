/**
 * @jest-environment node
 */

import { ObjectId } from "mongodb";

const mockInsertOne = jest.fn().mockResolvedValue({ insertedId: new ObjectId() });
const mockGetCollection = jest.fn().mockResolvedValue({ insertOne: mockInsertOne });

let mockIsMongoDBConfigured = true;
jest.mock("@/lib/mongodb", () => ({
  getCollection: (...args: unknown[]) => mockGetCollection(...args),
  get isMongoDBConfigured() {
    return mockIsMongoDBConfigured;
  },
}));

jest.spyOn(console, "warn").mockImplementation(() => {});

import { recordProblemReportFeedback } from "@/lib/feedback-report-store";

describe("recordProblemReportFeedback", () => {
  beforeEach(() => {
    mockInsertOne.mockClear();
    mockGetCollection.mockClear();
    mockIsMongoDBConfigured = true;
  });

  it("inserts report feedback with GitHub ticket metadata", async () => {
    await recordProblemReportFeedback({
      description: "Button does not work",
      userEmail: "user@example.com",
      contextUrl: "https://example.test/projects/acme",
      source: "tome-product",
      area: "TOME",
      issueType: "Bug",
      tomeContext: { projectSlug: "acme", pagePath: "wiki/README.md" },
      ticket: {
        id: "123",
        url: "https://github.com/org/repo/issues/42",
        number: 42,
        provider: "github",
      },
    });

    expect(mockGetCollection).toHaveBeenCalledWith("feedback");
    expect(mockInsertOne).toHaveBeenCalledWith(
      expect.objectContaining({
        source: "report",
        rating: "negative",
        value: "TOME",
        comment: "Button does not work",
        user_email: "user@example.com",
        context_url: "https://example.test/projects/acme",
        report_kind: "tome-product",
        report_area: "TOME",
        report_issue_type: "Bug",
        tome_project_slug: "acme",
        tome_page_path: "wiki/README.md",
        ticket_provider: "github",
        ticket_id: "123",
        ticket_url: "https://github.com/org/repo/issues/42",
        ticket_number: 42,
      }),
    );
  });

  it("uses feedback reason as value for chat-feedback reports", async () => {
    await recordProblemReportFeedback({
      description: "Sources look wrong",
      userEmail: "user@example.com",
      contextUrl: "https://example.test/chat/abc",
      source: "chat-feedback",
      feedbackContext: {
        feedbackType: "dislike",
        reason: "Trust",
      },
      ticket: {
        id: "456",
        url: "https://github.com/org/repo/issues/43",
        number: 43,
        provider: "github",
      },
    });

    expect(mockInsertOne).toHaveBeenCalledWith(
      expect.objectContaining({
        value: "Trust",
        feedback_type: "dislike",
      }),
    );
  });

  it("skips insert when MongoDB is not configured", async () => {
    mockIsMongoDBConfigured = false;

    await recordProblemReportFeedback({
      description: "x",
      userEmail: "user@example.com",
      contextUrl: "https://example.test",
      source: "header",
      ticket: {
        id: "1",
        url: "https://github.com/org/repo/issues/1",
        number: 1,
        provider: "github",
      },
    });

    expect(mockGetCollection).not.toHaveBeenCalled();
  });
});
