/**
 * @jest-environment node
 *
 * assisted-by Codex Codex-sonnet-4-6
 */

import { ApiError } from "@/lib/api-error";
import { parseAgenticPackageCatalogInput } from "@/lib/agentic-apps/package-catalog-input";

describe("parseAgenticPackageCatalogInput", () => {
  it("returns undefined when catalog is omitted", () => {
    expect(parseAgenticPackageCatalogInput(undefined)).toBeUndefined();
  });

  it("returns empty object for explicit empty object", () => {
    expect(parseAgenticPackageCatalogInput({})).toEqual({});
  });

  it("accepts only categories and capabilities as string arrays", () => {
    expect(
      parseAgenticPackageCatalogInput({
        categories: ["cost"],
        capabilities: ["read"],
      }),
    ).toEqual({ categories: ["cost"], capabilities: ["read"] });
  });

  it("rejects unknown keys with 400", () => {
    expect(() =>
      parseAgenticPackageCatalogInput({ categories: ["x"], extra: "nope" }),
    ).toThrow(ApiError);
    expect(() =>
      parseAgenticPackageCatalogInput({ categories: ["x"], extra: "nope" }),
    ).toThrow(/unknown key "extra"/);
  });

  it("rejects non-string array elements", () => {
    expect(() =>
      parseAgenticPackageCatalogInput({ categories: [1, 2] } as unknown),
    ).toThrow(/categories must be an array of strings/);
  });

  it("rejects null catalog", () => {
    expect(() => parseAgenticPackageCatalogInput(null)).toThrow(ApiError);
  });
});
