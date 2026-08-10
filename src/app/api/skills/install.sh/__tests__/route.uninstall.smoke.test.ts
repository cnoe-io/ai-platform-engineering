/**
 * @jest-environment node
 *
 * Bash-syntax smoke test for the uninstall script.
 *
 * The unit tests in `route.uninstall.test.ts` pin script content with
 * regexes; this test additionally pipes the generated bash through
 * `bash -n` (parse-only) so a typo or unbalanced heredoc surfaces
 * here instead of at runtime when a user runs `curl ... | bash`.
 *
 * We exercise both scopes (user + project) AND a few flag combinations
 * because some shell errors only show up when a particular branch is
 * taken (e.g. an unterminated heredoc inside the `--purge` arm).
 */

import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

jest.mock("next/server", () => {
  class MockResponse {
    body: string;
    status: number;
    headers: Map<string, string>;
    constructor(
      body: string,
      init?: { status?: number; headers?: Record<string, string> },
    ) {
      this.body = body;
      this.status = init?.status ?? 200;
      this.headers = new Map(Object.entries(init?.headers ?? {}));
    }
    text() {
      return Promise.resolve(this.body);
    }
  }
  return { NextResponse: MockResponse };
});

import { GET } from "../route";

interface MockRes {
  body: string;
  status: number;
}

const callRaw = async (url: string): Promise<MockRes> =>
  (await GET(new Request(url))) as unknown as MockRes;

async function bashParseCheck(scriptBody: string): Promise<void> {
  // bash -n requires the script on disk (it can read stdin too, but
  // tempfiles produce clearer error reports including line numbers).
  const dir = mkdtempSync(join(tmpdir(), "caipe-uninstall-"));
  const path = join(dir, "uninstall.sh");
  try {
    writeFileSync(path, scriptBody, { mode: 0o644 });
    // throws on non-zero exit, surfacing the syntax error.
    execFileSync("bash", ["-n", path], { stdio: "pipe" });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

describe("GET /api/skills/install.sh — mode=uninstall bash syntax smoke", () => {
  it("user-scope script parses cleanly under bash -n", async () => {
    const res = await callRaw(
      "https://app.example.com/api/skills/install.sh?agent=claude&scope=user&mode=uninstall",
    );
    expect(res.status).toBe(200);
    await expect(bashParseCheck(res.body)).resolves.toBeUndefined();
  });

  it("project-scope script parses cleanly under bash -n", async () => {
    const res = await callRaw(
      "https://app.example.com/api/skills/install.sh?agent=claude&scope=project&mode=uninstall",
    );
    expect(res.status).toBe(200);
    await expect(bashParseCheck(res.body)).resolves.toBeUndefined();
  });

  it("cursor agent (different settings.json shape) also parses cleanly", async () => {
    // Cursor doesn't use ~/.claude/settings.json, but the uninstall
    // script bakes the path unconditionally because it walks the
    // manifest's `kind` field at runtime to decide whether to act.
    // Bash -n must still pass for non-Claude agents.
    const res = await callRaw(
      "https://app.example.com/api/skills/install.sh?agent=cursor&scope=user&mode=uninstall",
    );
    expect(res.status).toBe(200);
    await expect(bashParseCheck(res.body)).resolves.toBeUndefined();
  });

  it("purge never deletes Claude settings.json from a manifest entry", async () => {
    const res = await callRaw(
      "https://app.example.com/api/skills/install.sh?agent=claude&scope=user&mode=uninstall",
    );
    expect(res.status).toBe(200);

    const dir = mkdtempSync(join(tmpdir(), "caipe-uninstall-"));
    try {
      const home = join(dir, "home");
      const settingsPath = join(home, ".claude", "settings.json");
      const hookPath = join(home, ".claude", "hooks", "caipe-catalog.sh");
      const configPath = join(home, ".config", "caipe", "config.json");
      const manifestPath = join(home, ".config", "caipe", "installed.json");

      mkdirSync(join(home, ".claude", "hooks"), { recursive: true });
      mkdirSync(join(home, ".config", "caipe"), { recursive: true });
      writeFileSync(hookPath, "#!/usr/bin/env bash\n");
      writeFileSync(configPath, '{"base_url":"https://grid.outshift.io"}\n');
      writeFileSync(
        settingsPath,
        JSON.stringify(
          {
            env: {
              ANTHROPIC_BASE_URL: "https://llm-proxy.example.invalid",
            },
            hooks: {
              SessionStart: [
                {
                  hooks: [
                    {
                      type: "command",
                      command: hookPath,
                      timeout: 5,
                    },
                  ],
                },
              ],
            },
            theme: "dark",
          },
          null,
          2,
        ) + "\n",
      );
      writeFileSync(
        manifestPath,
        JSON.stringify(
          {
            version: 2,
            installed: [
              {
                agent: "claude",
                scope: "user",
                name: "caipe-catalog-hook",
                kind: "hook",
                paths: [hookPath],
              },
              {
                agent: "claude",
                scope: "user",
                name: "claude-settings",
                kind: "config",
                paths: [settingsPath],
              },
              {
                agent: "claude",
                scope: "user",
                name: "config",
                kind: "config",
                paths: [configPath],
              },
            ],
          },
          null,
          2,
        ) + "\n",
      );

      const scriptPath = join(dir, "uninstall.sh");
      writeFileSync(scriptPath, res.body, { mode: 0o755 });
      execFileSync("bash", [scriptPath, "--all", "--purge"], {
        env: {
          ...process.env,
          HOME: home,
        },
        stdio: "pipe",
      });

      expect(existsSync(settingsPath)).toBe(true);
      expect(existsSync(hookPath)).toBe(false);
      expect(existsSync(configPath)).toBe(false);

      const settings = JSON.parse(readFileSync(settingsPath, "utf8"));
      expect(settings.env.ANTHROPIC_BASE_URL).toBe(
        "https://llm-proxy.example.invalid",
      );
      expect(settings.theme).toBe("dark");
      expect(settings.hooks).toBeUndefined();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
