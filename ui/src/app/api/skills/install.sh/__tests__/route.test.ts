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
 *     live-skills callback URL embeds the same parameters.
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

// All pre-existing tests assert the legacy `commands` layout AND the
// legacy single-skill flow. Two defaults shifted in this codebase:
//   1. The skills/<name>/SKILL.md toggle (layout=skills vs commands)
//   2. The bulk-with-helpers default (vs the old single-skill default)
// To keep ~350 lines of pre-existing assertions valid we inject
// `layout=commands` AND `mode=live-only` here. Coverage for the new
// bulk-with-helpers default mode lives in its own describe block at
// the bottom of this file.
const callGET = async (url: string): Promise<MockRes> => {
  const u = new URL(url);
  if (!u.searchParams.has("layout")) {
    u.searchParams.set("layout", "commands");
  }
  if (!u.searchParams.has("mode") && !u.searchParams.has("catalog_url")) {
    u.searchParams.set("mode", "live-only");
  }
  const res = (await GET(new Request(u.toString()))) as unknown as MockRes;
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
    // should read the API key out of the same config.json the live-skills
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

  it("substitutes a custom command_name into the install path and live-skills URL", async () => {
    const res = await callGET(
      "https://app.example.com/api/skills/install.sh?agent=claude&scope=project&command_name=my-skills",
    );
    expect(res.body).toContain("INSTALL_PATH_RAW='./.claude/commands/my-skills.md'");
    expect(res.body).toContain("COMMAND_NAME='my-skills'");
    // Live-skills URL preserves the chosen agent/scope/command for re-fetch.
    expect(res.body).toMatch(
      /LIVE_SKILLS_URL='https:\/\/app\.example\.com\/api\/skills\/live-skills\??[^']*agent=claude/,
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
    // No javascript: URL sneaks through into the live-skills callback.
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

  it("honours a custom base_url on the live-skills callback", async () => {
    const res = await callGET(
      "https://app.example.com/api/skills/install.sh?agent=gemini&scope=user&base_url=https://gateway.test.io",
    );
    expect(res.body).toContain("BASE_URL='https://gateway.test.io'");
    expect(res.body).toContain(
      "LIVE_SKILLS_URL='https://gateway.test.io/api/skills/live-skills?",
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
    // Bulk mode never bakes the live-skills template into the script — it
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

describe("GET /api/skills/install.sh — layout=skills (Shubham C: skills/<name>/SKILL.md)", () => {
  // Bypass the callGET wrapper so we drive `layout=skills` end-to-end and
  // exercise the new commandsDirFor() / bulk-install branches in the
  // legacy single-skill flow. We still pin mode=live-only because these
  // assertions are about the layout=skills behavior of the pre-existing
  // single-skill code path; the new bulk-with-helpers default has its
  // own layout-handling tests below.
  const callGetRaw = async (url: string): Promise<MockRes> => {
    const u = new URL(url);
    if (!u.searchParams.has("mode") && !u.searchParams.has("catalog_url")) {
      u.searchParams.set("mode", "live-only");
    }
    return (await GET(new Request(u.toString()))) as unknown as MockRes;
  };

  it("emits LAYOUT=skills and the parent skills dir as COMMANDS_DIR_RAW (Claude user scope)", async () => {
    const res = await callGetRaw(
      "https://app.example.com/api/skills/install.sh?agent=claude&scope=user&layout=skills",
    );
    expect(res.status).toBe(200);
    expect(res.body).toContain(`LAYOUT='skills'`);
    // commandsDirFor() must strip both `/{name}` AND `/SKILL.md` so the bulk
    // loop can mkdir per-skill subdirs underneath. If only one segment is
    // stripped, every skill collides at .../skills/SKILL.md.
    expect(res.body).toContain(`COMMANDS_DIR_RAW='~/.claude/skills'`);
    expect(res.body).toContain(`INSTALL_PATH_RAW='~/.claude/skills/skills/SKILL.md'`);
    expect(res.body).toContain(`FILE_EXT='md'`);
    // Bulk loop branch: per-skill dir + SKILL.md filename.
    expect(res.body).toContain(`if [ "$LAYOUT" = "skills" ]; then`);
    expect(res.body).toContain(`TARGET="$TARGET_DIR/SKILL.md"`);
  });

  it("project scope resolves to ./.cursor/skills for Cursor", async () => {
    const res = await callGetRaw(
      "https://app.example.com/api/skills/install.sh?agent=cursor&scope=project&layout=skills&command_name=mycmd",
    );
    expect(res.status).toBe(200);
    expect(res.body).toContain(`COMMANDS_DIR_RAW='./.cursor/skills'`);
    expect(res.body).toContain(`INSTALL_PATH_RAW='./.cursor/skills/mycmd/SKILL.md'`);
  });

  it("rejects layout=skills for agents that don't support it (codex)", async () => {
    const res = await callGetRaw(
      "https://app.example.com/api/skills/install.sh?agent=codex&scope=user&layout=skills",
    );
    // Per Shubham C, layout must be enforced server-side: silently falling
    // back would write SKILL.md into ~/.codex/prompts/, which Codex won't
    // discover.
    expect(res.status).toBe(400);
    expect(res.body).toMatch(/layout/i);
  });

  it("ignores unknown layout values and uses the agent default (claude → skills)", async () => {
    // We choose lenient fallback over 400 here so a typo'd `?layout=xyz` from
    // an old install.sh URL doesn't break user installs — the script still
    // produces a working artifact at the agent's documented default location.
    const res = await callGetRaw(
      "https://app.example.com/api/skills/install.sh?agent=claude&scope=user&layout=nonsense",
    );
    expect(res.status).toBe(200);
    expect(res.body).toContain(`LAYOUT='skills'`);
  });

  it("threads layout through to the live-skills callback URL", async () => {
    const res = await callGetRaw(
      "https://app.example.com/api/skills/install.sh?agent=claude&scope=user&layout=skills",
    );
    // The script re-fetches the rendered SKILL.md via LIVE_SKILLS_URL; that URL
    // must carry layout=skills or the callback would re-render with the wrong
    // frontmatter (no `name:` field).
    expect(res.body).toMatch(/LIVE_SKILLS_URL='[^']*[?&]layout=skills/);
  });
});

/**
 * The new default flow: when the caller passes neither `?catalog_url=`
 * nor `?mode=live-only`, the route returns a script that bulk-installs
 * the catalog AND drops the two helper slash commands AND (for Claude)
 * registers a SessionStart hook. These tests assert the structural
 * shape of the generated bash — the actual end-to-end behavior of
 * each step is exercised by the script in a sandbox elsewhere.
 *
 * No callGET wrapper here — we want the unmodified default to hit the
 * route so we can prove the default really is bulk-with-helpers.
 */
describe("GET /api/skills/install.sh — bulk-with-helpers (new default)", () => {
  const callRaw = async (url: string): Promise<MockRes> =>
    (await GET(new Request(url))) as unknown as MockRes;

  it("is the default mode when no ?mode= and no ?catalog_url= are supplied", async () => {
    const res = await callRaw(
      "https://app.example.com/api/skills/install.sh?agent=claude&scope=user",
    );
    expect(res.status).toBe(200);
    // Banner identifies the flow so a user reading the script knows
    // exactly which behavior to expect.
    expect(res.body).toContain("CAIPE bulk-with-helpers installer");
    expect(res.body).toContain("Mode   : bulk-with-helpers");
    // Filename suffix lets curl-piped users save with a meaningful name.
    expect(res.headers.get("Content-Disposition")).toContain(
      "install-skills-claude-user-bundle.sh",
    );
  });

  it("emits all four runtime opt-out flags so users can disable any step", async () => {
    const res = await callRaw(
      "https://app.example.com/api/skills/install.sh?agent=claude&scope=user",
    );
    // Each flag must be both documented in usage() AND parsed in the
    // arg loop, otherwise users discover broken flags only at runtime.
    for (const flag of ["--no-bulk", "--no-helpers", "--no-hook", "--upgrade"]) {
      expect(res.body).toContain(flag);
    }
  });

  it("references all helper URLs the script will fetch", async () => {
    const res = await callRaw(
      "https://app.example.com/api/skills/install.sh?agent=claude&scope=user",
    );
    // The script depends on five gateway endpoints — if any of these
    // disappear the install silently degrades, so they're worth pinning.
    expect(res.body).toMatch(/LIVE_SKILLS_URL=.*\/api\/skills\/live-skills/);
    expect(res.body).toMatch(/UPDATE_SKILLS_URL=.*\/api\/skills\/update-skills/);
    expect(res.body).toMatch(/HELPER_PY_URL=.*\/api\/skills\/helpers\/caipe-skills\.py/);
    expect(res.body).toMatch(/HOOK_SH_URL=.*\/api\/skills\/hooks\/caipe-catalog\.sh/);
    expect(res.body).toMatch(
      /BULK_CATALOG_URL=.*\/api\/skills\?[^']*include_content=true/,
    );
  });

  it("invokes the install steps in dependency order", async () => {
    // Order matters: legacy_cleanup must run before any writes (it deletes
    // by canonical path, not by manifest); seed_config must run before
    // helper_py (which the helper skills will read); helpers/bulk before
    // hook (so the hook isn't registered against an empty install).
    //
    // We can't use indexOf() against the whole body because the function
    // definitions appear in a different order than the call sequence at
    // the bottom of the script. Slice the script at the "Run the steps"
    // marker so we're matching the call list, not the definitions.
    const res = await callRaw(
      "https://app.example.com/api/skills/install.sh?agent=claude&scope=user",
    );
    const marker = "# ---------- Run the steps in order ----------";
    const callsSection = res.body.slice(res.body.indexOf(marker));
    expect(callsSection).not.toBe("");
    const idx = (s: string) => callsSection.indexOf(s);
    expect(idx("do_legacy_cleanup")).toBeGreaterThan(0);
    expect(idx("do_seed_config")).toBeGreaterThan(idx("do_legacy_cleanup"));
    expect(idx("do_install_helper_py")).toBeGreaterThan(idx("do_seed_config"));
    expect(idx("do_install_helpers")).toBeGreaterThan(
      idx("do_install_helper_py"),
    );
    expect(idx("do_install_bulk")).toBeGreaterThan(idx("do_install_helpers"));
    expect(idx("do_install_hook")).toBeGreaterThan(idx("do_install_bulk"));
  });

  it("only emits the SessionStart hook step for Claude", async () => {
    const claude = await callRaw(
      "https://app.example.com/api/skills/install.sh?agent=claude&scope=user",
    );
    const cursor = await callRaw(
      "https://app.example.com/api/skills/install.sh?agent=cursor&scope=user",
    );
    // Claude script flips the IS_CLAUDE flag on, so the hook function
    // is allowed to run. Cursor (no documented SessionStart hook today)
    // gets the same function definition but IS_CLAUDE=0 makes it a no-op.
    // IS_CLAUDE is a numeric literal in the generated bash (matches the
    // FORCE/UPGRADE/NO_BULK style), not a shell-quoted string.
    expect(claude.body).toMatch(/^IS_CLAUDE=1$/m);
    expect(cursor.body).toMatch(/^IS_CLAUDE=0$/m);
    // Settings.json patch is gated on IS_CLAUDE — so the patch python
    // block only matters in the Claude script. Both scripts include the
    // function; only Claude reaches the body.
    expect(claude.body).toContain("CLAUDE_SETTINGS_FILE=");
  });

  it("falls back to live-only for fragment-config agents (Continue)", async () => {
    // Continue can't bulk-install (its config.json holds slash commands
    // inline), so the new default must downgrade rather than 400. The
    // alternative — making the UI special-case `isFragment` agents —
    // would be invisible to users running the script directly.
    const res = await callRaw(
      "https://app.example.com/api/skills/install.sh?agent=continue&scope=user",
    );
    expect(res.status).toBe(200);
    // Banner from the legacy script identifies live-only mode by name.
    expect(res.body).toContain("Mode  : single live-skills skill");
    // No bulk-with-helpers banner.
    expect(res.body).not.toContain("CAIPE bulk-with-helpers installer");
  });

  it("rejects unknown ?mode= values with a 400", async () => {
    const res = await callRaw(
      "https://app.example.com/api/skills/install.sh?agent=claude&scope=user&mode=hybrid",
    );
    expect(res.status).toBe(400);
    expect(res.body).toContain("invalid ?mode= value");
  });

  it("explicit ?mode=bulk-with-helpers behaves identically to the default", async () => {
    // The UI may want to URL-encode the mode for clarity; assert that
    // the explicit form produces the same banner / filename so we can't
    // accidentally diverge the two code paths.
    const explicit = await callRaw(
      "https://app.example.com/api/skills/install.sh?agent=claude&scope=user&mode=bulk-with-helpers",
    );
    expect(explicit.body).toContain("CAIPE bulk-with-helpers installer");
    expect(explicit.headers.get("Content-Disposition")).toContain(
      "install-skills-claude-user-bundle.sh",
    );
  });

  it("explicit ?mode=live-only opts back into the legacy single-skill flow", async () => {
    const res = await callRaw(
      "https://app.example.com/api/skills/install.sh?agent=claude&scope=user&mode=live-only",
    );
    // No -bundle / -bulk suffix on the live-only filename.
    expect(res.headers.get("Content-Disposition")).toContain(
      "install-skills-claude-user.sh",
    );
    expect(res.headers.get("Content-Disposition")).not.toContain("-bundle");
    expect(res.body).toContain("Mode  : single live-skills skill");
  });

  it("never inlines the catalog API key in the generated script", async () => {
    const res = await callRaw(
      "https://app.example.com/api/skills/install.sh?agent=claude&scope=user",
    );
    // Same security guarantee as the legacy script — the key is asked
    // for at runtime via env / config / flag, never baked into the bash.
    expect(res.body).toContain("CAIPE_CATALOG_KEY");
    expect(res.body).toContain("X-Caipe-Catalog-Key");
    // No string that looks like a baked secret (rough heuristic — the
    // routes that bake URLs are explicitly tested above; nothing else
    // in the script should look like a secret).
    expect(res.body).not.toMatch(/api_key\s*[:=]\s*["'][A-Za-z0-9_-]{16,}/);
  });

  it("includes legacy cleanup logic guarded by --upgrade", async () => {
    const res = await callRaw(
      "https://app.example.com/api/skills/install.sh?agent=claude&scope=user",
    );
    // The two legacy artifacts the cleanup must remove — pin them by
    // canonical path so a future refactor can't silently stop deleting
    // either one.
    expect(res.body).toContain('"$COMMANDS_DIR/skills.md"');
    expect(res.body).toContain('"$CLAUDE_DIR/skills/skills"');
    // Cleanup must be guarded by --upgrade or it would surprise users
    // with destructive behavior on a fresh `curl ... | bash`.
    expect(res.body).toMatch(/\[ "\$UPGRADE" -eq 1 \] \|\| return 0/);
  });

  it("ships idempotent settings.json patching (refuses to clobber non-JSON, dedups hooks)", async () => {
    const res = await callRaw(
      "https://app.example.com/api/skills/install.sh?agent=claude&scope=user",
    );
    // Idempotence is checked by inspecting the embedded python: it
    // walks existing SessionStart entries before appending and only
    // adds the allowlist rule when missing.
    expect(res.body).toContain("already_registered");
    expect(res.body).toContain('Bash(uv run ~/.config/caipe/caipe-skills.py*)');
    expect(res.body).toContain('Bash(python3 ~/.config/caipe/caipe-skills.py*)');
    // Refusal to clobber non-JSON: the embedded python prints a warning
    // and exits 0 instead of overwriting the broken file.
    expect(res.body).toContain("is not valid JSON; skipping hook registration");
  });

  it("reserves the helper command names so the bulk loop can't clobber them", async () => {
    // If the catalog ever ships a skill named `skills` or
    // `update-skills`, the bulk loop must NOT overwrite the helper
    // command we just installed in the same script run.
    const res = await callRaw(
      "https://app.example.com/api/skills/install.sh?agent=claude&scope=user",
    );
    expect(res.body).toContain('RESERVED = {"skills", "update-skills"}');
  });

  it("auto-seeds the config file with base_url only (never api_key)", async () => {
    const res = await callRaw(
      "https://app.example.com/api/skills/install.sh?agent=claude&scope=user",
    );
    // The seed must be additive — only base_url, never api_key. This is
    // the contract the `do_seed_config` step relies on when claiming it
    // is safe to run on every install (existing files are skipped, and
    // a fresh seed never contains a secret to leak).
    expect(res.body).toContain('"base_url": base_url');
    expect(res.body).not.toMatch(/data\s*=\s*\{[^}]*"api_key"/);
  });
});

/**
 * Regression coverage for the security-scanner gate. A skill the
 * scanner has flagged must NEVER reach disk via any install.sh code
 * path -- the agent's native discovery (Claude/Cursor walking the
 * skills directory at startup) would otherwise pick it up regardless
 * of UI runnability state. Three predicates are checked, mirroring
 * applyRunnableGate in the listing route:
 *   - scan_status === "flagged"
 *   - runnable === false
 *   - blocked_reason === "scan_flagged"
 *
 * Bash filters live in two emitters per install mode (bulk-with-helpers
 * uses one Python heredoc; catalog-query uses a python -c block plus
 * a jq fallback). All four sites must carry the predicate or a regression
 * silently leaks flagged content again.
 */
describe("GET /api/skills/install.sh — flagged-skill security gate", () => {
  const callRaw = async (url: string): Promise<MockRes> =>
    (await GET(new Request(url))) as unknown as MockRes;

  it("bulk-with-helpers Python loop checks all three flag signals", async () => {
    const res = await callRaw(
      "https://app.example.com/api/skills/install.sh?agent=claude&scope=user",
    );
    expect(res.body).toContain('def is_flagged(skill):');
    // All three predicates -- pinning by name catches a future refactor
    // that, say, drops blocked_reason "because scan_status covers it"
    // (the gateway can stamp either one independently).
    expect(res.body).toContain('skill.get("scan_status") == "flagged"');
    expect(res.body).toContain('skill.get("runnable") is False');
    expect(res.body).toContain('skill.get("blocked_reason") == "scan_flagged"');
    // User-visible notice: the bash output must tell the user exactly
    // what was suppressed (silent-skip would surprise admins debugging
    // why their newly-published skill didn't land).
    expect(res.body).toContain('flagged by security scanner');
    // Summary line must include the flagged tally so wrote+skipped+
    // reserved+flagged sums to total -- no quietly-lost skills.
    expect(res.body).toMatch(/flagged \{flagged_count\}/);
  });

  it("catalog-query Python emitter mirrors the same flag signals", async () => {
    const res = await callRaw(
      "https://app.example.com/api/skills/install.sh?agent=claude&scope=user&catalog_url=https%3A%2F%2Fapp.example.com%2Fapi%2Fskills%3Fpage%3D1",
    );
    expect(res.body).toContain('def is_flagged(s):');
    expect(res.body).toContain('s.get("scan_status") == "flagged"');
    expect(res.body).toContain('s.get("runnable") is False');
    expect(res.body).toContain('s.get("blocked_reason") == "scan_flagged"');
    // Skip notices go to STDERR in this emitter (stdout carries the
    // NUL-delimited triples the bash while-read loop consumes; mixing
    // text into that stream would corrupt the install).
    expect(res.body).toMatch(/err\.write\(f"==> skipped \{name\} \(flagged by security scanner\)/);
  });

  it("catalog-query jq fallback mirrors the same flag signals", async () => {
    // Some operator environments only have jq, not python3. The jq
    // emitter MUST carry the same gate or the install silently
    // degrades into the original leak when python3 is missing.
    const res = await callRaw(
      "https://app.example.com/api/skills/install.sh?agent=claude&scope=user&catalog_url=https%3A%2F%2Fapp.example.com%2Fapi%2Fskills%3Fpage%3D1",
    );
    // Predicate inside the jq emitter selects clean skills only.
    expect(res.body).toContain('(.scan_status? // "") != "flagged"');
    expect(res.body).toContain('(.runnable? // true) != false');
    expect(res.body).toContain('(.blocked_reason? // "") != "scan_flagged"');
    // Second jq invocation prints the skip-notice list to stderr so the
    // user sees what was suppressed under the jq path too.
    expect(res.body).toMatch(/select\(\s*\(\.scan_status\? \/\/ ""\) == "flagged"/);
    expect(res.body).toContain('(flagged by security scanner)');
  });

  it("live-only mode keeps BULK_MODE=0 so the bulk emitter (and its filter) never runs", async () => {
    // live-only and catalog-query share the legacy script template, so
    // the is_flagged predicate is always emitted in the bash text. The
    // semantic gate is BULK_MODE: live-only sets it to 0 which short-
    // circuits the emitter entirely. Pinning this prevents a future
    // refactor from quietly turning live-only into a bulk install.
    const res = await callRaw(
      "https://app.example.com/api/skills/install.sh?agent=claude&scope=user&mode=live-only",
    );
    expect(res.body).toContain('BULK_MODE=0');
    expect(res.body).not.toContain('BULK_MODE=1');
  });
});
