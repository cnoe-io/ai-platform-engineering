/**
 * Unit tests for platform/config.ts:
 *   - getServerUrl() priority order (flag > env > settings > throws)
 *   - ServerNotConfigured error
 *   - settings read/write round-trip
 *   - HTTPS validation
 *   - globalConfigDir, derived paths
 */

import { describe, it, expect, beforeEach, afterEach, spyOn } from "bun:test";
import { existsSync, mkdirSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

// We need to control the home directory to avoid writing to actual ~/.config/caipe
// in tests.  We do this by temporarily setting XDG_CONFIG_HOME.

let testDir: string;

beforeEach(() => {
  testDir = join(tmpdir(), `caipe-test-${process.pid}-${Date.now()}`);
  mkdirSync(testDir, { recursive: true });
  process.env["XDG_CONFIG_HOME"] = testDir;
  // Clear any server URL env
  delete process.env["CAIPE_SERVER_URL"];
});

afterEach(() => {
  delete process.env["XDG_CONFIG_HOME"];
  delete process.env["CAIPE_SERVER_URL"];
  if (existsSync(testDir)) {
    rmSync(testDir, { recursive: true, force: true });
  }
});

// ── Import after env is set ───────────────────────────────────────────────────
// Note: Bun caches modules, so we need to ensure the module re-reads the env
// on each call rather than at module load time.  All our path helpers are
// functions that read process.env each time, so this is fine.

import {
  globalConfigDir,
  settingsJsonPath,
  readSettings,
  writeSettings,
  getServerUrl,
  ServerNotConfigured,
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
    const { writeFileSync, mkdirSync } = require("fs") as typeof import("fs");
    mkdirSync(require("path").dirname(settingsJsonPath()), { recursive: true });
    writeFileSync(settingsJsonPath(), "not json");
    const s = readSettings();
    expect(s).toEqual({});
  });
});

// ── getServerUrl priority ─────────────────────────────────────────────────────

describe("getServerUrl", () => {
  it("throws ServerNotConfigured when nothing is set", () => {
    expect(() => getServerUrl()).toThrow(ServerNotConfigured);
  });

  it("returns flag value (highest priority)", () => {
    writeSettings({ server: { url: "https://settings.example.com" } });
    process.env["CAIPE_SERVER_URL"] = "https://env.example.com";
    const url = getServerUrl("https://flag.example.com");
    expect(url).toBe("https://flag.example.com");
  });

  it("returns env var over settings", () => {
    writeSettings({ server: { url: "https://settings.example.com" } });
    process.env["CAIPE_SERVER_URL"] = "https://env.example.com";
    const url = getServerUrl();
    expect(url).toBe("https://env.example.com");
  });

  it("returns settings when no flag or env", () => {
    writeSettings({ server: { url: "https://settings.example.com" } });
    const url = getServerUrl();
    expect(url).toBe("https://settings.example.com");
  });

  it("strips trailing slash", () => {
    writeSettings({ server: { url: "https://caipe.example.com/" } });
    const url = getServerUrl();
    expect(url).toBe("https://caipe.example.com");
  });

  it("throws on HTTP URL", () => {
    expect(() => getServerUrl("http://not-https.example.com")).toThrow(/HTTPS/);
  });

  it("ServerNotConfigured is thrown when headless with no URL", () => {
    expect(() => getServerUrl()).toThrowError(
      expect.objectContaining({ name: "ServerNotConfigured" }),
    );
  });
});

// ── endpoints derived from serverUrl ─────────────────────────────────────────

describe("endpoints", () => {
  it("derives all endpoints correctly", async () => {
    const { endpoints } = await import("../src/platform/config");
    const ep = endpoints("https://caipe.example.com");
    expect(ep.deviceCode).toBe("https://caipe.example.com/oauth/device/code");
    expect(ep.token).toBe("https://caipe.example.com/oauth/token");
    expect(ep.agents).toBe("https://caipe.example.com/api/v1/agents");
    expect(ep.a2aTask).toBe("https://caipe.example.com/tasks/send");
    expect(ep.aguiStream).toBe("https://caipe.example.com/api/agui/stream");
  });
});
