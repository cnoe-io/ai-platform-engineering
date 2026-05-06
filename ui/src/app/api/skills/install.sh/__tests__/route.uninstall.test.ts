/**
 * @jest-environment node
 *
 * Tests for the `mode=uninstall` flow of GET /api/skills/install.sh
 * after the skills-only overhaul.
 *
 * Two key changes from the legacy uninstall flow:
 *
 *   1. Manifest entries are now `paths: [<list>]` (was `path: <string>`).
 *      The TSV emitter walks both shapes for back-compat but always
 *      re-emits in the new shape on finalize.
 *   2. When `?scope=` is omitted, the script walks BOTH the user-scope
 *      manifest (`~/.config/caipe/installed.json`) AND the project-scope
 *      manifest (`./.caipe/installed.json`) in deterministic order with
 *      independent y/N/a/q prompt loops.
 *
 * The remaining contracts (per-item prompts, settings.json reversal,
 * config-preservation default, --dry-run/--all/--purge flags, atomic
 * writes, defensive directory refusal) carry over from the pre-overhaul
 * script.
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

const callRaw = async (url: string): Promise<MockRes> =>
  (await GET(new Request(url))) as unknown as MockRes;

describe("GET /api/skills/install.sh — mode=uninstall dispatch", () => {
  it("returns 200 + an uninstall script for ?mode=uninstall", async () => {
    const res = await callRaw(
      "https://app.example.com/api/skills/install.sh?agent=claude&scope=user&mode=uninstall",
    );
    expect(res.status).toBe(200);
    expect(res.body).toMatch(/^#!\/usr\/bin\/env bash/);
    expect(res.body).toContain("CAIPE uninstaller");
    expect(res.body).toContain("set -euo pipefail");
  });

  it("scope is OPTIONAL on uninstall — omitting it walks BOTH manifests", async () => {
    // Per the overhaul questionnaire: when ?scope= is missing, the
    // uninstaller visits user-scope first, then project-scope, with
    // independent prompt loops.
    const res = await callRaw(
      "https://app.example.com/api/skills/install.sh?mode=uninstall",
    );
    expect(res.status).toBe(200);
    // Both manifests are baked into the MANIFESTS array, in order:
    // user first (so `q` quitting the first loop still leaves the
    // second to run).
    //
    // CRITICAL: paths MUST be DOUBLE-quoted so bash actually expands
    // ${HOME:-.} at runtime. We previously single-quoted these,
    // which silently broke uninstall for user-scope (every run
    // checked a literal "${HOME:-.}/..." path that never exists on
    // any filesystem). The regex below pins that contract.
    expect(res.body).toMatch(
      /MANIFESTS=\(\s*"\$\{HOME:-\.\}\/\.config\/caipe\/installed\.json"\s*"\.\/\.caipe\/installed\.json"\s*\)/,
    );
    // Regression invariant: the rendered script MUST NOT contain a
    // single-quoted form of the HOME-relative manifest path. Single
    // quotes prevent parameter expansion and re-introduce the bug.
    expect(res.body).not.toContain(
      "'${HOME:-.}/.config/caipe/installed.json'",
    );
    // Filename suffix communicates the dual-manifest scope. The
    // route falls back to scope=user for the slug (the script itself
    // walks both manifests via the MANIFESTS array regardless of slug).
    expect(res.headers.get("Content-Disposition")).toMatch(
      /install-skills-claude-user-uninstall-all\.sh/,
    );
  });

  it("agent is OPTIONAL on uninstall — defaults to claude", async () => {
    const res = await callRaw(
      "https://app.example.com/api/skills/install.sh?mode=uninstall&scope=user",
    );
    expect(res.status).toBe(200);
    expect(res.body).toContain('AGENT="claude"');
  });

  it("uninstall takes precedence over a stray ?catalog_url=", async () => {
    const res = await callRaw(
      "https://app.example.com/api/skills/install.sh"
        + "?agent=claude&scope=user&mode=uninstall"
        + "&catalog_url="
        + encodeURIComponent("https://app.example.com/api/skills?page=1"),
    );
    expect(res.status).toBe(200);
    expect(res.body).toContain("CAIPE uninstaller");
    expect(res.body).not.toContain("X-Caipe-Catalog-Key");
  });

  it("rejects unknown ?mode= values with 400 and lists 'uninstall' as allowed", async () => {
    const res = await callRaw(
      "https://app.example.com/api/skills/install.sh?agent=claude&scope=user&mode=bogus",
    );
    expect(res.status).toBe(400);
    expect(res.body).toContain("uninstall");
    expect(res.body).toContain("bulk-with-helpers");
    expect(res.body).toContain("live-only");
  });

  it("filename suffix marks the artifact as the uninstall script (single scope)", async () => {
    const res = await callRaw(
      "https://app.example.com/api/skills/install.sh?agent=claude&scope=user&mode=uninstall",
    );
    expect(res.headers.get("Content-Disposition")).toMatch(
      /install-skills-claude-user-uninstall\.sh/,
    );
  });
});

describe("GET /api/skills/install.sh — mode=uninstall script content", () => {
  it("never embeds the catalog API key (uninstall is fully local, no curl)", async () => {
    const res = await callRaw(
      "https://app.example.com/api/skills/install.sh?agent=claude&scope=user&mode=uninstall",
    );
    expect(res.body).not.toContain("X-Caipe-Catalog-Key");
    // No actual curl invocation. Comments mentioning curl are fine.
    expect(res.body).not.toMatch(/curl\s+(-[a-zA-Z]+\s+)*['"]?http/);
    expect(res.body).not.toMatch(/\bcurl\s+-sS\b/);
  });

  it("user-scope reads the manifest at ~/.config/caipe/installed.json", async () => {
    const res = await callRaw(
      "https://app.example.com/api/skills/install.sh?agent=claude&scope=user&mode=uninstall",
    );
    expect(res.body).toContain("/.config/caipe/installed.json");
    expect(res.body).not.toContain("./.caipe/installed.json");
    // Pin the double-quoted array form so the ${HOME:-.} expansion
    // bug can't silently re-emerge for the single-scope case either.
    expect(res.body).toMatch(
      /MANIFESTS=\(\s*"\$\{HOME:-\.\}\/\.config\/caipe\/installed\.json"\s*\)/,
    );
    expect(res.body).not.toContain(
      "'${HOME:-.}/.config/caipe/installed.json'",
    );
  });

  it("project-scope reads the manifest at ./.caipe/installed.json", async () => {
    const res = await callRaw(
      "https://app.example.com/api/skills/install.sh?agent=claude&scope=project&mode=uninstall",
    );
    expect(res.body).toContain("./.caipe/installed.json");
    // Project paths don't contain expansions, but pin the form for
    // symmetry with the user-scope test above.
    expect(res.body).toMatch(
      /MANIFESTS=\(\s*"\.\/\.caipe\/installed\.json"\s*\)/,
    );
  });

  it("honors the CAIPE_INSTALL_MANIFEST override (overrides first manifest)", async () => {
    const res = await callRaw(
      "https://app.example.com/api/skills/install.sh?agent=claude&scope=user&mode=uninstall",
    );
    // Power users (and tests) need this to point the script at a
    // sandboxed manifest without touching $HOME.
    expect(res.body).toContain('CAIPE_INSTALL_MANIFEST');
    expect(res.body).toMatch(/MANIFESTS=\("\$CAIPE_INSTALL_MANIFEST"\)/);
  });

  it("supports --dry-run, --all, --purge, -h/--help and rejects unknown flags", async () => {
    const res = await callRaw(
      "https://app.example.com/api/skills/install.sh?agent=claude&scope=user&mode=uninstall",
    );
    // --dry-run implies --all (sets ALL_GLOBAL=1) so dry-run output
    // is clean (no interleaved prompts).
    expect(res.body).toMatch(/--dry-run\)\s*DRY_RUN=1\s*;\s*ALL_GLOBAL=1/);
    expect(res.body).toMatch(/--all\)\s*ALL_GLOBAL=1/);
    expect(res.body).toMatch(/--purge\)\s*PURGE=1/);
    expect(res.body).toMatch(/-h\|--help\)\s*usage/);
    expect(res.body).toContain('echo "error: unknown flag:');
  });

  it("preserves config.json by default (no --purge)", async () => {
    const res = await callRaw(
      "https://app.example.com/api/skills/install.sh?agent=claude&scope=user&mode=uninstall",
    );
    expect(res.body).toContain('if [ "$kind" = "config" ] && [ $PURGE -eq 0 ]; then');
    expect(res.body).toContain('keep (no --purge)');
    expect(res.body).toContain('re-run with --purge to remove the gateway URL + api_key');
  });

  it("removes the empty ~/.config/caipe directory only with --purge && !--dry-run", async () => {
    const res = await callRaw(
      "https://app.example.com/api/skills/install.sh?agent=claude&scope=user&mode=uninstall",
    );
    expect(res.body).toMatch(
      /if \[ \$PURGE -eq 1 \] && \[ \$DRY_RUN -eq 0 \]; then[\s\S]+?rmdir "\$CAIPE_CONFIG_DIR"/,
    );
  });

  it("refuses to remove directories listed in the manifest (defensive)", async () => {
    const res = await callRaw(
      "https://app.example.com/api/skills/install.sh?agent=claude&scope=user&mode=uninstall",
    );
    expect(res.body).toContain("refusing to remove directory");
    // Belt-and-suspenders: nowhere in the per-entry loop do we issue
    // `rm -rf "$path"`. (rmdir on the empty parent dir is fine — that's
    // a different code path explicitly tested below.)
    expect(res.body).not.toMatch(/rm -rf "\$path"/);
  });

  it("rmdir's the per-skill parent dir after removing the SKILL.md", async () => {
    // The universal-paths layout creates per-skill subdirs:
    //   ~/.claude/skills/<name>/SKILL.md
    //   ~/.agents/skills/<name>/SKILL.md
    // After removing each SKILL.md we should clean up the now-empty
    // <name> directory; rmdir's no-op-on-non-empty semantics handle
    // shared dirs safely.
    const res = await callRaw(
      "https://app.example.com/api/skills/install.sh?agent=claude&scope=user&mode=uninstall",
    );
    expect(res.body).toContain("parent_dirs_to_check+=(");
    expect(res.body).toMatch(/rmdir "\$d" 2>\/dev\/null \|\| true/);
    // De-duped via sort -u so we don't rmdir the same dir N times.
    expect(res.body).toContain("sort -u");
  });

  it("refuses non-interactive runs without --all (avoids CI surprises)", async () => {
    const res = await callRaw(
      "https://app.example.com/api/skills/install.sh?agent=claude&scope=user&mode=uninstall",
    );
    expect(res.body).toContain('stdin is not a tty and --all was not passed');
    expect(res.body).toContain('refusing to remove files non-interactively without --all');
  });

  it("walks manifest entries in a stable kind-priority order", async () => {
    // Pin the kind-priority table so a partial run always leaves the
    // install in a usable state -- removing the python helper before
    // the skills that depend on it would strand them.
    const res = await callRaw(
      "https://app.example.com/api/skills/install.sh?agent=claude&scope=user&mode=uninstall",
    );
    expect(res.body).toContain('"skill": 0');
    expect(res.body).toContain('"catalog": 1');
    expect(res.body).toContain('"helper": 2');
    expect(res.body).toContain('"hook": 3');
    expect(res.body).toContain('"config": 4');
  });

  it("offers per-item prompts with y/N/a/q semantics (per-manifest scope)", async () => {
    const res = await callRaw(
      "https://app.example.com/api/skills/install.sh?agent=claude&scope=user&mode=uninstall",
    );
    expect(res.body).toContain("[y/N/a/q]");
    // 'a' bumps ALL_LOCAL=1 — but ALL_LOCAL resets between manifests
    // (in dual-manifest mode) so an "all" answer in the user manifest
    // does NOT silently apply to project entries.
    expect(res.body).toMatch(/a\|all\)\s*ALL_LOCAL=1/);
    expect(res.body).toContain("aborted by user");
    // Documentation in the per-manifest banner makes the per-manifest
    // scope of "a"/"q" explicit.
    expect(res.body).toContain("a=yes-to-all-IN-THIS-MANIFEST");
    expect(res.body).toContain("q=quit-this-manifest");
  });
});

describe("GET /api/skills/install.sh — mode=uninstall reads new paths[] manifest shape", () => {
  it("TSV emitter walks paths[] AND the legacy single-path shape (back-compat)", async () => {
    const res = await callRaw(
      "https://app.example.com/api/skills/install.sh?agent=claude&scope=user&mode=uninstall",
    );
    // The reader prefers the new shape but falls back to the legacy
    // `path: <string>` so a partially-migrated manifest still works.
    expect(res.body).toContain('paths = e.get("paths")');
    expect(res.body).toContain("isinstance(paths, list)");
    expect(res.body).toContain('elif isinstance(e.get("path"), str) and e["path"]');
  });

  it("emits one TSV row per file (so prompts are per-file, not per-skill)", async () => {
    const res = await callRaw(
      "https://app.example.com/api/skills/install.sh?agent=claude&scope=user&mode=uninstall",
    );
    // A single manifest entry with 2 paths (universal-paths layout) must
    // produce 2 rows so the user can keep one mirror and drop the other.
    expect(res.body).toContain("for p in path_list:");
    expect(res.body).toContain('rows.append((KIND_ORDER.get(k, 99), k, name, p))');
  });
});

describe("GET /api/skills/install.sh — mode=uninstall reverses Claude settings.json", () => {
  it("only prunes when at least one hook entry was actually removed", async () => {
    const res = await callRaw(
      "https://app.example.com/api/skills/install.sh?agent=claude&scope=user&mode=uninstall",
    );
    expect(res.body).toContain('${#hook_paths_to_unregister[@]}');
    expect(res.body).toContain('hook_paths_to_unregister+=("$path")');
  });

  it("surgically removes only SessionStart entries pointing at our hook path", async () => {
    const res = await callRaw(
      "https://app.example.com/api/skills/install.sh?agent=claude&scope=user&mode=uninstall",
    );
    expect(res.body).toContain('h.get("command") in hook_paths');
  });

  it("surgically removes only the two CAIPE allowlist rules we added at install", async () => {
    const res = await callRaw(
      "https://app.example.com/api/skills/install.sh?agent=claude&scope=user&mode=uninstall",
    );
    // Both rules are passed via env-var (avoids shell escaping fights).
    expect(res.body).toContain('Bash(uv run ~/.config/caipe/caipe-skills.py*)');
    expect(res.body).toContain('Bash(python3 ~/.config/caipe/caipe-skills.py*)');
    // Set difference, not regex — so a user-added rule is preserved.
    expect(res.body).toContain('kept_rules = [r for r in allow if r not in allowlist_rules]');
  });

  it("removes an empty hooks/permissions object after pruning", async () => {
    const res = await callRaw(
      "https://app.example.com/api/skills/install.sh?agent=claude&scope=user&mode=uninstall",
    );
    expect(res.body).toContain('data.pop("hooks", None)');
    expect(res.body).toContain('data.pop("permissions", None)');
  });

  it("rewrites settings.json atomically with 0o600 perms", async () => {
    const res = await callRaw(
      "https://app.example.com/api/skills/install.sh?agent=claude&scope=user&mode=uninstall",
    );
    expect(res.body).toContain('tempfile.mkstemp(prefix=".caipe-settings-"');
    expect(res.body).toMatch(/os\.replace\(tmp, settings_path\)/);
    expect(res.body).toContain('os.chmod(settings_path, 0o600)');
  });
});

describe("GET /api/skills/install.sh — mode=uninstall manifest finalization", () => {
  it("rewrites the manifest in the new paths[] shape, dropping gone entries", async () => {
    const res = await callRaw(
      "https://app.example.com/api/skills/install.sh?agent=claude&scope=user&mode=uninstall",
    );
    // Per-path existence check: only paths still on disk survive.
    expect(res.body).toContain(
      'surviving = [p for p in paths if isinstance(p, str) and os.path.exists(p)]',
    );
    // The re-write is in the new `paths[]` shape (legacy `path` is dropped).
    expect(res.body).toContain('new_e["paths"] = surviving');
    expect(res.body).toContain('new_e.pop("path", None)');
    expect(res.body).toMatch(/data\["installed"\] = remaining/);
    // Bumps the manifest schema version so future readers can branch.
    expect(res.body).toContain('data["version"] = 2');
  });

  it("deletes the manifest file when no entries remain", async () => {
    const res = await callRaw(
      "https://app.example.com/api/skills/install.sh?agent=claude&scope=user&mode=uninstall",
    );
    expect(res.body).toContain('removed empty manifest');
    expect(res.body).toMatch(/os\.unlink\(mp\)/);
  });

  it("skips manifest finalization in --dry-run (no side effects)", async () => {
    const res = await callRaw(
      "https://app.example.com/api/skills/install.sh?agent=claude&scope=user&mode=uninstall",
    );
    expect(res.body).toMatch(
      /if \[ \$DRY_RUN -eq 0 \]; then\s*\n\s*python3 - "\$MANIFEST_PATH"/,
    );
  });
});

describe("GET /api/skills/install.sh — mode=uninstall dual-manifest walk", () => {
  it("walks each manifest in its own loop (independent ALL_LOCAL state)", async () => {
    // Dual-manifest mode is the new default when ?scope= is omitted.
    // Each manifest gets its own y/N/a/q loop; an "a" answered in the
    // user-manifest loop must NOT silently apply to project entries.
    const res = await callRaw(
      "https://app.example.com/api/skills/install.sh?mode=uninstall",
    );
    expect(res.body).toContain('for MANIFEST_PATH in "${MANIFESTS[@]}"; do');
    // ALL_LOCAL is reset to ALL_GLOBAL at the top of each manifest's
    // loop so an "a" in manifest #1 doesn't auto-apply to manifest #2.
    expect(res.body).toContain("ALL_LOCAL=$ALL_GLOBAL");
    // Final summary aggregates removed/skipped across all manifests.
    expect(res.body).toContain("TOTAL_REMOVED=$((TOTAL_REMOVED + removed_count))");
    expect(res.body).toContain("TOTAL_SKIPPED=$((TOTAL_SKIPPED + skipped_count))");
  });

  it("each manifest visit is no-op when its file is missing", async () => {
    const res = await callRaw(
      "https://app.example.com/api/skills/install.sh?mode=uninstall",
    );
    // A user with only one scope installed should see "nothing to do"
    // for the missing manifest, not an error.
    expect(res.body).toContain("nothing to do: no manifest at $MANIFEST_PATH");
  });
});
