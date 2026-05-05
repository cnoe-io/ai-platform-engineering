/**
 * @jest-environment node
 *
 * Tests for GET /api/skills/install.sh after the skills-only overhaul.
 *
 * Covers:
 *   - Required parameters (agent, scope) are enforced with HTTP 400 +
 *     a plain-text error the shell can `exit` on.
 *   - The generated bash script is well-formed: starts with
 *     `#!/usr/bin/env bash`, runs under `set -euo pipefail`, and never
 *     inlines the catalog API key (the script asks for it at runtime).
 *   - Per-agent + per-scope install paths are resolved as a multi-target
 *     bash array — both the agent-specific tree
 *     (`~/.claude/skills/<name>/SKILL.md`) AND the vendor-neutral mirror
 *     (`~/.agents/skills/<name>/SKILL.md`).
 *   - User-supplied `command_name` is templated into the install paths;
 *     the live-skills callback URL embeds the same parameters.
 *   - Hostile inputs (bad command_name, bad base_url) are sanitized.
 *   - Backward-compat: `?layout=...` is silently accepted and ignored.
 *   - Default mode is `bulk-with-helpers`; explicit `mode=live-only`
 *     downgrades to a single-skill flow; `?catalog_url=` switches to
 *     the catalog-query mode; `mode=uninstall` switches to the
 *     uninstall script.
 *   - --upgrade legacy cleanup pass covers all five agents' commands-
 *     layout artifacts.
 *   - Manifest entries use the new `paths: []` shape.
 *   - Flagged-skill security gate is preserved.
 */

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
  headers: Map<string, string>;
}

const callGET = async (url: string): Promise<MockRes> =>
  (await GET(new Request(url))) as unknown as MockRes;

