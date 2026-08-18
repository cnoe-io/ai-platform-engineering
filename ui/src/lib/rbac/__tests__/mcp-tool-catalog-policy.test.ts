/** @jest-environment node */

import { canonicalJson, sanitizeMcpInputSchema } from "../mcp-tool-catalog";

jest.mock("@/lib/mongodb", () => ({ getCollection: jest.fn() }));

describe("MCP policy schema catalog", () => {
  it("hashes equivalent schemas identically regardless of key order", () => {
    const left = sanitizeMcpInputSchema({
      type: "object",
      required: ["project"],
      properties: { count: { type: "integer" }, project: { type: "string" } },
    });
    const right = sanitizeMcpInputSchema({
      properties: { project: { type: "string" }, count: { type: "integer" } },
      required: ["project"],
      type: "object",
    });
    expect(left?.schemaHash).toBe(right?.schemaHash);
    expect(left?.schemaHash).toMatch(/^sha256:[a-f0-9]{64}$/);
  });

  it("uses RFC 6901 pointers and excludes sensitive or unsupported fields", () => {
    const result = sanitizeMcpInputSchema({
      type: "object",
      properties: {
        "project/key": { type: "string" },
        active: { type: "boolean" },
        access_token: { type: "string" },
        ratio: { type: "number" },
        labels: { type: "array", items: { type: "string" } },
      },
    });
    expect(result?.eligibleFields).toEqual([
      { pointer: "/active", type: "boolean", required: false },
      { pointer: "/project~1key", type: "string", required: false },
    ]);
  });

  it("keeps code-like enum values as inert schema data", () => {
    const result = sanitizeMcpInputSchema({
      type: "object",
      properties: { project: { type: "string", enum: ["x == y", "request.drop()"] } },
    });
    expect(canonicalJson(result?.schema)).toContain("request.drop()");
    expect(result?.eligibleFields).toHaveLength(1);
  });
});
