/**
 * @jest-environment node
 *
 * Tests for the Agentic SDLC server-side toggle gate.
 *
 * These are the security boundary: when the feature is disabled, every
 * /api/agentic-sdlc/** route MUST return 404 (not 403/500) and MUST NOT
 * invoke the underlying handler.
 *
 * Run under `node` (not jsdom) so the Web `Request`/`Response` globals
 * Node ships natively are available without polyfills.
 */

// Tests cover the wrapper's behavior — we don't need a full NextRequest
// instance, just any object the handler would receive. Importing
// NextRequest here would require polyfilling the Web `Request` global
// in the jsdom env, which is out of scope for this unit test.

import { withAgenticSdlcGate, isAgenticSdlcServerEnabled } from "@/lib/agentic-sdlc/guard";
import type { NextRequest } from "next/server";

describe("withAgenticSdlcGate", () => {
  const ORIGINAL_ENV = { ...process.env };

  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
  });

  function makeReq(): NextRequest {
    return { url: "http://localhost/api/agentic-sdlc/repos" } as unknown as NextRequest;
  }

  it("returns 404 with no body when SHIP_LOOP_ENABLED is unset", async () => {
    delete process.env.SHIP_LOOP_ENABLED;
    let invoked = false;
    const handler = withAgenticSdlcGate(async () => {
      invoked = true;
      return new Response("hello", { status: 200 });
    });
    const res = (await handler(makeReq())) as Response;
    expect(res.status).toBe(404);
    expect(await res.text()).toBe("");
    expect(invoked).toBe(false);
  });

  it("returns 404 when SHIP_LOOP_ENABLED is anything but the literal 'true'", async () => {
    for (const val of ["false", "", "1", "yes", "TRUE", "0"]) {
      process.env.SHIP_LOOP_ENABLED = val;
      const handler = withAgenticSdlcGate(async () =>
        new Response("hello", { status: 200 }),
      );
      const res = (await handler(makeReq())) as Response;
      expect(res.status).toBe(404);
    }
  });

  it("invokes the handler when SHIP_LOOP_ENABLED='true'", async () => {
    process.env.SHIP_LOOP_ENABLED = "true";
    let invoked = false;
    const handler = withAgenticSdlcGate(async () => {
      invoked = true;
      return new Response("hello", { status: 200 });
    });
    const res = (await handler(makeReq())) as Response;
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("hello");
    expect(invoked).toBe(true);
  });

  it("isAgenticSdlcServerEnabled mirrors the env state", () => {
    process.env.SHIP_LOOP_ENABLED = "true";
    expect(isAgenticSdlcServerEnabled()).toBe(true);
    process.env.SHIP_LOOP_ENABLED = "false";
    expect(isAgenticSdlcServerEnabled()).toBe(false);
    delete process.env.SHIP_LOOP_ENABLED;
    expect(isAgenticSdlcServerEnabled()).toBe(false);
  });
});
