/**
 * Unit tests for the per-user/per-task in-process rate limiter.
 *
 * Limits are read from env on each call, so we tweak them in beforeAll and
 * restore in afterAll.
 */

import { __resetForTests, consume } from "../ai-assist-rate-limit";

const ORIGINAL_LIMIT = process.env.AI_ASSIST_RATE_LIMIT_PER_WINDOW;
const ORIGINAL_WINDOW = process.env.AI_ASSIST_RATE_LIMIT_WINDOW_MS;

beforeAll(() => {
  process.env.AI_ASSIST_RATE_LIMIT_PER_WINDOW = "3";
  process.env.AI_ASSIST_RATE_LIMIT_WINDOW_MS = "60000";
});

afterAll(() => {
  if (ORIGINAL_LIMIT === undefined) delete process.env.AI_ASSIST_RATE_LIMIT_PER_WINDOW;
  else process.env.AI_ASSIST_RATE_LIMIT_PER_WINDOW = ORIGINAL_LIMIT;
  if (ORIGINAL_WINDOW === undefined) delete process.env.AI_ASSIST_RATE_LIMIT_WINDOW_MS;
  else process.env.AI_ASSIST_RATE_LIMIT_WINDOW_MS = ORIGINAL_WINDOW;
});

beforeEach(() => __resetForTests());

describe("consume()", () => {
  it("allows up to `limit` calls in the window", () => {
    const a = consume("alice@x", "describe-skill");
    const b = consume("alice@x", "describe-skill");
    const c = consume("alice@x", "describe-skill");
    expect(a.allowed).toBe(true);
    expect(a.remaining).toBe(2);
    expect(b.remaining).toBe(1);
    expect(c.remaining).toBe(0);
  });

  it("rejects the next call with a Retry-After hint", () => {
    consume("alice@x", "describe-skill");
    consume("alice@x", "describe-skill");
    consume("alice@x", "describe-skill");
    const blocked = consume("alice@x", "describe-skill");
    expect(blocked.allowed).toBe(false);
    expect(blocked.remaining).toBe(0);
    expect(blocked.retryAfterSec).toBeGreaterThan(0);
    expect(blocked.limit).toBe(3);
  });

  it("buckets per-user", () => {
    for (let i = 0; i < 3; i++) consume("alice@x", "describe-skill");
    const bobFirst = consume("bob@x", "describe-skill");
    expect(bobFirst.allowed).toBe(true);
    expect(bobFirst.remaining).toBe(2);
  });

  it("buckets per-task", () => {
    for (let i = 0; i < 3; i++) consume("alice@x", "describe-skill");
    const otherTask = consume("alice@x", "code-snippet");
    expect(otherTask.allowed).toBe(true);
  });

  it("treats undefined userId as the shared anon bucket", () => {
    for (let i = 0; i < 3; i++) consume(undefined, "describe-skill");
    const anonBlocked = consume(undefined, "describe-skill");
    expect(anonBlocked.allowed).toBe(false);
  });
});
