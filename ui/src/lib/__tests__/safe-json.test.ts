/**
 * @jest-environment jsdom
 *
 * Tests for `@/lib/safe-json` — the response-body parsers that turn
 * the opaque
 *
 *   SyntaxError: Unexpected token '<', "<!DOCTYPE "... is not valid JSON
 *
 * into actionable error messages when an upstream proxy returns HTML.
 *
 * jsdom 30 doesn't ship the WHATWG ``Response`` constructor, so we
 * hand-roll the minimum surface ``readJson`` needs: ``status``,
 * ``headers.get``, and ``text() | json()`` consumers. This matches the
 * shape of what the real ``fetch`` Response provides at runtime.
 */

import {
  NonJsonResponseError,
  readJson,
  readJsonOrError,
} from "../safe-json";

interface FakeFetchResponse {
  status: number;
  headers: { get: (name: string) => string | null };
  text: () => Promise<string>;
  json: () => Promise<unknown>;
}

function makeResponse(opts: {
  status?: number;
  contentType?: string | null;
  body: string;
  /** When true, ``json()`` rejects to simulate "server lied about content-type". */
  jsonThrows?: boolean;
}): FakeFetchResponse {
  const ct = opts.contentType;
  const headers: Record<string, string | undefined> = ct === null
    ? {}
    : { "content-type": ct ?? "application/json" };
  return {
    status: opts.status ?? 200,
    headers: { get: (n) => headers[n.toLowerCase()] ?? null },
    text: async () => opts.body,
    json: async () => {
      if (opts.jsonThrows) {
        throw new SyntaxError("Unexpected token '<' in JSON at position 0");
      }
      return JSON.parse(opts.body);
    },
  };
}

describe("readJson", () => {
  it("parses a normal JSON 200 response", async () => {
    const data = await readJson<{ ok: boolean }>(
      makeResponse({ body: JSON.stringify({ ok: true }) }) as unknown as Response,
    );
    expect(data).toEqual({ ok: true });
  });

  it("accepts vendor-specific +json content types (e.g. problem+json)", async () => {
    const data = await readJson<{ kind: string }>(
      makeResponse({
        contentType: "application/problem+json",
        body: JSON.stringify({ kind: "Bad" }),
      }) as unknown as Response,
    );
    expect(data.kind).toBe("Bad");
  });

  it("throws NonJsonResponseError when content-type is text/html", async () => {
    const resp = makeResponse({
      status: 504,
      contentType: "text/html; charset=utf-8",
      body: "<!DOCTYPE html><h1>504</h1>",
    });
    await expect(readJson(resp as unknown as Response)).rejects.toBeInstanceOf(
      NonJsonResponseError,
    );
    try {
      await readJson(resp as unknown as Response);
    } catch (err) {
      expect(err).toBeInstanceOf(NonJsonResponseError);
      const e = err as NonJsonResponseError;
      expect(e.status).toBe(504);
      expect(e.contentType).toBe("text/html; charset=utf-8");
      expect(e.bodyPreview).toContain("<!DOCTYPE html>");
      expect(e.message).toMatch(/HTTP 504/);
      expect(e.message).toMatch(/text\/html/);
    }
  });

  it("includes the body preview in the error message (truncated to ~200 chars)", async () => {
    const longBody = "<!DOCTYPE html>" + "x".repeat(500);
    try {
      await readJson(
        makeResponse({
          status: 502,
          contentType: "text/html",
          body: longBody,
        }) as unknown as Response,
      );
      fail("expected throw");
    } catch (err) {
      const e = err as NonJsonResponseError;
      // bodyPreview is the raw 200-char excerpt (+ '…'), so up to 201 chars.
      expect(e.bodyPreview.length).toBeLessThanOrEqual(201);
      expect(e.bodyPreview.endsWith("…")).toBe(true);
      expect(e.message).toContain("HTTP 502");
    }
  });

  it("treats a missing content-type as non-JSON (defensive)", async () => {
    const resp = makeResponse({
      contentType: null,
      body: "garbage",
    });
    await expect(readJson(resp as unknown as Response)).rejects.toBeInstanceOf(
      NonJsonResponseError,
    );
  });

  it("throws NonJsonResponseError when content-type lies (claims JSON but body is HTML)", async () => {
    const resp = makeResponse({
      contentType: "application/json",
      body: "<!DOCTYPE html>",
      jsonThrows: true,
    });
    await expect(readJson(resp as unknown as Response)).rejects.toBeInstanceOf(
      NonJsonResponseError,
    );
    try {
      await readJson(resp as unknown as Response);
    } catch (err) {
      const e = err as NonJsonResponseError;
      expect(e.message).toMatch(
        /server claimed JSON but body was not parseable/,
      );
    }
  });
});

describe("readJsonOrError", () => {
  it("returns ok:true with parsed data on a JSON response", async () => {
    const result = await readJsonOrError<{ a: number }>(
      makeResponse({ body: JSON.stringify({ a: 1 }) }) as unknown as Response,
    );
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.data.a).toBe(1);
  });

  it("returns ok:false with status + preview on an HTML response", async () => {
    const result = await readJsonOrError(
      makeResponse({
        status: 504,
        contentType: "text/html; charset=utf-8",
        body: "<!DOCTYPE html><body>Bad Gateway</body>",
      }) as unknown as Response,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.status).toBe(504);
      expect(result.preview).toContain("<!DOCTYPE html>");
      expect(result.error).toContain("HTTP 504");
    }
  });

  it("does not throw — instead returns ok:false — for parse failures", async () => {
    const result = await readJsonOrError(
      makeResponse({
        contentType: "application/json",
        body: "not json",
        jsonThrows: true,
      }) as unknown as Response,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toMatch(/JSON parse failed/);
    }
  });
});

describe("NonJsonResponseError", () => {
  it("exposes status / contentType / bodyPreview as instance fields", () => {
    const err = new NonJsonResponseError(503, "text/plain", "oops");
    expect(err.status).toBe(503);
    expect(err.contentType).toBe("text/plain");
    expect(err.bodyPreview).toBe("oops");
    expect(err.name).toBe("NonJsonResponseError");
    expect(err).toBeInstanceOf(Error);
  });

  it("supports an optional action hint that gets appended to the message", () => {
    const err = new NonJsonResponseError(
      500,
      "text/html",
      "<html>",
      "Try again later.",
    );
    expect(err.message).toContain("Try again later.");
  });
});
