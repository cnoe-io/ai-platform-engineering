const mockProjectSlugsForRepository = jest.fn();
const mockIsMyceliumConfigured = jest.fn();
const mockPostEvent = jest.fn();

jest.mock("@/lib/github-webhooks/tome-issue-cache", () => ({
  projectSlugsForRepository: (...args: unknown[]) =>
    mockProjectSlugsForRepository(...args),
}));
jest.mock("@/lib/tome/mycelium", () => ({
  isMyceliumConfigured: (...args: unknown[]) => mockIsMyceliumConfigured(...args),
  postEvent: (...args: unknown[]) => mockPostEvent(...args),
}));

import { emitLabelChangeToFeed } from "@/lib/tome/source-feed/webhook";

const baseChange = {
  repoId: 123,
  repoFullName: "example/service",
  action: "labeled" as const,
  artifact: "issue" as const,
  number: 42,
  title: "Example issue",
  url: "https://github.com/example/service/issues/42",
  labels: ["bug"],
  labelName: "bug",
  actor: "test-user",
  ts: "2026-08-28T00:00:00.000Z",
};

describe("webhook label change → Feed bridge", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockIsMyceliumConfigured.mockReturnValue(true);
    mockProjectSlugsForRepository.mockResolvedValue(["caipe"]);
    mockPostEvent.mockResolvedValue({});
  });

  it("posts a source_event describing the added label", async () => {
    await emitLabelChangeToFeed(baseChange);

    expect(mockProjectSlugsForRepository).toHaveBeenCalledWith(123, "example/service");
    expect(mockPostEvent).toHaveBeenCalledWith(
      "caipe",
      expect.objectContaining({
        sender_handle: "github",
        content: 'Issue label added: `bug` on "Example issue" (#42)',
        kind: "source_event",
        payload: expect.objectContaining({
          source: "github",
          artifact: "issue",
          event: "label_added",
          repo: "example/service",
          ref: "example/service#42",
          labels: ["bug"],
        }),
      }),
    );
  });

  it("describes an unlabel as removed", async () => {
    await emitLabelChangeToFeed({ ...baseChange, action: "unlabeled", labels: [] });

    expect(mockPostEvent).toHaveBeenCalledWith(
      "caipe",
      expect.objectContaining({
        content: 'Issue label removed: `bug` on "Example issue" (#42)',
        payload: expect.objectContaining({ event: "label_removed" }),
      }),
    );
  });

  it("reads a status-alias label as an in-progress transition", async () => {
    await emitLabelChangeToFeed({
      ...baseChange,
      artifact: "pr",
      labelName: "status:in-progress",
    });

    expect(mockPostEvent).toHaveBeenCalledWith(
      "caipe",
      expect.objectContaining({
        content: 'PR moved to In Progress: "Example issue" (#42)',
      }),
    );
  });

  it("reverses the status wording when the status label is removed", async () => {
    await emitLabelChangeToFeed({
      ...baseChange,
      action: "unlabeled",
      labelName: "status:in-progress",
    });

    expect(mockPostEvent).toHaveBeenCalledWith(
      "caipe",
      expect.objectContaining({
        content: 'Issue moved to Open: "Example issue" (#42)',
      }),
    );
  });

  it("fans out to every project the repo is attached to", async () => {
    mockProjectSlugsForRepository.mockResolvedValue(["caipe", "platform"]);

    await emitLabelChangeToFeed(baseChange);

    expect(mockPostEvent).toHaveBeenCalledTimes(2);
    expect(mockPostEvent).toHaveBeenCalledWith("caipe", expect.anything());
    expect(mockPostEvent).toHaveBeenCalledWith("platform", expect.anything());
  });

  it("no-ops when Mycelium isn't configured", async () => {
    mockIsMyceliumConfigured.mockReturnValue(false);

    await emitLabelChangeToFeed(baseChange);

    expect(mockProjectSlugsForRepository).not.toHaveBeenCalled();
    expect(mockPostEvent).not.toHaveBeenCalled();
  });

  it("no-ops when the repo isn't attached to any project", async () => {
    mockProjectSlugsForRepository.mockResolvedValue([]);

    await emitLabelChangeToFeed(baseChange);

    expect(mockPostEvent).not.toHaveBeenCalled();
  });
});
