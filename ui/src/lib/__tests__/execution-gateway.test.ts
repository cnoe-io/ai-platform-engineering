import { buildProxyTargetUrl } from "@/lib/agentic-apps/execution-gateway";

describe("buildProxyTargetUrl", () => {
  it("keeps a trailing slash for a preserved mount root", () => {
    expect(
      buildProxyTargetUrl(
        "http://agentic-app.example.svc:8080",
        [],
        "https://grid.example.test/apps/example-app",
        {
          preserveMountPath: true,
          mountPath: "/apps/example-app",
        },
      ),
    ).toBe("http://agentic-app.example.svc:8080/apps/example-app/");
  });

  it("preserves nested paths under the mount", () => {
    expect(
      buildProxyTargetUrl(
        "http://agentic-app.example.svc:8080",
        ["assets", "bundle.js"],
        "https://grid.example.test/apps/example-app/assets/bundle.js",
        {
          preserveMountPath: true,
          mountPath: "/apps/example-app",
        },
      ),
    ).toBe("http://agentic-app.example.svc:8080/apps/example-app/assets/bundle.js");
  });
});
