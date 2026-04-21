/**
 * @jest-environment node
 *
 * Tests for GET /api/skills/install.sh
 *
 * Covers:
 *   - Required parameters (agent, scope) are enforced with HTTP 400 + a
 *     plain-text error the shell can `exit` on.
 *   - Scope/agent compatibility is enforced (Codex rejects project, Spec Kit
 *     rejects user).
 *   - The generated bash script is well-formed: starts with `#!/usr/bin/env
 *     bash`, runs under `set -euo pipefail`, and never inlines the catalog
 *     API key (the script asks for it at runtime).
 *   - Per-agent + per-scope install paths are resolved correctly into the
 *     script (`~/.claude/...` for user, `./.claude/...` for project, etc.).
 *   - User-supplied `command_name` is templated into the install path; the
 *     bootstrap callback URL embeds the same parameters.
 *   - Hostile inputs (bad command_name, bad base_url) are sanitized before
 *     they reach the script.
 *   - Continue (fragment-style) gets a special "merge into config.json" path
 *     instead of overwriting the file.
 *   - Response headers: text/x-shellscript, Cache-Control: no-store,
 *     Content-Disposition with a deterministic filename, nosniff.
 */

jest.mock("next/server", () => {
  class MockResponse {
    body: string;
    status: number;
    headers: Map<string, string>;
    constructor(body: string, init?: { status?: number; headers?: Record<string, string> }) {
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
  headers: Map<string, string>;
}

const callGET = async (url: string): Promise<MockRes> => {
  const res = (await GET(new Request(url))) as unknown as MockRes;
  return res;
};

describe("GET /api/skills/install.sh — input validation", () => {
  it("requires ?agent=", async () => {
    const res = await callGET("https://app.example.com/api/skills/install.sh");
    expect(res.status).toBe(400);
    expect(res.body).toContain("missing required ?agent=");
    expect(res.headers.get("Content-Type")).toContain("text/x-shellscript");
    // Plain-text errors must end with a non-zero exit so `curl … | bash` aborts.
    expect(res.body).toContain("exit 64");
  });

  it("rejects unknown agents", async () => {
    const res = await callGET(
      "https://app.example.com/api/skills/install.sh?agent=does-not-exist&scope=user",
    );
    expect(res.status).toBe(400);
    expect(res.body).toContain("unknown agent: does-not-exist");
  });

  it("requires ?scope= and rejects invalid values", async () => {
    const noScope = await callGET(
      "https://app.example.com/api/skills/install.sh?agent=claude",
    );
    expect(noScope.status).toBe(400);
    expect(noScope.body).toContain("missing or invalid ?scope=");

    const badScope = await callGET(
      "https://app.example.com/api/skills/install.sh?agent=claude&scope=root",
    );
    expect(badScope.status).toBe(400);
    expect(badScope.body).toContain("missing or invalid ?scope=");
  });

  it("rejects scope=project for Codex (user-only)", async () => {
    const res = await callGET(
      "https://app.example.com/api/skills/install.sh?agent=codex&scope=project",
    );
    expect(res.status).toBe(400);
    expect(res.body).toContain("agent codex does not support scope=project");
    expect(res.body).toContain("supported: user");
  });

  it("rejects scope=user for Spec Kit (project-only)", async () => {
    const res = await callGET(
      "https://app.example.com/api/skills/install.sh?agent=specify&scope=user",
    );
    expect(res.status).toBe(400);
    expect(res.body).toContain("agent specify does not support scope=user");
    expect(res.body).toContain("supported: project");
  });
});

describe("GET /api/skills/install.sh — script content", () => {
  it("returns a well-formed bash script with the expected headers", async () => {
    const res = await callGET(
      "https://app.example.com/api/skills/install.sh?agent=claude&scope=user",
    );
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toContain("text/x-shellscript");
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    expect(res.headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect(res.headers.get("Content-Disposition")).toBe(
      'attachment; filename="install-skills-claude-user.sh"',
    );

    expect(res.body.startsWith("#!/usr/bin/env bash")).toBe(true);
    expect(res.body).toContain("set -euo pipefail");
    // Single quotes around every templated value — the agent id is
    // single-quoted in the script.
    expect(res.body).toContain("AGENT_ID='claude'");
    expect(res.body).toContain("SCOPE='user'");
    expect(res.body).toContain("INSTALL_PATH_RAW='~/.claude/commands/skills.md'");
  });

  it("never inlines the catalog API key — the script reads it at runtime", async () => {
    const res = await callGET(
      "https://app.example.com/api/skills/install.sh?agent=claude&scope=user",
    );
    // The script must source the key from the environment / a flag, not from
    // a baked-in constant. None of these literals should appear.
    expect(res.body).not.toMatch(/CAIPE_CATALOG_KEY=['"][A-Za-z0-9]/);
    expect(res.body).not.toContain("X-Caipe-Catalog-Key: sk-");
    // It MUST read the env var and provide a flag fallback.
    expect(res.body).toContain('API_KEY="${CAIPE_CATALOG_KEY:-}"');
    expect(res.body).toContain("--api-key=");
  });

  it.each([
    ["claude", "user", "~/.claude/commands/skills.md"],
    ["claude", "project", "./.claude/commands/skills.md"],
    ["cursor", "user", "~/.cursor/commands/skills.md"],
    ["cursor", "project", "./.cursor/commands/skills.md"],
    ["specify", "project", "./.specify/templates/commands/skills.md"],
    ["codex", "user", "~/.codex/prompts/skills.md"],
    ["gemini", "user", "~/.gemini/commands/skills.toml"],
    ["gemini", "project", "./.gemini/commands/skills.toml"],
    ["continue", "user", "~/.continue/config.json"],
    ["continue", "project", "./.continue/config.json"],
  ])(
    "agent=%s scope=%s embeds the resolved install path %s",
    async (agent, scope, expectedPath) => {
      const res = await callGET(
        `https://app.example.com/api/skills/install.sh?agent=${agent}&scope=${scope}`,
      );
      expect(res.status).toBe(200);
      expect(res.body).toContain(`INSTALL_PATH_RAW='${expectedPath}'`);
      expect(res.headers.get("Content-Disposition")).toBe(
        `attachment; filename="install-skills-${agent}-${scope}.sh"`,
      );
    },
  );

  it("substitutes a custom command_name into the install path and bootstrap URL", async () => {
    const res = await callGET(
      "https://app.example.com/api/skills/install.sh?agent=claude&scope=project&command_name=my-skills",
    );
    expect(res.body).toContain("INSTALL_PATH_RAW='./.claude/commands/my-skills.md'");
    expect(res.body).toContain("COMMAND_NAME='my-skills'");
    // Bootstrap URL preserves the chosen agent/scope/command for re-fetch.
    expect(res.body).toMatch(
      /BOOTSTRAP_URL='https:\/\/app\.example\.com\/api\/skills\/bootstrap\?[^']*agent=claude/,
    );
    expect(res.body).toContain("scope=project");
    expect(res.body).toContain("command_name=my-skills");
  });

  it("sanitizes hostile command_name and falls back to 'skills'", async () => {
    const res = await callGET(
      "https://app.example.com/api/skills/install.sh?agent=claude&scope=project&command_name=" +
        encodeURIComponent("rm -rf /"),
    );
    expect(res.body).toContain("COMMAND_NAME='skills'");
    expect(res.body).toContain("INSTALL_PATH_RAW='./.claude/commands/skills.md'");
  });

  it("sanitizes hostile base_url and falls back to the request origin", async () => {
    const res = await callGET(
      "https://app.example.com/api/skills/install.sh?agent=claude&scope=user&base_url=" +
        encodeURIComponent("javascript:alert(1)"),
    );
    expect(res.body).toContain("BASE_URL='https://app.example.com'");
    // No javascript: URL sneaks through into the bootstrap callback.
    expect(res.body).not.toContain("javascript:");
  });

  it("Continue (fragment) generates a merge-instruction path, not a clobber", async () => {
    const res = await callGET(
      "https://app.example.com/api/skills/install.sh?agent=continue&scope=user",
    );
    expect(res.body).toContain("IS_FRAGMENT=1");
    // The script tells the user to merge into slashCommands rather than
    // overwriting their config.json.
    expect(res.body).toContain("slashCommands");
    expect(res.body).toContain("INSTALL_PATH_RAW='~/.continue/config.json'");
  });

  it("non-fragment agents get IS_FRAGMENT=0", async () => {
    const res = await callGET(
      "https://app.example.com/api/skills/install.sh?agent=claude&scope=user",
    );
    expect(res.body).toContain("IS_FRAGMENT=0");
  });

  it("guards overwrites by default and points users at --upgrade and --force", async () => {
    const res = await callGET(
      "https://app.example.com/api/skills/install.sh?agent=claude&scope=user",
    );
    // Both safe-rerun paths must be advertised in the bail-out message so
    // users have a non-destructive option (--upgrade) and an escape hatch
    // (--force).
    expect(res.body).toContain("--upgrade to replace a previously-installed");
    expect(res.body).toContain("--force to overwrite unconditionally");
    expect(res.body).toContain("FORCE=0");
    expect(res.body).toContain("UPGRADE=0");
  });

  it("--upgrade is a recognised flag and gates on the marker", async () => {
    const res = await callGET(
      "https://app.example.com/api/skills/install.sh?agent=claude&scope=user",
    );
    // Argument parser
    expect(res.body).toContain("--upgrade) UPGRADE=1");
    // Marker check uses grep -F (literal) against the agent/command tag
    expect(res.body).toContain('MARKER_TAG="caipe-skill: $AGENT_ID/$COMMAND_NAME"');
    expect(res.body).toContain('grep -Fq -- "$MARKER_TAG"');
    // Refusal path when marker is absent
    expect(res.body).toContain("was not installed by this script");
    // Usage block mentions both flags
    expect(res.body).toContain("[--upgrade|--force]");
  });

  it.each([
    ["claude", "user", "<!-- $MARKER_TAG -->"],
    ["cursor", "project", "<!-- $MARKER_TAG -->"],
    ["specify", "project", "<!-- $MARKER_TAG -->"],
    ["codex", "user", "<!-- $MARKER_TAG -->"],
    ["gemini", "user", "# $MARKER_TAG"],
  ])(
    "agent=%s scope=%s writes a format-appropriate marker comment",
    async (agent, scope, expectedMarker) => {
      const res = await callGET(
        `https://app.example.com/api/skills/install.sh?agent=${agent}&scope=${scope}`,
      );
      expect(res.body).toContain(expectedMarker);
    },
  );

  it("does not attempt to write a marker for fragment agents (Continue)", async () => {
    const res = await callGET(
      "https://app.example.com/api/skills/install.sh?agent=continue&scope=user",
    );
    // For Continue we deliberately fall through to MARKER_LINE="" so the
    // install short-circuits to the merge-instructions path. The HTML-comment
    // and TOML-comment branches MUST NOT be selected for it.
    expect(res.body).toContain("IS_FRAGMENT=1");
    // Defensive: if the case statement ever started emitting a marker for
    // Continue we'd corrupt user config.json. The script's MARKER_LINE for
    // unrecognised formats stays empty, and the `if [ -n "$MARKER_LINE" ]`
    // guard around the prepend keeps the write path JSON-safe.
    expect(res.body).toContain('if [ -n "$MARKER_LINE" ]; then');
  });

  it("honours a custom base_url on the bootstrap callback", async () => {
    const res = await callGET(
      "https://app.example.com/api/skills/install.sh?agent=gemini&scope=user&base_url=https://gateway.test.io",
    );
    expect(res.body).toContain("BASE_URL='https://gateway.test.io'");
    expect(res.body).toContain(
      "BOOTSTRAP_URL='https://gateway.test.io/api/skills/bootstrap?",
    );
  });
});
