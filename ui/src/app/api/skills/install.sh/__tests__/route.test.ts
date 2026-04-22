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
    // The script must source the key from the environment / a flag / config
    // file, not from a baked-in constant. None of these literals should
    // appear.
    expect(res.body).not.toMatch(/CAIPE_CATALOG_KEY=['"][A-Za-z0-9]/);
    expect(res.body).not.toContain("X-Caipe-Catalog-Key: sk-");
    // It MUST read the env var and provide a flag fallback.
    expect(res.body).toContain('API_KEY="${CAIPE_CATALOG_KEY:-}"');
    expect(res.body).toContain("--api-key=");
  });

  it("falls back to ~/.config/caipe/config.json when no key is supplied", async () => {
    const res = await callGET(
      "https://app.example.com/api/skills/install.sh?agent=claude&scope=user",
    );
    // Per Jeff Napper's PR #1268 review feedback (#1): the install script
    // should read the API key out of the same config.json the bootstrap
    // helper writes, so users don't have to pass it on every invocation.
    expect(res.body).toContain("read_api_key_from_config");
    expect(res.body).toContain("/.config/caipe/config.json");
    // We also try the shared dotfile location used by other Outshift
    // tooling, so a single key works across surfaces.
    expect(res.body).toContain("/.config/grid/config.json");
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

  it("--upgrade is a recognised flag and gates on the sidecar manifest", async () => {
    const res = await callGET(
      "https://app.example.com/api/skills/install.sh?agent=claude&scope=user",
    );
    // Argument parser
    expect(res.body).toContain("--upgrade) UPGRADE=1");
    // Per PR #1268 review feedback (Shubham Bakshi #C): we no longer prepend
    // a `<!-- caipe-skill: … -->` marker into the installed file. Ownership
    // is tracked in a sidecar manifest at ~/.config/caipe/installed.json so
    // the file on disk is byte-for-byte the catalog content. --upgrade
    // consults the manifest, not a marker grep.
    expect(res.body).toContain("MANIFEST_PATH=");
    expect(res.body).toContain("/.config/caipe/installed.json");
    expect(res.body).toContain("manifest_owns");
    expect(res.body).toContain("manifest_register");
    // Refusal path now mentions the manifest, not a marker.
    expect(res.body).toContain("not tracked by");
    // Usage block mentions both flags
    expect(res.body).toContain("[--upgrade|--force]");
  });

  it("does NOT prepend ownership markers into installed files", async () => {
    // Per PR #1268 review feedback (Shubham Bakshi): the
    // `<!-- caipe-skill: … -->` marker line was confusing reviewers who
    // diffed the installed file against the upstream skill source. The
    // installed body is now written verbatim and ownership lives in the
    // sidecar manifest. Guard against any regression that re-introduces
    // marker comments.
    const claudeRes = await callGET(
      "https://app.example.com/api/skills/install.sh?agent=claude&scope=user",
    );
    expect(claudeRes.body).not.toContain("MARKER_TAG=");
    expect(claudeRes.body).not.toContain("MARKER_PREFIX=");
    expect(claudeRes.body).not.toContain("MARKER_SUFFIX=");
    expect(claudeRes.body).not.toContain("MARKER_LINE=");
    expect(claudeRes.body).not.toContain('caipe-skill: $AGENT_ID');

    const geminiRes = await callGET(
      "https://app.example.com/api/skills/install.sh?agent=gemini&scope=user",
    );
    expect(geminiRes.body).not.toContain("MARKER_PREFIX=");
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

describe("GET /api/skills/install.sh — bulk install via ?catalog_url=", () => {
  const sameOriginCatalog = encodeURIComponent(
    "https://app.example.com/api/skills?q=jira&page=1&page_size=20",
  );

  it("switches to bulk mode when a same-origin catalog_url is supplied", async () => {
    const res = await callGET(
      `https://app.example.com/api/skills/install.sh?agent=claude&scope=user&catalog_url=${sameOriginCatalog}`,
    );
    expect(res.status).toBe(200);
    expect(res.body).toContain("BULK_MODE=1");
    // Always force include_content=true so the script has bodies to write.
    expect(res.body).toMatch(
      /CATALOG_URL='https:\/\/app\.example\.com\/api\/skills\?[^']*include_content=true[^']*'/,
    );
    // Bulk filename hint helps users distinguish saved scripts.
    expect(res.headers.get("Content-Disposition")).toContain(
      'filename="install-skills-claude-user-bulk.sh"',
    );
    // Bulk mode never bakes the bootstrap template into the script — it
    // walks the catalog response and writes one file per skill into the
    // commands directory derived from the agent's installPaths entry.
    expect(res.body).toContain("COMMANDS_DIR_RAW='~/.claude/commands'");
    expect(res.body).toContain("FILE_EXT='md'");
    expect(res.body).toContain('mkdir -p "$COMMANDS_DIR"');
    // Per-skill ownership in bulk mode is also tracked through the sidecar
    // manifest (no marker comments prepended into the file body).
    expect(res.body).toContain("manifest_register");
    expect(res.body).not.toContain("MARKER_TAG=");
  });

  it("rejects a catalog_url that points off-origin", async () => {
    const evil = encodeURIComponent("https://attacker.example.com/api/skills");
    const res = await callGET(
      `https://app.example.com/api/skills/install.sh?agent=claude&scope=user&catalog_url=${evil}`,
    );
    expect(res.status).toBe(400);
    expect(res.body).toContain("invalid ?catalog_url=");
  });

  it("rejects a catalog_url that points at a non-/api/skills path", async () => {
    const wrongPath = encodeURIComponent(
      "https://app.example.com/api/skills/install.sh?evil=1",
    );
    const res = await callGET(
      `https://app.example.com/api/skills/install.sh?agent=claude&scope=user&catalog_url=${wrongPath}`,
    );
    expect(res.status).toBe(400);
    expect(res.body).toContain("invalid ?catalog_url=");
  });

  it("rejects bulk install for fragment-config agents (Continue)", async () => {
    const res = await callGET(
      `https://app.example.com/api/skills/install.sh?agent=continue&scope=user&catalog_url=${sameOriginCatalog}`,
    );
    expect(res.status).toBe(400);
    expect(res.body).toContain("bulk install via ?catalog_url= is not supported");
  });

  it("derives gemini-toml extension in bulk mode", async () => {
    const res = await callGET(
      `https://app.example.com/api/skills/install.sh?agent=gemini&scope=user&catalog_url=${sameOriginCatalog}`,
    );
    expect(res.body).toContain("FILE_EXT='toml'");
    // No marker prefix/suffix is emitted any more — see the
    // "does NOT prepend ownership markers" test for the rationale.
    expect(res.body).not.toContain("MARKER_PREFIX=");
  });

  it("does not switch to bulk mode when catalog_url is absent", async () => {
    const res = await callGET(
      "https://app.example.com/api/skills/install.sh?agent=claude&scope=user",
    );
    expect(res.body).toContain("BULK_MODE=0");
    expect(res.body).toContain("CATALOG_URL=''");
    // Single-skill filename (no -bulk suffix).
    expect(res.headers.get("Content-Disposition")).toContain(
      'filename="install-skills-claude-user.sh"',
    );
  });
});
