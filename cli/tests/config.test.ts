/**
 * Unit tests for platform/config.ts:
 *   - getAuthUrl() priority order (flag > CAIPE_AUTH_URL > settings.auth.url > settings.server.url > throws)
 *   - getA2aUrl() priority order (CAIPE_SERVER_URL > settings.server.url when auth.url also set)
 *   - getServerUrl() deprecated alias behaviour
 *   - ServerNotConfigured error
 *   - settings read/write round-trip
 *   - HTTPS validation
 *   - globalConfigDir, derived paths
 *   - authEndpoints / serverEndpoints helpers
 */

import { existsSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

// We need to control the home directory to avoid writing to actual ~/.config/caipe
// in tests.  We do this by temporarily setting XDG_CONFIG_HOME.

let testDir: string;

beforeEach(() => {
  testDir = join(tmpdir(), `caipe-test-${process.pid}-${Date.now()}`);
  mkdirSync(testDir, { recursive: true });
  process.env.XDG_CONFIG_HOME = testDir;
  // Clear URL env vars — must use empty string, not undefined (which becomes "undefined")
  process.env.CAIPE_AUTH_URL = "";
  process.env.CAIPE_SERVER_URL = "";
});

afterEach(() => {
  process.env.XDG_CONFIG_HOME = "";
  process.env.CAIPE_AUTH_URL = "";
  process.env.CAIPE_SERVER_URL = "";
  if (existsSync(testDir)) {
    rmSync(testDir, { recursive: true, force: true });
  }
});

// ── Import after env is set ───────────────────────────────────────────────────
// Note: Bun caches modules, so we need to ensure the module re-reads the env
// on each call rather than at module load time.  All our path helpers are
// functions that read process.env each time, so this is fine.

import {
  ServerNotConfigured,
  getA2aUrl,
  getAuthUrl,
  getServerUrl,
  globalConfigDir,
  readSettings,
  settingsJsonPath,
  writeSettings,
} from "../src/platform/config";

// ── globalConfigDir ──────────────────────────────────────────────────────────

describe("globalConfigDir", () => {
  it("respects XDG_CONFIG_HOME", () => {
    const dir = globalConfigDir();
    expect(dir).toBe(join(testDir, "caipe"));
  });
});

// ── readSettings / writeSettings ─────────────────────────────────────────────

describe("settings read/write", () => {
  it("returns empty object when file does not exist", () => {
    const s = readSettings();
    expect(s).toEqual({});
  });

  it("round-trips settings", () => {
    writeSettings({ server: { url: "https://caipe.example.com" } });
    const s = readSettings();
    expect(s.server?.url).toBe("https://caipe.example.com");
  });

  it("round-trips apiKey", () => {
    writeSettings({ auth: { apiKey: "secret" } });
    const s = readSettings();
    expect(s.auth?.apiKey).toBe("secret");
  });

  it("handles corrupted settings file gracefully", () => {
    const { writeFileSync, mkdirSync } = require("node:fs") as typeof import("fs");
    mkdirSync(require("node:path").dirname(settingsJsonPath()), { recursive: true });
    writeFileSync(settingsJsonPath(), "not json");
    const s = readSettings();
    expect(s).toEqual({});
  });
});

// ── getAuthUrl priority ───────────────────────────────────────────────────────

describe("getAuthUrl", () => {
  it("throws ServerNotConfigured when nothing is set", () => {
    expect(() => getAuthUrl()).toThrow(ServerNotConfigured);
  });

  it("returns flag value (highest priority)", () => {
    writeSettings({ auth: { url: "https://settings.example.com" } });
    process.env.CAIPE_AUTH_URL = "https://env.example.com";
    const url = getAuthUrl("https://flag.example.com");
    expect(url).toBe("https://flag.example.com");
  });

  it("returns CAIPE_AUTH_URL env var over settings", () => {
    writeSettings({ auth: { url: "https://settings.example.com" } });
    process.env.CAIPE_AUTH_URL = "https://env.example.com";
    const url = getAuthUrl();
    expect(url).toBe("https://env.example.com");
  });

  it("returns settings.auth.url when no flag or env", () => {
    writeSettings({ auth: { url: "https://auth.example.com" } });
    const url = getAuthUrl();
    expect(url).toBe("https://auth.example.com");
  });

  it("falls back to settings.server.url for backward compat", () => {
    // Old installs only had server.url pointing to the UI
    writeSettings({ server: { url: "https://legacy.example.com" } });
    const url = getAuthUrl();
    expect(url).toBe("https://legacy.example.com");
  });

  it("strips trailing slash", () => {
    writeSettings({ auth: { url: "https://caipe.example.com/" } });
    const url = getAuthUrl();
    expect(url).toBe("https://caipe.example.com");
  });

  it("throws on HTTP URL", () => {
    expect(() => getAuthUrl("http://not-https.example.com")).toThrow(/HTTPS/);
  });
});

// ── getA2aUrl priority ────────────────────────────────────────────────────────

describe("getA2aUrl", () => {
  it("returns undefined when nothing is set", () => {
    expect(getA2aUrl()).toBeUndefined();
  });

  it("returns CAIPE_SERVER_URL env var", () => {
    process.env.CAIPE_SERVER_URL = "https://a2a.example.com";
    expect(getA2aUrl()).toBe("https://a2a.example.com");
  });

  it("returns settings.server.url when auth.url is also explicitly set", () => {
    writeSettings({
      auth: { url: "https://auth.example.com" },
      server: { url: "https://a2a.example.com" },
    });
    expect(getA2aUrl()).toBe("https://a2a.example.com");
  });

  it("returns undefined for server.url when no explicit auth (legacy single-URL setup)", () => {
    // Old installs: server.url holds the UI URL — don't treat it as A2A URL
    writeSettings({ server: { url: "https://legacy.example.com" } });
    expect(getA2aUrl()).toBeUndefined();
  });
});

// ── getServerUrl deprecated alias ─────────────────────────────────────────────

describe("getServerUrl (deprecated alias for getAuthUrl)", () => {
  it("throws ServerNotConfigured when nothing is set", () => {
    expect(() => getServerUrl()).toThrow(ServerNotConfigured);
  });

  it("returns flag value", () => {
    const url = getServerUrl("https://flag.example.com");
    expect(url).toBe("https://flag.example.com");
  });

  it("reads CAIPE_AUTH_URL env var (not CAIPE_SERVER_URL)", () => {
    process.env.CAIPE_AUTH_URL = "https://auth-env.example.com";
    const url = getServerUrl();
    expect(url).toBe("https://auth-env.example.com");
  });

  it("falls back to settings.server.url for backward compat", () => {
    writeSettings({ server: { url: "https://settings.example.com" } });
    const url = getServerUrl();
    expect(url).toBe("https://settings.example.com");
  });

  it("ServerNotConfigured has correct name", () => {
    expect(() => getServerUrl()).toThrowError(
      expect.objectContaining({ name: "ServerNotConfigured" }),
    );
  });
});

// ── endpoint helpers ──────────────────────────────────────────────────────────

describe("authEndpoints", () => {
  it("derives all auth/OAuth endpoints correctly", async () => {
    const { authEndpoints } = await import("../src/platform/config");
    const ep = authEndpoints("https://caipe.example.com");
    expect(ep.deviceCode).toBe("https://caipe.example.com/oauth/device/code");
    expect(ep.token).toBe("https://caipe.example.com/oauth/token");
    expect(ep.agents).toBe("https://caipe.example.com/api/v1/agents");
    expect(ep.agentCard).toBe("https://caipe.example.com/.well-known/agent.json");
    expect(ep.aguiStream).toBe("https://caipe.example.com/api/agui/stream");
  });
});

describe("serverEndpoints", () => {
  it("derives all A2A backend endpoints correctly", async () => {
    const { serverEndpoints } = await import("../src/platform/config");
    const ep = serverEndpoints("http://localhost:8000");
    expect(ep.a2aTask).toBe("http://localhost:8000/tasks/send");
    expect(ep.aguiStream).toBe("http://localhost:8000/api/agui/stream");
    expect(ep.agents).toBe("http://localhost:8000/api/v1/agents");
  });
});

describe("endpoints (deprecated)", () => {
  it("merges auth and server endpoints for backward compat", async () => {
    const { endpoints } = await import("../src/platform/config");
    const ep = endpoints("https://caipe.example.com");
    expect(ep.deviceCode).toBe("https://caipe.example.com/oauth/device/code");
    expect(ep.token).toBe("https://caipe.example.com/oauth/token");
    expect(ep.agents).toBe("https://caipe.example.com/api/v1/agents");
    expect(ep.a2aTask).toBe("https://caipe.example.com/tasks/send");
    expect(ep.aguiStream).toBe("https://caipe.example.com/api/agui/stream");
  });
});
