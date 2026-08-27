import nextConfig from "../../../../next.config";

describe("Agentic App runtime security headers", () => {
  it("allows only the same-origin runtime gateway to be framed", async () => {
    const entries = await nextConfig.headers?.();
    expect(entries).toBeDefined();

    const defaultHeaders = entries?.find(
      (entry) => entry.source === "/((?!api/agentic-apps/runtime/).*)",
    );
    expect(defaultHeaders?.headers).toContainEqual({
      key: "X-Frame-Options",
      value: "DENY",
    });

    const runtimeHeaders = entries?.find(
      (entry) => entry.source === "/api/agentic-apps/runtime/(.*)",
    );
    expect(runtimeHeaders?.headers).toContainEqual({
      key: "X-Frame-Options",
      value: "SAMEORIGIN",
    });
  });
});
