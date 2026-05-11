/**
 * @jest-environment node
 *
 * assisted-by Codex Codex-sonnet-4-6
 */

describe("Agentic SDLC external reference runtime", () => {
  it("renders a standalone HTML surface and exposes a server factory", async () => {
    const runtime = await import("../../../apps/agentic-sdlc/server.mjs");

    expect(typeof runtime.createAgenticSdlcReferenceServer).toBe("function");
    const html = runtime.renderAgenticSdlcHome();
    expect(html).toContain("Agentic SDLC");
    expect(html).toContain("/api/v1/chat/invoke");
    expect(html).toContain("agentic-sdlc");
    expect(html).toContain("delivery-dashboard");
    expect(html).toContain("caipe.agenticApp.context.v1");
  });
});
