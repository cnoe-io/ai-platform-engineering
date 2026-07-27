import { buildMcpRemoteOAuthArgs } from "../manifest";

describe("buildMcpRemoteOAuthArgs", () => {
  it("returns endpoint, callback port, http-only transport, and static oauth client info", () => {
    const args = buildMcpRemoteOAuthArgs({
      endpoint: "https://caipe.example.com/api/tome/mcp",
      allowHttp: false,
    });
    expect(args).toEqual([
      "https://caipe.example.com/api/tome/mcp",
      "8085",
      "--transport",
      "http-only",
      "--static-oauth-client-info",
      JSON.stringify({ client_id: "caipe-cli" }),
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
