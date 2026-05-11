import { REPO_UPDATE_HIGHLIGHT_MS } from "@/lib/agentic-sdlc/highlight-timing";

describe("Agentic SDLC highlight timing", () => {
  it("keeps repo update halos visible for 30 seconds", () => {
    expect(REPO_UPDATE_HIGHLIGHT_MS).toBe(30_000);
  });
});
