import { buildMcpRemoteOAuthArgs } from "../manifest";

describe("buildMcpRemoteOAuthArgs", () => {
  it("returns endpoint and http-only transport without static OAuth client info", () => {
    const args = buildMcpRemoteOAuthArgs({
      endpoint: "https://caipe.example.com/api/tome/mcp",
      allowHttp: false,
    });
    expect(args).toEqual([
      "https://caipe.example.com/api/tome/mcp",
      "--transport",
      "http-only",
    ]);
  });

  it("appends --allow-http only when allowHttp is true", () => {
    expect(
      buildMcpRemoteOAuthArgs({ endpoint: "http://localhost:3000/api/tome/mcp", allowHttp: true }),
    ).toContain("--allow-http");
    expect(
      buildMcpRemoteOAuthArgs({ endpoint: "https://caipe.example.com/api/tome/mcp", allowHttp: false }),
    ).not.toContain("--allow-http");
  });
});
