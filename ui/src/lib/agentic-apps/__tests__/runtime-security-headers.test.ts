import nextConfig from "../../../../next.config";

describe("Agentic App runtime security headers", () => {
  it("allows only same-origin hosted-app surfaces to be framed", async () => {
    const entries = await nextConfig.headers?.();
    expect(entries).toBeDefined();

    const defaultHeaders = entries?.find(
      (entry) => entry.source === "/((?!apps(?:/|$)|api/agentic-apps/runtime/).*)",
    );
    expect(defaultHeaders?.headers).toContainEqual({
      key: "X-Frame-Options",
      value: "DENY",
    });

    const appHeaders = entries?.find((entry) => entry.source === "/apps/:path*");
    expect(appHeaders?.headers).toContainEqual({
      key: "X-Frame-Options",
      value: "SAMEORIGIN",
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