describe("GET /api/skills/install.sh — input validation", () => {
  // After the unified-install UX overhaul, ?agent= is optional in
  // EVERY mode. The route defaults to claude (DEFAULT_AGENT_ID) so a
  // bare URL with just ?scope= still produces a runnable script. The
  // failure mode shifts to "missing or invalid ?scope=" because the
  // scope is the only thing the script can't infer.
  it("does NOT require ?agent= (defaults to claude); missing ?scope= is the new gating error", async () => {
    const res = await callGET("https://app.example.com/api/skills/install.sh");
    expect(res.status).toBe(400);
    expect(res.body).toContain("missing or invalid ?scope=");
    expect(res.headers.get("Content-Type")).toContain("text/x-shellscript");
    expect(res.body).toContain("exit 64");
  });

  it("accepts a bare ?scope=user with no ?agent= (defaults to claude)", async () => {
    const res = await callGET(
      "https://app.example.com/api/skills/install.sh?scope=user",
    );
    expect(res.status).toBe(200);
    expect(res.body).toContain("install-skills");
    expect(res.headers.get("Content-Type")).toContain("text/x-shellscript");
  });

  it("rejects unknown agents", async () => {
    const res = await callGET(
      "https://app.example.com/api/skills/install.sh?agent=does-not-exist&scope=user",
    );
    expect(res.status).toBe(400);
    expect(res.body).toContain("unknown agent: does-not-exist");
  });

  it("requires ?scope= for non-uninstall modes", async () => {
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

  it("rejects continue and specify (dropped from the registry)", async () => {
    const cont = await callGET(
      "https://app.example.com/api/skills/install.sh?agent=continue&scope=user",
    );
    expect(cont.status).toBe(400);
    expect(cont.body).toContain("unknown agent: continue");

    const spec = await callGET(
      "https://app.example.com/api/skills/install.sh?agent=specify&scope=project",
    );
    expect(spec.status).toBe(400);
    expect(spec.body).toContain("unknown agent: specify");
  });

  it("backward-compat: ?layout=... is silently accepted and ignored", async () => {
    // Pre-overhaul one-liners may still set layout=skills or
    // layout=commands. The route MUST NOT error -- it should produce a
    // valid SKILL.md install script either way.
    for (const layout of ["skills", "commands", "nonsense"]) {
      const res = await callGET(
        `https://app.example.com/api/skills/install.sh?agent=claude&scope=user&layout=${layout}`,
      );
      expect(res.status).toBe(200);
      expect(res.body.startsWith("#!/usr/bin/env bash")).toBe(true);
    }
  });

  it("rejects unknown ?mode= values with 400", async () => {
    const res = await callGET(
      "https://app.example.com/api/skills/install.sh?agent=claude&scope=user&mode=hybrid",
    );
    expect(res.status).toBe(400);
    expect(res.body).toContain("invalid ?mode= value");
  });
});

describe("GET /api/skills/install.sh — script content (bulk-with-helpers default)", () => {
  it("returns a well-formed bash script with the expected headers", async () => {
    const res = await callGET(
      "https://app.example.com/api/skills/install.sh?agent=claude&scope=user",
    );
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toContain("text/x-shellscript");
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    expect(res.headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect(res.headers.get("Content-Disposition")).toBe(
      'attachment; filename="install-skills-claude-user-bundle.sh"',
    );

    expect(res.body.startsWith("#!/usr/bin/env bash")).toBe(true);
    expect(res.body).toContain("set -euo pipefail");
    expect(res.body).toContain("AGENT_ID='claude'");
    expect(res.body).toContain("SCOPE='user'");
  });

  it("emits multi-target SKILL_PATH_TEMPLATES and SKILL_ROOT_DIRS arrays", async () => {
    const res = await callGET(
      "https://app.example.com/api/skills/install.sh?agent=claude&scope=user",
    );
    // Both arrays MUST be present and contain the agent-specific tree
    // AND the vendor-neutral mirror so a single install satisfies every
    // supported agent.
    expect(res.body).toContain("SKILL_PATH_TEMPLATES=(");
    expect(res.body).toContain("'~/.claude/skills/{name}/SKILL.md'");
    expect(res.body).toContain("'~/.agents/skills/{name}/SKILL.md'");
    expect(res.body).toContain("SKILL_ROOT_DIRS=(");
    expect(res.body).toContain("'~/.claude/skills'");
    expect(res.body).toContain("'~/.agents/skills'");
  });

  it("project-scope paths use ./ prefix", async () => {
    const res = await callGET(
      "https://app.example.com/api/skills/install.sh?agent=claude&scope=project",
    );
    expect(res.body).toContain("'./.claude/skills/{name}/SKILL.md'");
    expect(res.body).toContain("'./.agents/skills/{name}/SKILL.md'");
  });

  it("never inlines the catalog API key", async () => {
    const res = await callGET(
      "https://app.example.com/api/skills/install.sh?agent=claude&scope=user",
    );
    expect(res.body).not.toMatch(/CAIPE_CATALOG_KEY=['"][A-Za-z0-9]/);
    expect(res.body).not.toContain("X-Caipe-Catalog-Key: sk-");
    expect(res.body).toContain('API_KEY="${CAIPE_CATALOG_KEY:-}"');
    expect(res.body).toContain("--api-key=");
  });

  it("falls back to ~/.config/caipe/config.json when no key is supplied", async () => {
    const res = await callGET(
      "https://app.example.com/api/skills/install.sh?agent=claude&scope=user",
    );
    expect(res.body).toContain("read_api_key_from_config");
    expect(res.body).toContain("/.config/caipe/config.json");
    expect(res.body).toContain("/.config/grid/config.json");
  });

  it.each([
    ["claude", "user", "~/.claude/skills/{name}/SKILL.md"],
    ["claude", "project", "./.claude/skills/{name}/SKILL.md"],
    ["cursor", "user", "~/.claude/skills/{name}/SKILL.md"],
    ["codex", "user", "~/.claude/skills/{name}/SKILL.md"],
    ["gemini", "user", "~/.claude/skills/{name}/SKILL.md"],
    ["opencode", "user", "~/.claude/skills/{name}/SKILL.md"],
  ])(
    "agent=%s scope=%s embeds the universal install path %s",
    async (agent, scope, expectedPath) => {
      const res = await callGET(
        `https://app.example.com/api/skills/install.sh?agent=${agent}&scope=${scope}`,
      );
      expect(res.status).toBe(200);
      expect(res.body).toContain(`'${expectedPath}'`);
      expect(res.headers.get("Content-Disposition")).toBe(
        `attachment; filename="install-skills-${agent}-${scope}-bundle.sh"`,
      );
    },
  );

  it("substitutes a custom command_name into all relevant URLs", async () => {
    const res = await callGET(
      "https://app.example.com/api/skills/install.sh?agent=claude&scope=project&command_name=my-skills",
    );
    expect(res.body).toContain("COMMAND_NAME='my-skills'");
    // Live-skills + update-skills URLs preserve the chosen agent/scope.
    expect(res.body).toMatch(
      /LIVE_SKILLS_URL='https:\/\/app\.example\.com\/api\/skills\/live-skills\?[^']*agent=claude/,
    );
    expect(res.body).toMatch(
      /UPDATE_SKILLS_URL='https:\/\/app\.example\.com\/api\/skills\/update-skills\?[^']*agent=claude/,
    );
    // Universal-path templates carry {name} (the bash side substitutes
    // {COMMAND_NAME} at install time).
    expect(res.body).toContain("'./.claude/skills/{name}/SKILL.md'");
  });

  it("sanitizes hostile command_name and falls back to 'skills'", async () => {
    const res = await callGET(
      "https://app.example.com/api/skills/install.sh?agent=claude&scope=project&command_name=" +
        encodeURIComponent("rm -rf /"),
    );
    expect(res.body).toContain("COMMAND_NAME='skills'");
  });

  it("sanitizes hostile base_url and falls back to the request origin", async () => {
    const res = await callGET(
      "https://app.example.com/api/skills/install.sh?agent=claude&scope=user&base_url=" +
        encodeURIComponent("javascript:alert(1)"),
    );
    expect(res.body).toContain("BASE_URL='https://app.example.com'");
    expect(res.body).not.toContain("javascript:");
  });

  it("emits all four runtime opt-out flags so users can disable any step", async () => {
    const res = await callGET(
      "https://app.example.com/api/skills/install.sh?agent=claude&scope=user",
    );
    for (const flag of ["--no-bulk", "--no-helpers", "--no-hook", "--upgrade"]) {
      expect(res.body).toContain(flag);
    }
  });

  it("references all helper URLs the script will fetch", async () => {
    const res = await callGET(
      "https://app.example.com/api/skills/install.sh?agent=claude&scope=user",
    );
    expect(res.body).toMatch(/LIVE_SKILLS_URL=.*\/api\/skills\/live-skills/);
    expect(res.body).toMatch(/UPDATE_SKILLS_URL=.*\/api\/skills\/update-skills/);
    expect(res.body).toMatch(
      /HELPER_PY_URL=.*\/api\/skills\/helpers\/caipe-skills\.py/,
    );
    expect(res.body).toMatch(/HOOK_SH_URL=.*\/api\/skills\/hooks\/caipe-catalog\.sh/);
    expect(res.body).toMatch(
      /BULK_CATALOG_URL=.*\/api\/skills\?[^']*include_content=true/,
    );
  });

  it("invokes the install steps in dependency order", async () => {
    const res = await callGET(
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

  it("only emits IS_CLAUDE=1 / DO_HOOK=1 for Claude", async () => {
    const claude = await callGET(
      "https://app.example.com/api/skills/install.sh?agent=claude&scope=user",
    );
    const cursor = await callGET(
      "https://app.example.com/api/skills/install.sh?agent=cursor&scope=user",
    );
    expect(claude.body).toMatch(/^IS_CLAUDE=1$/m);
    expect(claude.body).toMatch(/^DO_HOOK=1$/m);
    expect(cursor.body).toMatch(/^IS_CLAUDE=0$/m);
    expect(cursor.body).toMatch(/^DO_HOOK=0$/m);
  });

  it("auto-seeds the config file with base_url only (never api_key)", async () => {
    const res = await callGET(
      "https://app.example.com/api/skills/install.sh?agent=claude&scope=user",
    );
    expect(res.body).toContain('"base_url": base_url');
    // Seed must not pre-populate api_key — that field is the user's.
    expect(res.body).not.toMatch(/data\s*=\s*\{[^}]*"api_key"/);
  });

  it("ships idempotent settings.json patching (refuses to clobber non-JSON)", async () => {
    const res = await callGET(
      "https://app.example.com/api/skills/install.sh?agent=claude&scope=user",
    );
    expect(res.body).toContain("already_registered");
    expect(res.body).toContain("is not valid JSON; skipping hook registration");
  });

  it("does NOT add the legacy allowlist entries on hook install (relies on SKILL.md frontmatter instead)", async () => {
    // After the overhaul, helpers' SKILL.md frontmatter declares
    // allowed-tools natively, so the install-time settings.json patch
    // no longer touches `permissions.allow`. Pin this so we don't
    // regress and start adding the legacy entries again.
    const res = await callGET(
      "https://app.example.com/api/skills/install.sh?agent=claude&scope=user",
    );
    // The do_install_hook function must NOT inject the WANTED allowlist
    // rules anymore. We grab the function body bounds and assert.
    const fnStart = res.body.indexOf("do_install_hook() {");
    const fnEnd = res.body.indexOf("# ---------- Step:", fnStart + 1);
    const fn = res.body.slice(fnStart, fnEnd);
    expect(fn).not.toMatch(/WANTED\s*=\s*\[/);
    expect(fn).not.toMatch(
      /allow\.append\(rule\)/,
    );
  });

  it("--upgrade legacy cleanup covers commands-layout artifacts for all 5 agents", async () => {
    const res = await callGET(
      "https://app.example.com/api/skills/install.sh?agent=claude&scope=user",
    );
    // The cleanup function must touch every supported agent's
    // commands-layout path so a user upgrading from any prior install
    // gets a clean slate. Pin one canonical path per agent (user scope).
    expect(res.body).toContain('"$home/.claude/commands/skills.md"');
    expect(res.body).toContain('"$home/.cursor/commands/skills.md"');
    expect(res.body).toContain('"$home/.codex/prompts/skills.md"');
    expect(res.body).toContain('"$home/.gemini/commands/skills.toml"');
    expect(res.body).toContain('"$home/.config/opencode/command/skills.md"');
    // Cleanup must be guarded by --upgrade or it would surprise users
    // with destructive behavior on a fresh `curl ... | bash`.
    expect(res.body).toMatch(/\[ "\$UPGRADE" -eq 1 \] \|\| return 0/);
  });

  it("--upgrade legacy cleanup also strips the two stale allowlist entries", async () => {
    // The do_install_hook step no longer adds these, but older
    // installs may have left them in ~/.claude/settings.json.
    // do_legacy_cleanup must surgically remove them while preserving
    // every other entry in the user's settings file.
    const res = await callGET(
      "https://app.example.com/api/skills/install.sh?agent=claude&scope=user",
    );
    expect(res.body).toContain(
      'Bash(uv run ~/.config/caipe/caipe-skills.py*)',
    );
    expect(res.body).toContain(
      'Bash(python3 ~/.config/caipe/caipe-skills.py*)',
    );
    expect(res.body).toContain('stripped legacy allowlist entries from');
  });

  it("manifest entries use the new `paths` array shape (not legacy `path`)", async () => {
    const res = await callGET(
      "https://app.example.com/api/skills/install.sh?agent=claude&scope=user",
    );
    // The Python manifest writer in do_install_bulk emits an entry
    // whose "paths" field is an array of universal-target paths.
    expect(res.body).toMatch(/"paths":\s*written_paths_for_skill/);
    // The single-skill emit path (write_to_all_targets) also uses
    // paths-array via manifest_register_paths.
    expect(res.body).toContain("manifest_register_paths");
    // The legacy single-"path" shape is READ transparently for back-
    // compat (so `manifest_owns` works on old manifests), but never
    // WRITTEN. Pin the read-side fallback expression and assert that
    // we never write the legacy shape.
    expect(res.body).toContain('e.get("path")');
    expect(res.body).not.toMatch(/^[\s]*"path":\s*target/m);
  });

  it("includes a project-scope .gitignore reminder mentioning all three dotfile dirs", async () => {
    const res = await callGET(
      "https://app.example.com/api/skills/install.sh?agent=claude&scope=project",
    );
    // Project-scope success card surfaces the recommendation; pin all
    // three so a future refactor doesn't drop one quietly.
    expect(res.body).toContain(".caipe/");
    expect(res.body).toContain(".claude/");
    expect(res.body).toContain(".agents/");
  });
});

describe("GET /api/skills/install.sh — bulk install via ?catalog_url=", () => {
  const sameOriginCatalog = encodeURIComponent(
    "https://app.example.com/api/skills?q=jira&page=1&page_size=20",
  );

  it("switches to bulk filename when a same-origin catalog_url is supplied", async () => {
    const res = await callGET(
      `https://app.example.com/api/skills/install.sh?agent=claude&scope=user&catalog_url=${sameOriginCatalog}`,
    );
    expect(res.status).toBe(200);
    // catalog-query mode reuses the same multi-target install code path
    // as bulk-with-helpers (DO_BULK=1) but skips helpers + hook.
    expect(res.body).toMatch(/^DO_BULK=1$/m);
    expect(res.body).toMatch(/^DO_HELPERS=0$/m);
    expect(res.body).toMatch(/^DO_HOOK=0$/m);
    // include_content is forced on so the script has bodies to write.
    expect(res.body).toMatch(
      /BULK_CATALOG_URL='https:\/\/app\.example\.com\/api\/skills\?[^']*include_content=true[^']*'/,
    );
    expect(res.headers.get("Content-Disposition")).toContain(
      'filename="install-skills-claude-user-bulk.sh"',
    );
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

  // Regression for the "/update-skills doesn't autocomplete in Claude
  // Code after a Quick Install" symptom. The Quick Install modal
  // always includes ?catalog_url= because it pipes the user's
  // chosen catalog page through. Without this branch in the route's
  // mode-resolution, ?catalog_url= silently downgraded to
  // catalog-query mode (DO_HELPERS=0) and the helper SKILL.md files
  // never landed on disk.
  it("?catalog_url= + ?mode=bulk-with-helpers honors the explicit mode override", async () => {
    const res = await callGET(
      `https://app.example.com/api/skills/install.sh?agent=claude&scope=user&catalog_url=${sameOriginCatalog}&mode=bulk-with-helpers`,
    );
    expect(res.status).toBe(200);
    // The user's catalog URL is still used for the bulk fetch — the
    // mode override only flips on helpers + the SessionStart hook,
    // it doesn't change which page of the catalog gets installed.
    expect(res.body).toMatch(/^DO_BULK=1$/m);
    expect(res.body).toMatch(/^DO_HELPERS=1$/m);
    expect(res.body).toMatch(/^DO_HOOK=1$/m);
    expect(res.body).toMatch(
      /BULK_CATALOG_URL='https:\/\/app\.example\.com\/api\/skills\?[^']*include_content=true[^']*'/,
    );
    // Filename uses the bundle suffix — the script installs the full
    // bulk-with-helpers payload, not the catalog-query subset.
    expect(res.headers.get("Content-Disposition")).toContain(
      "install-skills-claude-user-bundle.sh",
    );
  });

  it("?catalog_url= without mode= still defaults to catalog-query (helpers off)", async () => {
    // Backward-compat guard: any old copy-pasted curl that doesn't
    // pass mode=bulk-with-helpers must keep its previous behaviour
    // so we don't surprise users who relied on "catalog only" being
    // the implicit semantics of catalog_url=.
    const res = await callGET(
      `https://app.example.com/api/skills/install.sh?agent=claude&scope=user&catalog_url=${sameOriginCatalog}`,
    );
    expect(res.status).toBe(200);
    expect(res.body).toMatch(/^DO_HELPERS=0$/m);
    expect(res.body).toMatch(/^DO_HOOK=0$/m);
  });
});

describe("GET /api/skills/install.sh — heredoc-vs-stdin regression", () => {
  // Regression for a real bug observed in production: the bulk-install
  // Python helper used `printf '%s\n' "${ROOTS[@]}" | python3 - ... <<'PY'`
  // which is silently broken because bash's `<<HEREDOC` redirects
  // stdin to the heredoc body, discarding anything piped in. Result:
  // `roots = []` inside the Python script -> `wrote 0 files for N/N
  // skills (skipped 0)`. The fix passes paths as trailing positional
  // args. These assertions guard against regressing back to a piped-
  // stdin pattern.
  it("bulk install passes RESOLVED_SKILL_ROOTS as positional args, not via stdin pipe", async () => {
    const res = await callGET(
      "https://app.example.com/api/skills/install.sh?agent=claude&scope=user",
    );
    expect(res.status).toBe(200);
    // The python invocation must include "${RESOLVED_SKILL_ROOTS[@]}"
    // BEFORE the <<'PY' heredoc -- not piped in via printf.
    expect(res.body).toMatch(
      /python3 - "\$catalog_tmp"[^\n]*"\${RESOLVED_SKILL_ROOTS\[@\]}"\s+<<'PY'/,
    );
    // Hard guard: the broken pattern (printf | python3 ... <<'PY')
    // must NOT reappear for the bulk install. Match any printf that
    // pipes into a heredoc-launched python3 call.
    expect(res.body).not.toMatch(
      /printf [^|]*\|\s*python3 -[^\n]*<<'PY'\s*\nimport[^\n]*datetime[^\n]*tempfile/,
    );
    // The Python script must use *roots = sys.argv[1:] unpacking.
    expect(res.body).toContain(
      "src, manifest_path, agent, scope, force_s, upgrade_s, *roots = sys.argv[1:]",
    );
  });

  it("manifest_register_paths passes paths as positional args, not via stdin pipe", async () => {
    const res = await callGET(
      "https://app.example.com/api/skills/install.sh?agent=claude&scope=user",
    );
    expect(res.status).toBe(200);
    // The manifest helper must invoke python with paths in argv.
    expect(res.body).toMatch(
      /python3 - "\$MANIFEST_PATH" "\$AGENT_ID" "\$SCOPE" "\$name" "\$kind" "\$@"\s+<<'PY'/,
    );
    expect(res.body).toContain(
      "manifest_path, agent, scope, name, kind, *paths = sys.argv[1:]",
    );
  });
});

describe("GET /api/skills/install.sh — explicit modes", () => {
  it("explicit ?mode=bulk-with-helpers behaves identically to the default", async () => {
    const explicit = await callGET(
      "https://app.example.com/api/skills/install.sh?agent=claude&scope=user&mode=bulk-with-helpers",
    );
    expect(explicit.headers.get("Content-Disposition")).toContain(
      "install-skills-claude-user-bundle.sh",
    );
    expect(explicit.body).toMatch(/^DO_BULK=1$/m);
    expect(explicit.body).toMatch(/^DO_HELPERS=1$/m);
  });

  it("explicit ?mode=live-only opts back into the legacy single-skill flow", async () => {
    const res = await callGET(
      "https://app.example.com/api/skills/install.sh?agent=claude&scope=user&mode=live-only",
    );
    expect(res.headers.get("Content-Disposition")).toContain(
      "install-skills-claude-user.sh",
    );
    expect(res.headers.get("Content-Disposition")).not.toContain("-bundle");
    expect(res.body).toMatch(/^DO_LIVE_ONLY=1$/m);
    expect(res.body).toMatch(/^DO_BULK=0$/m);
    expect(res.body).toMatch(/^DO_HELPERS=0$/m);
    // SINGLE_SKILL_URL is the live-skills callback for the chosen
    // command_name; live-only mode writes the rendered template to
    // every universal target path.
    expect(res.body).toMatch(/SINGLE_SKILL_URL=.*\/api\/skills\/live-skills/);
  });
});

describe("GET /api/skills/install.sh — flagged-skill security gate", () => {
  it("bulk install Python loop checks all three flag signals", async () => {
    const res = await callGET(
      "https://app.example.com/api/skills/install.sh?agent=claude&scope=user",
    );
    expect(res.body).toContain("def is_flagged(skill):");
    expect(res.body).toContain('skill.get("scan_status") == "flagged"');
    expect(res.body).toContain('skill.get("runnable") is False');
    expect(res.body).toContain('skill.get("blocked_reason") == "scan_flagged"');
    // User-visible notice: the bash output must tell the user exactly
    // what was suppressed.
    expect(res.body).toContain("flagged by security scanner");
    // Summary line includes the flagged tally so wrote+skipped+
    // reserved+flagged sums to total -- no quietly-lost skills.
    expect(res.body).toMatch(/flagged \{flagged_count\}/);
  });

  it("reserves the helper command names so the bulk loop can't clobber them", async () => {
    const res = await callGET(
      "https://app.example.com/api/skills/install.sh?agent=claude&scope=user",
    );
    expect(res.body).toContain('RESERVED = {"skills", "update-skills"}');
  });
});
