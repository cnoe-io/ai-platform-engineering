/**
 * @jest-environment node
 *
 * Tests for the `mode=uninstall` flow of GET /api/skills/install.sh.
 *
 * The uninstall mode is deliberately self-contained -- it doesn't share
 * code with `bulk-with-helpers` or `live-only`, so it gets its own test
 * file rather than another describe block in the (already 770-line)
 * main test. We assert the contract callers depend on:
 *
 *   1. Mode dispatch: `?mode=uninstall` produces an uninstall script,
 *      not an install one.
 *   2. The script is well-formed bash and starts with the standard
 *      strict-mode preamble.
 *   3. The script never embeds the catalog API key (no curl calls --
 *      uninstall is fully local).
 *   4. The script reads the manifest from the documented per-scope
 *      paths and honors `CAIPE_INSTALL_MANIFEST`.
 *   5. The script preserves `~/.config/caipe/config.json` unless
 *      `--purge` is passed (matches the design questionnaire answer).
 *   6. The script supports `--dry-run`, `--all`, `-h/--help`.
 *   7. The script reverses the Claude `~/.claude/settings.json` patch
 *      surgically -- only entries pointing at our hook script and the
 *      two specific allowlist rules are removed.
 *   8. The script refuses to recurse into directories listed in the
 *      manifest (defensive invariant: install side never registers
 *      directories).
 *   9. The script refuses non-interactive runs without `--all` to
 *      avoid surprising users in CI.
 *  10. Filename suffix is `-uninstall` so the downloaded artifact is
 *      obvious.
 *  11. The `--upgrade` flag is NOT honored here -- uninstall has its
 *      own flag set, and a stray `--upgrade` from a copy-pasted
 *      install command should error rather than silently succeed.
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
    // The banner is the cleanest pin for "this is the uninstall flow".
    expect(res.body).toContain("CAIPE uninstaller");
    // Strict-mode preamble: same shape as every other generated script.
    expect(res.body).toContain("set -euo pipefail");
  });

  it("uninstall takes precedence over a stray ?catalog_url=", async () => {
    // A user copy-pasting the install one-liner and only changing
    // `mode=` to `uninstall` could leave the catalog_url query in.
    // Rather than 400 we just honor the uninstall (dropping the
    // bulk-install scaffold entirely), which is the user's intent.
    const res = await callRaw(
      "https://app.example.com/api/skills/install.sh"
        + "?agent=claude&scope=user&mode=uninstall"
        + "&catalog_url="
        // Same-origin catalog URL so the upstream sanitizer accepts it
        // and the mode-resolution code path is the one under test
        // (uninstall must beat catalog-query, NOT bypass validation).
        + encodeURIComponent("https://app.example.com/api/skills?page=1"),
    );
    expect(res.status).toBe(200);
    expect(res.body).toContain("CAIPE uninstaller");
    // Bulk-install plumbing must not leak in.
    expect(res.body).not.toContain("X-Caipe-Catalog-Key");
    expect(res.body).not.toContain("Catalog query:");
  });

  it("rejects unknown ?mode= values with 400 and lists 'uninstall' as allowed", async () => {
    const res = await callRaw(
      "https://app.example.com/api/skills/install.sh?agent=claude&scope=user&mode=bogus",
    );
    expect(res.status).toBe(400);
    // Error string mentions every allowed mode so a typo is self-curing.
    expect(res.body).toContain("uninstall");
    expect(res.body).toContain("bulk-with-helpers");
    expect(res.body).toContain("live-only");
  });

  it("filename suffix marks the artifact as the uninstall script", async () => {
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
    // No catalog key, ever -- uninstall is fully local.
    expect(res.body).not.toContain("X-Caipe-Catalog-Key");
    // No actual curl invocation. Comments mentioning curl (the install
    // side's `curl ... | bash` UX) are fine -- we just must not be
    // making any HTTP calls. Pin the invocation form, not the word.
    expect(res.body).not.toMatch(/curl\s+(-[a-zA-Z]+\s+)*['"]?http/);
    expect(res.body).not.toMatch(/\bcurl\s+-sS\b/);
  });

  it("reads the user-scope manifest at ~/.config/caipe/installed.json", async () => {
    const res = await callRaw(
      "https://app.example.com/api/skills/install.sh?agent=claude&scope=user&mode=uninstall",
    );
    expect(res.body).toContain("/.config/caipe/installed.json");
  });

  it("reads the project-scope manifest at ./.caipe/installed.json", async () => {
    const res = await callRaw(
      "https://app.example.com/api/skills/install.sh?agent=claude&scope=project&mode=uninstall",
    );
    expect(res.body).toContain("./.caipe/installed.json");
  });

  it("honors the CAIPE_INSTALL_MANIFEST override", async () => {
    // Tests + power users need this so the script can be exercised
    // against a sandboxed manifest without touching $HOME.
    const res = await callRaw(
      "https://app.example.com/api/skills/install.sh?agent=claude&scope=user&mode=uninstall",
    );
    expect(res.body).toContain('${CAIPE_INSTALL_MANIFEST:-$MANIFEST_PATH}');
  });

  it("supports --dry-run, --all, --purge, -h/--help and rejects unknown flags", async () => {
    const res = await callRaw(
      "https://app.example.com/api/skills/install.sh?agent=claude&scope=user&mode=uninstall",
    );
    // Each flag is parsed in the case statement, so the literal
    // appears in both the case + the usage. Use a regex to avoid
    // false positives from prose.
    expect(res.body).toMatch(/--dry-run\)\s*DRY_RUN=1/);
    expect(res.body).toMatch(/--all\)\s*ALL=1/);
    expect(res.body).toMatch(/--purge\)\s*PURGE=1/);
    expect(res.body).toMatch(/-h\|--help\)\s*usage/);
    expect(res.body).toContain('echo "error: unknown flag:');
  });

  it("preserves config.json by default (no --purge)", async () => {
    const res = await callRaw(
      "https://app.example.com/api/skills/install.sh?agent=claude&scope=user&mode=uninstall",
    );
    // The config-skip branch is the contract pin: kind == "config" and
    // PURGE == 0 means we KEEP the file.
    expect(res.body).toContain('if [ "$kind" = "config" ] && [ $PURGE -eq 0 ]; then');
    expect(res.body).toContain('keep (no --purge)');
    // Final summary nudges the user toward --purge if they wanted a
    // truly clean wipe.
    expect(res.body).toContain('re-run with --purge to remove the gateway URL + api_key');
  });

  it("removes the empty ~/.config/caipe directory only with --purge", async () => {
    const res = await callRaw(
      "https://app.example.com/api/skills/install.sh?agent=claude&scope=user&mode=uninstall",
    );
    // Pin the conjunction: PURGE && !DRY_RUN. If a future refactor
    // splits these the prompt-free `--dry-run` path could end up
    // deleting a directory.
    expect(res.body).toMatch(
      /if \[ \$PURGE -eq 1 \] && \[ \$DRY_RUN -eq 0 \]; then[\s\S]+?rmdir "\$CAIPE_CONFIG_DIR"/,
    );
  });

  it("refuses to remove directories listed in the manifest (defensive)", async () => {
    // The install side only ever registers files. If a manually-edited
    // manifest sneaks a directory in, we must NOT recurse-delete it.
    const res = await callRaw(
      "https://app.example.com/api/skills/install.sh?agent=claude&scope=user&mode=uninstall",
    );
    expect(res.body).toContain("refusing to remove directory");
    // Belt-and-suspenders: nowhere in the script do we issue `rm -rf`
    // against a manifest entry. (A `rm -rf` against the cleanup tmp
    // file is fine -- this assertion is scoped to the uninstall path.)
    expect(res.body).not.toMatch(/rm -rf "\$path"/);
  });

  it("refuses non-interactive runs without --all (avoids CI surprises)", async () => {
    const res = await callRaw(
      "https://app.example.com/api/skills/install.sh?agent=claude&scope=user&mode=uninstall",
    );
    expect(res.body).toContain('stdin is not a tty and --all was not passed');
    // Hint must mention both --dry-run and --all so the operator knows
    // the recovery path.
    expect(res.body).toContain("re-run with '--dry-run'");
    expect(res.body).toContain("'--all'");
  });

  it("walks manifest entries in a stable order (skill > catalog > helper > hook > config)", async () => {
    // Pin the kind-priority table so a partial run (user quits with
    // 'q') always leaves the install in a usable state -- removing
    // the python helper before the skills that depend on it would
    // strand them.
    const res = await callRaw(
      "https://app.example.com/api/skills/install.sh?agent=claude&scope=user&mode=uninstall",
    );
    expect(res.body).toContain('"skill":   0');
    expect(res.body).toContain('"catalog": 1');
    expect(res.body).toContain('"helper":  2');
    expect(res.body).toContain('"hook":    3');
    expect(res.body).toContain('"config":  4');
  });

  it("offers per-item prompts with y/N/a/q semantics", async () => {
    const res = await callRaw(
      "https://app.example.com/api/skills/install.sh?agent=claude&scope=user&mode=uninstall",
    );
    expect(res.body).toContain("[y/N/a/q]");
    // 'a' bumps ALL=1 so the rest of the loop is non-interactive.
    expect(res.body).toMatch(/a\|all\)\s*ALL=1/);
    // 'q' breaks out without removing remaining entries -- pin the
    // user-facing wording so a translation/refactor doesn't change
    // it accidentally.
    expect(res.body).toContain("aborted by user");
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
    // Predicate is "h.command in hook_paths" -- pin the literal so a
    // future refactor doesn't accidentally widen the match (e.g. to
    // "command starts with ~/.claude/hooks", which would clobber
    // unrelated Claude hooks the user added themselves).
    expect(res.body).toContain('h.get("command") in hook_paths');
  });

  it("surgically removes only the two CAIPE allowlist rules we added at install", async () => {
    const res = await callRaw(
      "https://app.example.com/api/skills/install.sh?agent=claude&scope=user&mode=uninstall",
    );
    // The bash heredoc passes ALLOWLIST_RULES as a JSON-encoded env
    // var so we can pin the exact rules without dealing with shell
    // escaping. Both rules must be present.
    expect(res.body).toContain('Bash(uv run ~/.config/caipe/caipe-skills.py*)');
    expect(res.body).toContain('Bash(python3 ~/.config/caipe/caipe-skills.py*)');
    // The rules are dropped via set difference, not regex, so an
    // unrelated rule in `permissions.allow` is preserved verbatim.
    expect(res.body).toContain('kept_rules = [r for r in allow if r not in allowlist_rules]');
  });

  it("removes an empty hooks/permissions object after pruning (no leftover scaffolding)", async () => {
    const res = await callRaw(
      "https://app.example.com/api/skills/install.sh?agent=claude&scope=user&mode=uninstall",
    );
    // `data.pop("hooks", None)` and `data.pop("permissions", None)`
    // when their inner containers are empty -- otherwise the user's
    // settings.json grows orphaned `{}` containers on every cycle.
    expect(res.body).toContain('data.pop("hooks", None)');
    expect(res.body).toContain('data.pop("permissions", None)');
  });

  it("rewrites settings.json atomically with 0o600 perms", async () => {
    const res = await callRaw(
      "https://app.example.com/api/skills/install.sh?agent=claude&scope=user&mode=uninstall",
    );
    // Same atomic-write pattern the install side uses. Pin both halves
    // (mkstemp + os.replace) so a refactor that breaks atomicity is
    // caught by tests, not by a user with a half-written file.
    expect(res.body).toContain('tempfile.mkstemp(prefix=".caipe-settings-"');
    expect(res.body).toMatch(/os\.replace\(tmp, settings_path\)/);
    expect(res.body).toContain('os.chmod(settings_path, 0o600)');
  });
});

describe("GET /api/skills/install.sh — mode=uninstall manifest finalization", () => {
  it("rewrites the manifest dropping entries whose target is gone", async () => {
    const res = await callRaw(
      "https://app.example.com/api/skills/install.sh?agent=claude&scope=user&mode=uninstall",
    );
    // The post-loop Python heredoc prunes entries by checking
    // os.path.exists -- a partial run leaves the manifest in a
    // self-consistent state (only files still on disk are tracked).
    expect(res.body).toContain('os.path.exists(e["path"])');
    expect(res.body).toMatch(/data\["installed"\] = remaining/);
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
    // The finalization Python is gated on DRY_RUN=0, so a dry-run
    // never modifies the manifest. Pin the gate.
    expect(res.body).toMatch(
      /if \[ \$DRY_RUN -eq 0 \]; then\s*\n\s*python3 - "\$MANIFEST_PATH"/,
    );
  });
});
