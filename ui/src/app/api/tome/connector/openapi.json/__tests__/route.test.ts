/** @jest-environment node */

import { NextRequest } from "next/server";

jest.mock("@/lib/tome/guard", () => ({
  isTomeServerEnabled: () => true,
}));

import { GET } from "../route";

describe("TOME REST connector OpenAPI document", () => {
  it("describes individual REST operations and API-key security", async () => {
    const response = GET(
      new NextRequest("https://example.test/api/tome/connector/openapi.json"),
    );
    const document = await response.json();

    expect(response.status).toBe(200);
    expect(document.servers).toEqual([
      { url: "https://example.test/api/tome/connector" },
    ]);
    expect(Object.keys(document.paths)).toEqual(["/version"]);
    expect(document.paths["/version"].get.operationId).toBe("getTomeVersion");
    expect(document.paths["/version"].get.security).toEqual([{ TomeApiKey: [] }]);
    expect(document.components.securitySchemes.TomeApiKey).toEqual(
      expect.objectContaining({
        type: "apiKey",
        in: "header",
        name: "x-caipe-token",
      }),
    );
  });
});
