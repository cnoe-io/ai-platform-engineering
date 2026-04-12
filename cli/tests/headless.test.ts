/**
 * Unit tests for headless mode (T045).
 */

import { describe, it, expect, beforeEach, afterEach, mock } from "bun:test";
import { existsSync, mkdirSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

let testDir: string;

beforeEach(() => {
  testDir = join(tmpdir(), `caipe-headless-${process.pid}-${Date.now()}`);
  mkdirSync(testDir, { recursive: true });
  process.env["XDG_CONFIG_HOME"] = testDir;
  // Clear all credential env vars
  delete process.env["CAIPE_TOKEN"];
  delete process.env["CAIPE_API_KEY"];
  delete process.env["CAIPE_CLIENT_ID"];
  delete process.env["CAIPE_CLIENT_SECRET"];
});

afterEach(() => {
  delete process.env["XDG_CONFIG_HOME"];
  delete process.env["CAIPE_TOKEN"];
  delete process.env["CAIPE_API_KEY"];
  delete process.env["CAIPE_CLIENT_ID"];
  delete process.env["CAIPE_CLIENT_SECRET"];
  if (existsSync(testDir)) {
    rmSync(testDir, { recursive: true, force: true });
  }
});

// ── resolveHeadlessCredentials ────────────────────────────────────────────────

describe("resolveHeadlessCredentials", () => {
  it("returns null when no credentials are set", async () => {
    const { resolveHeadlessCredentials } = await import("../src/headless/auth");
    const creds = await resolveHeadlessCredentials();
    expect(creds).toBeNull();
  });

  it("returns jwt type for CAIPE_TOKEN env", async () => {
    process.env["CAIPE_TOKEN"] = "my-jwt-token";
    const { resolveHeadlessCredentials } = await import("../src/headless/auth");
    const creds = await resolveHeadlessCredentials();
    expect(creds?.type).toBe("jwt");
    expect(creds?.accessToken).toBe("my-jwt-token");
  });

  it("--token flag takes priority over CAIPE_TOKEN env", async () => {
    process.env["CAIPE_TOKEN"] = "env-token";
    const { resolveHeadlessCredentials } = await import("../src/headless/auth");
    const creds = await resolveHeadlessCredentials("flag-token");
    expect(creds?.accessToken).toBe("flag-token");
  });

  it("returns apikey type for CAIPE_API_KEY env", async () => {
    process.env["CAIPE_API_KEY"] = "my-api-key";
    const { resolveHeadlessCredentials } = await import("../src/headless/auth");
    const creds = await resolveHeadlessCredentials();
    expect(creds?.type).toBe("apikey");
    expect(creds?.accessToken).toBe("my-api-key");
  });

  it("JWT takes priority over API key", async () => {
    process.env["CAIPE_TOKEN"] = "jwt-wins";
    process.env["CAIPE_API_KEY"] = "api-loses";
    const { resolveHeadlessCredentials } = await import("../src/headless/auth");
    const creds = await resolveHeadlessCredentials();
    expect(creds?.type).toBe("jwt");
    expect(creds?.accessToken).toBe("jwt-wins");
  });

  it("client_credentials exchange when CAIPE_CLIENT_ID + SECRET set", async () => {
    process.env["CAIPE_CLIENT_ID"] = "my-client";
    process.env["CAIPE_CLIENT_SECRET"] = "my-secret";

    // We need a server URL for the token exchange
    const configDir = join(testDir, "caipe");
    mkdirSync(configDir, { recursive: true });
    const { writeSettings } = await import("../src/platform/config");
    writeSettings({ server: { url: "https://caipe.test" } });

    const originalFetch = global.fetch;
    global.fetch = mock(() =>
      Promise.resolve(
        new Response(
          JSON.stringify({ access_token: "cc-token", expires_in: 3600 }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
      ),
    ) as unknown as typeof fetch;

    try {
      const { resolveHeadlessCredentials } = await import("../src/headless/auth");
      const creds = await resolveHeadlessCredentials(undefined, "https://caipe.test");
      expect(creds?.type).toBe("client_credentials");
      expect(creds?.accessToken).toBe("cc-token");
    } finally {
      global.fetch = originalFetch;
    }
  });
});

// ── OutputWriter ─────────────────────────────────────────────────────────────

describe("createOutputWriter", () => {
  it("text format streams raw token text", async () => {
    const { createOutputWriter } = await import("../src/headless/output");
    const chunks: string[] = [];
    const origWrite = process.stdout.write.bind(process.stdout);
    process.stdout.write = (chunk: unknown) => { chunks.push(String(chunk)); return true; };

    const writer = createOutputWriter("text");
    writer.write({ type: "token", text: "Hello " });
    writer.write({ type: "token", text: "world" });
    writer.flush("default", "a2a");

    process.stdout.write = origWrite;
    expect(chunks.join("")).toContain("Hello world");
  });

  it("json format emits single blob on flush", async () => {
    const { createOutputWriter } = await import("../src/headless/output");
    const chunks: string[] = [];
    const origWrite = process.stdout.write.bind(process.stdout);
    process.stdout.write = (chunk: unknown) => { chunks.push(String(chunk)); return true; };

    const writer = createOutputWriter("json");
    writer.write({ type: "token", text: "Hello " });
    writer.write({ type: "token", text: "world" });
    writer.flush("argocd", "a2a");

    process.stdout.write = origWrite;
    const output = chunks.join("");
    const parsed = JSON.parse(output);
    expect(parsed.response).toBe("Hello world");
    expect(parsed.agent).toBe("argocd");
    expect(parsed.protocol).toBe("a2a");
  });

  it("ndjson format emits per-event JSON lines", async () => {
    const { createOutputWriter } = await import("../src/headless/output");
    const chunks: string[] = [];
    const origWrite = process.stdout.write.bind(process.stdout);
    process.stdout.write = (chunk: unknown) => { chunks.push(String(chunk)); return true; };

    const writer = createOutputWriter("ndjson");
    writer.write({ type: "token", text: "tok1" });
    writer.write({ type: "done" });
    writer.flush("default", "a2a");

    process.stdout.write = origWrite;
    const lines = chunks.join("").trim().split("\n").filter(Boolean);
    expect(lines).toHaveLength(2);
    expect(JSON.parse(lines[0]!)).toEqual({ type: "token", text: "tok1" });
    expect(JSON.parse(lines[1]!)).toEqual({ type: "done" });
  });

  it("error events go to stderr as JSON regardless of format", async () => {
    const { createOutputWriter } = await import("../src/headless/output");

    for (const fmt of ["text", "json", "ndjson"] as const) {
      const errChunks: string[] = [];
      const origErrWrite = process.stderr.write.bind(process.stderr);
      process.stderr.write = (chunk: unknown) => { errChunks.push(String(chunk)); return true; };

      const writer = createOutputWriter(fmt);
      writer.write({ type: "error", message: "Something failed" });

      process.stderr.write = origErrWrite;
      const errOut = errChunks.join("");
      const parsed = JSON.parse(errOut);
      expect(parsed.error).toBe("Something failed");
    }
  });
});
