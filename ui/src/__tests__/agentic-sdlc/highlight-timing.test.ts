import {
  REPO_UPDATE_HIGHLIGHT_CLASS,
  REPO_UPDATE_HIGHLIGHT_MS,
} from "@/lib/agentic-sdlc/highlight-timing";

describe("Agentic SDLC highlight timing", () => {
  it("keeps repo update halos visible for 30 seconds", () => {
    expect(REPO_UPDATE_HIGHLIGHT_MS).toBe(30_000);
  });

  it("uses a subtle event highlight instead of a full-row flashing pulse", () => {
    expect(REPO_UPDATE_HIGHLIGHT_CLASS).toContain("ring-1");
    expect(REPO_UPDATE_HIGHLIGHT_CLASS).not.toContain("ring-2");
    expect(REPO_UPDATE_HIGHLIGHT_CLASS).not.toContain("animate-pulse");
    expect(REPO_UPDATE_HIGHLIGHT_CLASS).not.toContain("90px");
  });
});
