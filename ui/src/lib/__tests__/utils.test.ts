/**
 * Unit tests for shared utility functions.
 *
 * Tests cover:
 * - deduplicateByKey: Message deduplication for React key collision prevention
 * - formatTimestamp: Date formatting for chat messages
 * - formatDate: Date formatting for headers
 * - generateId: UUID generation
 * - truncateText: Text truncation with ellipsis
 * - parseSSELine: SSE line parsing
 *
 * @jest-environment node
 */

import {
  deduplicateByKey,
  formatTimestamp,
  formatDate,
  generateId,
  truncateText,
  parseSSELine,
} from "../utils";

// ─────────────────────────────────────────────────────────────────────────────
// deduplicateByKey
// ─────────────────────────────────────────────────────────────────────────────
describe("deduplicateByKey", () => {
  // Minimal message type matching the chat store's Message shape
  interface TestMessage {
    id: string;
    role: "user" | "assistant";
    content: string;
    created_at?: string;
  }

  it("should return an empty array when given an empty array", () => {
    const result = deduplicateByKey<TestMessage>([], (m) => m.id);
    expect(result).toEqual([]);
    expect(result).toHaveLength(0);
  });

  it("should return the same array when there are no duplicates", () => {
    const messages: TestMessage[] = [
      { id: "a", role: "user", content: "hello" },
      { id: "b", role: "assistant", content: "hi" },
      { id: "c", role: "user", content: "how are you?" },
    ];

    const result = deduplicateByKey(messages, (m) => m.id);
    expect(result).toHaveLength(3);
    expect(result).toEqual(messages);
  });

  it("should keep the first occurrence of duplicate IDs", () => {
    const messages: TestMessage[] = [
      { id: "a", role: "user", content: "first version" },
      { id: "b", role: "assistant", content: "reply" },
      { id: "a", role: "user", content: "second version (dup)" },
    ];

    const result = deduplicateByKey(messages, (m) => m.id);
    expect(result).toHaveLength(2);
    expect(result[0].content).toBe("first version");
    expect(result[1].content).toBe("reply");
  });

  it("should handle multiple duplicates of the same ID", () => {
    const messages: TestMessage[] = [
      { id: "x", role: "user", content: "v1" },
      { id: "x", role: "user", content: "v2" },
      { id: "x", role: "user", content: "v3" },
      { id: "y", role: "assistant", content: "response" },
    ];

    const result = deduplicateByKey(messages, (m) => m.id);
    expect(result).toHaveLength(2);
    expect(result[0].id).toBe("x");
    expect(result[0].content).toBe("v1");
    expect(result[1].id).toBe("y");
  });

  it("should handle the exact React key collision scenario from the bug report", () => {
    // Simulates the actual bug: duplicate message ID fab23966-3d2e-417d-bcb9-379517858bd2
    const duplicateId = "fab23966-3d2e-417d-bcb9-379517858bd2";
    const messages: TestMessage[] = [
      { id: "msg-1", role: "user", content: "howdy" },
      { id: duplicateId, role: "assistant", content: "Hello! How can I help?" },
      { id: "msg-2", role: "user", content: "what's up?" },
      { id: duplicateId, role: "assistant", content: "Hello! How can I help? (duplicate from localStorage)" },
    ];

    const result = deduplicateByKey(messages, (m) => m.id);
    expect(result).toHaveLength(3);

    // Verify the first occurrence is kept
    const kept = result.find((m) => m.id === duplicateId);
    expect(kept).toBeDefined();
    expect(kept!.content).toBe("Hello! How can I help?");

    // Verify no duplicate keys exist
    const ids = result.map((m) => m.id);
    const uniqueIds = new Set(ids);
    expect(ids.length).toBe(uniqueIds.size);
  });

  it("should handle all messages being duplicates", () => {
    const messages: TestMessage[] = [
      { id: "same-id", role: "user", content: "v1" },
      { id: "same-id", role: "user", content: "v2" },
      { id: "same-id", role: "user", content: "v3" },
    ];

    const result = deduplicateByKey(messages, (m) => m.id);
    expect(result).toHaveLength(1);
    expect(result[0].content).toBe("v1");
  });

  it("should work with a custom key function (not just .id)", () => {
    interface Item {
      name: string;
      value: number;
    }

    const items: Item[] = [
      { name: "alpha", value: 1 },
      { name: "beta", value: 2 },
      { name: "alpha", value: 3 },
      { name: "gamma", value: 4 },
      { name: "beta", value: 5 },
    ];

    const result = deduplicateByKey(items, (item) => item.name);
    expect(result).toHaveLength(3);
    expect(result.map((i) => i.name)).toEqual(["alpha", "beta", "gamma"]);
    expect(result[0].value).toBe(1);
    expect(result[1].value).toBe(2);
    expect(result[2].value).toBe(4);
  });

  it("should not mutate the original array", () => {
    const original: TestMessage[] = [
      { id: "a", role: "user", content: "hello" },
      { id: "a", role: "user", content: "duplicate" },
    ];

    const originalLength = original.length;
    const result = deduplicateByKey(original, (m) => m.id);

    // Original should be untouched
    expect(original).toHaveLength(originalLength);
    expect(original[1].content).toBe("duplicate");

    // Result should be deduplicated
    expect(result).toHaveLength(1);
  });

  it("should handle a single-element array", () => {
    const messages: TestMessage[] = [
      { id: "only-one", role: "user", content: "solo" },
    ];

    const result = deduplicateByKey(messages, (m) => m.id);
    expect(result).toHaveLength(1);
    expect(result[0]).toEqual(messages[0]);
  });

  it("should handle large arrays efficiently", () => {
    // Simulate a realistic conversation with 200 messages, some duplicates
    const messages: TestMessage[] = [];
    for (let i = 0; i < 200; i++) {
      messages.push({
        id: `msg-${i % 150}`, // Creates duplicates for indices 0-49
        role: i % 2 === 0 ? "user" : "assistant",
        content: `message ${i}`,
      });
    }

    const start = performance.now();
    const result = deduplicateByKey(messages, (m) => m.id);
    const elapsed = performance.now() - start;

    expect(result).toHaveLength(150);
    // Should complete in well under 100ms even for 200 messages
    expect(elapsed).toBeLessThan(100);
  });

  it("should preserve original ordering of first occurrences", () => {
    const messages: TestMessage[] = [
      { id: "c", role: "user", content: "third" },
      { id: "a", role: "assistant", content: "first" },
      { id: "b", role: "user", content: "second" },
      { id: "a", role: "assistant", content: "first duplicate" },
      { id: "c", role: "user", content: "third duplicate" },
    ];

    const result = deduplicateByKey(messages, (m) => m.id);
    expect(result.map((m) => m.id)).toEqual(["c", "a", "b"]);
  });

  it("should handle concurrent duplicate pairs (localStorage + MongoDB sync race)", () => {
    // This simulates the actual race condition that causes React key collisions:
    // localStorage rehydrates messages, then MongoDB sync adds the same messages
    const localMessages: TestMessage[] = [
      { id: "msg-1", role: "user", content: "hello", created_at: "2026-02-08T10:00:00.000Z" },
      { id: "msg-2", role: "assistant", content: "hi there", created_at: "2026-02-08T10:00:01.000Z" },
    ];

    const mongoMessages: TestMessage[] = [
      { id: "msg-1", role: "user", content: "hello", created_at: "2026-02-08T10:00:00.000Z" },
      { id: "msg-2", role: "assistant", content: "hi there", created_at: "2026-02-08T10:00:01.000Z" },
    ];

    // Both sources merged (simulating the race condition)
    const merged = [...localMessages, ...mongoMessages];
    expect(merged).toHaveLength(4);

    const result = deduplicateByKey(merged, (m) => m.id);
    expect(result).toHaveLength(2);
    expect(result[0].id).toBe("msg-1");
    expect(result[1].id).toBe("msg-2");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// formatTimestamp
// ─────────────────────────────────────────────────────────────────────────────
describe("formatTimestamp", () => {
  it("should format a date to HH:MM:SS in 24-hour format", () => {
    // Note: exact output depends on locale, but structure should be consistent
    const date = new Date("2026-02-08T14:30:45.000Z");
    const result = formatTimestamp(date);
    // Should contain two colons (HH:MM:SS)
    expect(result.split(":")).toHaveLength(3);
  });

  it("should return a string", () => {
    const result = formatTimestamp(new Date());
    expect(typeof result).toBe("string");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// formatDate
// ─────────────────────────────────────────────────────────────────────────────
describe("formatDate", () => {
  it("should format a date with month, day, and year", () => {
    const date = new Date("2026-02-08T00:00:00.000Z");
    const result = formatDate(date);
    // Should contain the year
    expect(result).toContain("2026");
    expect(typeof result).toBe("string");
  });

  it("should return a string", () => {
    const result = formatDate(new Date());
    expect(typeof result).toBe("string");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// generateId
// ─────────────────────────────────────────────────────────────────────────────
describe("generateId", () => {
  it("should return a string", () => {
    const id = generateId();
    expect(typeof id).toBe("string");
  });

  it("should return a UUID-like format (8-4-4-4-12)", () => {
    const id = generateId();
    const parts = id.split("-");
    expect(parts).toHaveLength(5);
    expect(parts[0]).toHaveLength(8);
    expect(parts[1]).toHaveLength(4);
    expect(parts[2]).toHaveLength(4);
    expect(parts[3]).toHaveLength(4);
    expect(parts[4]).toHaveLength(12);
  });

  it("should generate unique IDs on each call", () => {
    const ids = new Set<string>();
    for (let i = 0; i < 100; i++) {
      ids.add(generateId());
    }
    expect(ids.size).toBe(100);
  });

  it("should contain only hex characters and dashes", () => {
    const id = generateId();
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// truncateText
// ─────────────────────────────────────────────────────────────────────────────
describe("truncateText", () => {
  it("should return the original text if shorter than maxLength", () => {
    expect(truncateText("hello", 10)).toBe("hello");
  });

  it("should return the original text if exactly maxLength", () => {
    expect(truncateText("hello", 5)).toBe("hello");
  });

  it("should truncate and add ellipsis if longer than maxLength", () => {
    expect(truncateText("hello world", 5)).toBe("hello...");
  });

  it("should handle empty string", () => {
    expect(truncateText("", 5)).toBe("");
  });

  it("should handle maxLength of 0", () => {
    expect(truncateText("hello", 0)).toBe("...");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// parseSSELine
// ─────────────────────────────────────────────────────────────────────────────
describe("parseSSELine", () => {
  it("should return null for empty string", () => {
    expect(parseSSELine("")).toBeNull();
  });

  it("should return null for comment lines (starting with ':')", () => {
    expect(parseSSELine(": this is a comment")).toBeNull();
  });

  it("should parse event lines", () => {
    expect(parseSSELine("event: custom_type")).toEqual({ event: "custom_type" });
  });

  it("should parse data lines", () => {
    expect(parseSSELine("data: {\"key\":\"value\"}")).toEqual({
      data: '{"key":"value"}',
    });
  });

  it("should return null for lines that are neither event, data, nor comment", () => {
    expect(parseSSELine("id: 123")).toBeNull();
    expect(parseSSELine("retry: 5000")).toBeNull();
    expect(parseSSELine("random text")).toBeNull();
  });

  it("should trim whitespace from event value", () => {
    expect(parseSSELine("event:   spaced  ")).toEqual({ event: "spaced" });
  });

  it("should trim whitespace from data value", () => {
    expect(parseSSELine("data:   spaced  ")).toEqual({ data: "spaced" });
  });

  it("should handle event with no value", () => {
    expect(parseSSELine("event:")).toEqual({ event: "" });
  });

  it("should handle data with no value", () => {
    expect(parseSSELine("data:")).toEqual({ data: "" });
  });

  it("should handle data containing colons", () => {
    expect(parseSSELine("data: http://example.com:8080")).toEqual({
      data: "http://example.com:8080",
    });
  });
});
