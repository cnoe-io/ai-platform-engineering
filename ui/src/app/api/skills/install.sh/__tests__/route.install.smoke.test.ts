/**
 * @jest-environment node
 *
 * Runtime smoke tests for the generated install script. These execute the
 * emitted bash in a sandbox with a fake curl binary so we catch destructive
 * dotfile mutations, not just string-shape regressions.
 *
 * assisted-by Codex Codex-sonnet-4-6
 */

import { execFileSync } from "node:child_process";
import {
  chmodSync,
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

function writeFakeCurl(binDir: string): void {
  const curlPath = join(binDir, "curl");
  writeFileSync(
    curlPath,
    `#!/usr/bin/env bash
set -euo pipefail
out=""
url=""
while [ "$#" -gt 0 ]; do
  case "$1" in
    -o) out="$2"; shift 2 ;;
    -w) shift 2 ;;
    -H) shift 2 ;;
    -sS|-f|-L|-fsSL) shift ;;
    *) url="$1"; shift ;;
  esac
done
case "$url" in
  *"/api/skills/helpers/caipe-skills.py"*) printf '# helper\\n' > "$out" ;;
  *"/api/skills/hooks/caipe-catalog.sh"*) printf '#!/usr/bin/env bash\\n' > "$out" ;;
  *) printf '{}' > "$out" ;;
esac
printf '200'
`,
    { mode: 0o755 },
  );
  chmodSync(curlPath, 0o755);
}

describe("GET /api/skills/install.sh — install runtime smoke", () => {
  it("preserves existing Claude settings while registering the CAIPE hook", async () => {
    const res = await callRaw(
      "https://app.example.com/api/skills/install.sh?agent=claude&scope=user",
    );
    expect(res.status).toBe(200);

    const dir = mkdtempSync(join(tmpdir(), "caipe-install-"));
    try {
      const home = join(dir, "home");
      const bin = join(dir, "bin");
      mkdirSync(join(home, ".claude"), { recursive: true });
      mkdirSync(bin, { recursive: true });
      writeFakeCurl(bin);

      const settingsPath = join(home, ".claude", "settings.json");
      writeFileSync(
        settingsPath,
        JSON.stringify(
          {
            env: {
              ANTHROPIC_BASE_URL: "https://llm-proxy.example.invalid",
              ANTHROPIC_API_KEY: "REDACTED",
              ANTHROPIC_MODEL: "bedrock/global.anthropic.claude-sonnet-4-6",
              CLAUDE_MODEL: "bedrock/global.anthropic.claude-sonnet-4-6",
              CLAUDE_CODE_DISABLE_EXPERIMENTAL_BETAS: "1",
              CAIPE_BASE_URL: "http://localhost:3000",
            },
            effortLevel: "medium",
            skipDangerousModePermissionPrompt: true,
            theme: "dark",
            hooks: {
              SessionStart: [
                {
                  hooks: [
                    {
                      type: "command",
                      command: "$HOME/.claude/hooks/caipe-catalog.sh",
                      timeout: 5,
                    },
                  ],
                },
              ],
            },
          },
          null,
          2,
        ) + "\n",
      );

      const scriptPath = join(dir, "install.sh");
      writeFileSync(scriptPath, res.body, { mode: 0o755 });
      execFileSync("bash", [scriptPath, "--no-bulk", "--no-helpers"], {
        env: {
          ...process.env,
          HOME: home,
          PATH: `${bin}:${process.env.PATH ?? ""}`,
          CAIPE_CATALOG_KEY: "fake-test-key",
        },
        stdio: "pipe",
      });

      const settings = JSON.parse(readFileSync(settingsPath, "utf8"));
      expect(settings.env).toEqual({
        ANTHROPIC_BASE_URL: "https://llm-proxy.example.invalid",
        ANTHROPIC_API_KEY: "REDACTED",
        ANTHROPIC_MODEL: "bedrock/global.anthropic.claude-sonnet-4-6",
        CLAUDE_MODEL: "bedrock/global.anthropic.claude-sonnet-4-6",
        CLAUDE_CODE_DISABLE_EXPERIMENTAL_BETAS: "1",
        CAIPE_BASE_URL: "http://localhost:3000",
      });
      expect(settings.effortLevel).toBe("medium");
      expect(settings.skipDangerousModePermissionPrompt).toBe(true);
      expect(settings.theme).toBe("dark");
      expect(settings.hooks.SessionStart).toHaveLength(1);
      expect(settings.hooks.SessionStart[0].hooks).toEqual([
        {
          type: "command",
          command: "$HOME/.claude/hooks/caipe-catalog.sh",
          timeout: 5,
        },
      ]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
