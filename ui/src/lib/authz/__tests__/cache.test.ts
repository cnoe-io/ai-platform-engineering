/**
 * @jest-environment node
 */
import { BoundedTtlCache } from "../cache";

describe("BoundedTtlCache", () => {
  let now = 1000;
  beforeEach(() => {
    now = 1000;
    jest.spyOn(Date, "now").mockImplementation(() => now);
  });
  afterEach(() => jest.restoreAllMocks());

  it("returns a value within its TTL", () => {
    const c = new BoundedTtlCache<string>(10, 100);
    c.set("k", "v");
    now = 1050;
    expect(c.get("k")).toBe("v");
  });

  it("expires a value after its TTL", () => {
    const c = new BoundedTtlCache<string>(10, 100);
    c.set("k", "v");
    now = 1101;
    expect(c.get("k")).toBeUndefined();
  });

  it("honors a per-entry TTL override", () => {
    const c = new BoundedTtlCache<string>(10, 10_000);
    c.set("k", "v", 10);
    now = 1011;
    expect(c.get("k")).toBeUndefined();
  });

  it("evicts the oldest entry when over capacity", () => {
    const c = new BoundedTtlCache<number>(2, 1000);
    c.set("a", 1);
    c.set("b", 2);
    c.set("c", 3); // evicts "a"
    expect(c.get("a")).toBeUndefined();
    expect(c.get("b")).toBe(2);
    expect(c.get("c")).toBe(3);
  });

  it("refreshes LRU order on get (recently-read survives eviction)", () => {
    const c = new BoundedTtlCache<number>(2, 1000);
    c.set("a", 1);
    c.set("b", 2);
    expect(c.get("a")).toBe(1); // "a" is now most-recently-used
    c.set("c", 3); // evicts least-recently-used "b"
    expect(c.get("b")).toBeUndefined();
    expect(c.get("a")).toBe(1);
    expect(c.get("c")).toBe(3);
  });

  it("clear() drops everything", () => {
    const c = new BoundedTtlCache<number>(10, 1000);
    c.set("a", 1);
    c.clear();
    expect(c.get("a")).toBeUndefined();
  });

  it("delete() removes a single entry", () => {
    const c = new BoundedTtlCache<number>(10, 1000);
    c.set("a", 1);
    c.set("b", 2);
    c.delete("a");
    expect(c.get("a")).toBeUndefined();
    expect(c.get("b")).toBe(2);
  });

  it("size reflects the number of entries", () => {
    const c = new BoundedTtlCache<number>(10, 1000);
    expect(c.size).toBe(0);
    c.set("a", 1);
    c.set("b", 2);
    expect(c.size).toBe(2);
    c.delete("a");
    expect(c.size).toBe(1);
  });
});
