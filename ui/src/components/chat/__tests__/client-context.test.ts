import { buildChatClientContext } from "../client-context";

describe("buildChatClientContext", () => {
  it("includes generic page context when sending or resuming chat", () => {
    const context = buildChatClientContext(
      { mode: "team" },
      { source: "agentic-sdlc", screen: "repo-detail", repo: "sri-speckit-test" },
    );

    expect(context).toEqual({
      source: "agentic-sdlc",
      chat_sharing: { mode: "team" },
      screen: "repo-detail",
      repo: "sri-speckit-test",
    });
  });

  it("defaults to webui when no page context is provided", () => {
    expect(buildChatClientContext()).toEqual({ source: "webui" });
  });
});
