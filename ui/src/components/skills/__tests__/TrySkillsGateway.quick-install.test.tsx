/**
 * Quick install modal tests for `TrySkillsGateway`.
 *
 * The component is large and integrates many flows; this file deliberately
 * scopes assertions to the *Quick install* dialog (Step 1 → "Quick install"
 * button) which was redesigned in commit 91f2ad68. The intent is regression
 * coverage for the things a future refactor is most likely to break:
 *
 *   1. Summary chips render with the live skill count + selected agent +
 *      install path (the "what is about to happen?" preview).
 *   2. The API-key gate renders amber when no key is present and exposes
 *      a Generate button that POSTs to `/api/catalog-api-keys`.
 *   3. After minting, the gate flips to green and the raw key is shown in a
 *      copyable block with the one-time-visibility warning. Per PR #1268
 *      review feedback (Jeff Napper #6): the install snippet itself never
 *      embeds the minted key — install.sh reads the key out of
 *      `~/.config/caipe/config.json` (Step 1).
 *   4. The Copy button writes the single-line `curl … | bash` snippet
 *      verbatim (no `export CAIPE_CATALOG_KEY=…` prefix, no key inline).
 *   5. The footer action closes the dialog.
 *
 * We mock `fetch` per-URL so the component receives realistic shapes from
 * `/api/skills/live-skills`, `/api/skills`, `/api/catalog-api-keys`, etc.
 * `next/navigation` and `next/link` are stubbed because they are imported
 * transitively and would otherwise throw outside an `<App>` router.
 */

import React from "react";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

// ----------------------------------------------------------------------------
// Mocks for Next.js + UI primitives that do not behave under jsdom.
// ----------------------------------------------------------------------------

jest.mock("next/link", () => {
  // Render a plain anchor so we can assert href and click without a router.
  const Link = ({
    children,
    href,
    ...rest
  }: {
    children: React.ReactNode;
    href: string;
  }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  );
  Link.displayName = "MockNextLink";
  return { __esModule: true, default: Link };
});

jest.mock("next/navigation", () => ({
  useRouter: () => ({
    push: jest.fn(),
    replace: jest.fn(),
    back: jest.fn(),
    refresh: jest.fn(),
  }),
  usePathname: () => "/skills/gateway",
  useSearchParams: () => new URLSearchParams(),
}));

// ----------------------------------------------------------------------------
// Per-URL fetch mock. Returns minimally-realistic payloads for every URL the
// component touches on mount + Quick install open. Anything unexpected logs
// the URL so test failures are easy to debug.
// ----------------------------------------------------------------------------

interface FetchEntry {
  ok: boolean;
  status?: number;
  body?: unknown;
}

function jsonResponse({ ok, status = 200, body = {} }: FetchEntry) {
  return Promise.resolve({
    ok,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as Response);
}

const LIVE_SKILLS_BODY = {
  agent: "claude",
  label: "Claude Code",
  template: "# Live-skills\nDo a thing.",
  install_path: "./.claude/commands/skills.md",
  install_paths: {
    user: "~/.claude/commands/skills.md",
    project: "./.claude/commands/skills.md",
  },
  scope: "project",
  scope_requested: "project",
  scope_fallback: false,
  scopes_available: ["user", "project"],
  file_extension: "md",
  format: "markdown-frontmatter",
  is_fragment: false,
  launch_guide:
    "## Launch the skill\n\nRun `/skills` inside Claude Code.\n",
  agents: [
    {
      id: "claude",
      label: "Claude Code",
      ext: "md",
      format: "markdown-frontmatter",
      install_paths: {
        user: "~/.claude/commands/skills.md",
        project: "./.claude/commands/skills.md",
      },
      scopes_available: ["user", "project"],
      is_fragment: false,
    },
    {
      id: "cursor",
      label: "Cursor",
      ext: "md",
      format: "markdown-plain",
      install_paths: {
        project: "./.cursor/commands/skills.md",
      },
      scopes_available: ["project"],
      is_fragment: false,
    },
  ],
  source: "chart-default",
};

const SKILLS_LIST_BODY = {
  skills: [
    {
      name: "github-create-pr",
      metadata: {
        tags: ["github", "pr"],
        hub_location: "example/repo",
        hub_type: "github",
      },
    },
    {
      name: "argocd-list-apps",
      metadata: { tags: ["argocd"], hub_location: "example/repo", hub_type: "github" },
    },
  ],
  meta: { total: 10 },
};

// Low-entropy, obviously-fake fixture. Avoids tripping gitleaks'
// generic-api-key rule (which fires on entropy >~3.5) while still
// being a plausible string for the assertions below.
const FAKE_MINT_KEY = "FAKE-TEST-KEY-DO-NOT-USE";
let mintedKeyValue = FAKE_MINT_KEY;
let mintCallCount = 0;
const mintPostMock = jest.fn();

beforeEach(() => {
  mintCallCount = 0;
  mintPostMock.mockReset();
  mintedKeyValue = FAKE_MINT_KEY;

  global.fetch = jest.fn((input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input.toString();

    // Catalog API keys: GET (list) + POST (mint).
    if (url.startsWith("/api/catalog-api-keys")) {
      if (init?.method === "POST") {
        mintCallCount += 1;
        mintPostMock(url, init);
        return jsonResponse({
          ok: true,
          body: { key: mintedKeyValue, key_id: "kid-1" },
        });
      }
      return jsonResponse({ ok: true, body: { keys: [] } });
    }

    // Skills list (used for autocomplete + preview).
    if (url.startsWith("/api/skills") && !url.includes('/live-skills')) {
      return jsonResponse({ ok: true, body: SKILLS_LIST_BODY });
    }

    // Live-skills (per-agent rendered template).
    if (url.startsWith("/api/skills/live-skills")) {
      return jsonResponse({ ok: true, body: LIVE_SKILLS_BODY });
    }

    // Anything else: log + return empty 200 so we don't crash.
    // eslint-disable-next-line no-console
    console.warn("[test] unmocked fetch:", url);
    return jsonResponse({ ok: true, body: {} });
  }) as unknown as typeof fetch;

  // Stub clipboard.writeText so we can assert what was copied. JSDOM
  // exposes `navigator.clipboard` as a getter-only property, so a plain
  // `Object.assign(navigator, ...)` throws. `defineProperty` with
  // `configurable: true` lets us replace it for the duration of the test.
  // Hold on to the mock instance so each test can assert against it
  // without round-tripping through `navigator.clipboard.writeText` (the
  // round-trip loses the jest.Mock typing under JSDOM's getter).
  clipboardWriteTextMock = jest.fn().mockResolvedValue(undefined);
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: { writeText: clipboardWriteTextMock },
  });
});

// Shared handle to the most recent clipboard mock so individual tests can
// `mockClear` / inspect calls without re-resolving the property.
let clipboardWriteTextMock: jest.Mock;

afterEach(() => {
  jest.restoreAllMocks();
});

// ----------------------------------------------------------------------------
// Helpers
// ----------------------------------------------------------------------------

async function renderAndOpenModal({
  pickScope = true,
}: { pickScope?: boolean } = {}) {
  // Lazy-import so module-level mocks above are applied first.
  const { TrySkillsGateway } = await import("../TrySkillsGateway");
  const user = userEvent.setup();
  render(<TrySkillsGateway />);

  // Wait for the live-skills fetch to resolve so the modal has agents +
  // install_paths populated. Without this the dialog opens with
  // "Pick an install scope" because `liveSkills` is still null.
  await waitFor(() =>
    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining("/api/skills/live-skills"),
      expect.anything(),
    ),
  );
  // After PR #1268 review feedback (Shubham Bakshi), "Quick install" is
  // now both the primary CTA in Step 3 ("Install the live-skills skill") AND
  // the inline button under the Query Builder's Preview button. Either one
  // opens the same dialog, so we just pick the first match.
  await waitFor(() => {
    const buttons = screen.getAllByRole("button", { name: /quick install/i });
    expect(buttons.length).toBeGreaterThan(0);
    expect(buttons[0]).toBeEnabled();
  });

  await user.click(
    screen.getAllByRole("button", { name: /quick install/i })[0],
  );
  await screen.findByRole("heading", { name: /quick install/i });

  // The component starts with `selectedScope = null`, so the snippet area
  // shows "Pick an install scope above..." until the user clicks one of
  // the radio buttons inside the dialog. Most of our assertions need the
  // populated state, so default to picking project-local.
  if (pickScope) {
    const dialog = screen.getByRole("dialog");
    const projectRadio = within(dialog).getByRole("radio", {
      name: /project-local/i,
    });
    await user.click(projectRadio);
    // Wait for the chip row to render (proxy for "selectedScope is set").
    await waitFor(() =>
      expect(
        within(dialog).queryByText(
          /pick an install scope above to generate/i,
        ),
      ).toBeNull(),
    );
  }
  return user;
}

function getDialog() {
  // shadcn/ui Dialog renders with role="dialog".
  return screen.getByRole("dialog");
}

// ----------------------------------------------------------------------------
// Tests
// ----------------------------------------------------------------------------

describe("TrySkillsGateway → Quick install modal", () => {
  it("renders the dialog with summary chips for agent + install path", async () => {
    await renderAndOpenModal();
    const dialog = getDialog();

    // Agent chip: default selected agent is "claude" → label "Claude Code".
    // The chip appears alongside the live-skills target path. We use
    // `getAllByText` because the agent label also appears in the picker
    // <select>.
    expect(within(dialog).getAllByText(/Claude Code/).length).toBeGreaterThan(0);

    // Default scope after the live-skills fetch returns is "project" (from the mocked
    // LIVE_SKILLS_BODY.scope), so the project path should be in the chip
    // row. The same path also appears in the scope picker label, so we
    // assert at-least-one match instead of unique.
    expect(
      within(dialog).getAllByText("./.claude/commands/skills.md").length,
    ).toBeGreaterThan(0);

    // The "skills from catalog" fallback chip appears until a Preview is run
    // — previewData is null here so we expect that label, not "N skills".
    expect(within(dialog).getByText(/skills from catalog/i)).toBeInTheDocument();
  });

  it("shows the amber API-key gate with a Generate button when no key is present", async () => {
    await renderAndOpenModal();
    const dialog = getDialog();

    expect(within(dialog).getByText(/No API key/i)).toBeInTheDocument();
    expect(
      within(dialog).getByRole("button", { name: /generate api key/i }),
    ).toBeEnabled();

    // Per PR #1268 review feedback (Jeff Napper #6): the snippet no longer
    // embeds the API key in any state — it's always a clean
    // `curl … | bash`, and install.sh reads the key from
    // ~/.config/caipe/config.json (Step 1). So we should NOT see the
    // `<your-catalog-api-key>` placeholder leak into the modal snippet
    // either.
    expect(
      within(dialog).queryByText(/<your-catalog-api-key>/),
    ).toBeNull();
  });

  it("POSTs to /api/catalog-api-keys and flips the gate green after Generate", async () => {
    const user = await renderAndOpenModal();
    const dialog = getDialog();

    await user.click(
      within(dialog).getByRole("button", { name: /generate api key/i }),
    );

    await waitFor(() => expect(mintCallCount).toBeGreaterThanOrEqual(1));
    expect(mintPostMock).toHaveBeenCalledWith(
      "/api/catalog-api-keys",
      expect.objectContaining({ method: "POST", credentials: "include" }),
    );

    // Green "API key minted" row appears, amber row disappears.
    await within(dialog).findByText(/API key minted/i);
    expect(within(dialog).queryByText(/API key required/i)).toBeNull();

    // The raw key is rendered in its own copyable block with a one-time
    // visibility warning — this is the only place the key is shown after
    // mint, per Jeff Napper's review feedback.
    expect(within(dialog).getByText(mintedKeyValue)).toBeInTheDocument();
    expect(
      within(dialog).getByText(/cannot show it again/i),
    ).toBeInTheDocument();

    // The key is shown in two places after mint:
    //   * Option A — the bare key in its own CopyableBlock.
    //   * Option B — embedded inside the bootstrap heredoc snippet
    //     (so the `cat > config.json <<'EOF' … EOF` writes the right
    //     value).
    // Use getAllByText so this assertion is stable regardless of how
    // many copies render — what we actually care about is "the key
    // shows up somewhere" plus the *negative* assertion below that the
    // bare-curl one-liner doesn't bake it in.
    expect(
      within(dialog).getAllByText(new RegExp(mintedKeyValue)).length,
    ).toBeGreaterThanOrEqual(1);
    // But never as `export CAIPE_CATALOG_KEY=…` — install.sh reads the
    // key from ~/.config/caipe/config.json, not the env. (See the
    // separate clipboard test below for the bare-curl one-liner.)
    expect(within(dialog).queryByText(/export CAIPE_CATALOG_KEY/)).toBeNull();
  });

  it("Copy writes the single-line `curl … | bash` snippet to clipboard", async () => {
    const user = await renderAndOpenModal();
    const dialog = getDialog();

    // Minting changes the API-key gate but should NOT affect the snippet,
    // which is always a clean one-liner (install.sh reads the key from
    // ~/.config/caipe/config.json). Mint anyway so we can verify the key
    // is *not* leaking into the copy payload.
    await user.click(
      within(dialog).getByRole("button", { name: /generate api key/i }),
    );
    await within(dialog).findByText(/API key minted/i);

    // After mint, three clipboard-writers exist in the dialog:
    //   1) Option A — the bare API key (CopyableBlock, icon-only,
    //      aria-label="Copy API key").
    //   2) Option B — the bootstrap snippet (CopyableBlock with
    //      visible text "Copy", inside the
    //      `quick-install-bootstrap-snippet` panel).
    //   3) The "Run this in your terminal" inline button (visible text
    //      "Copy", `data-testid="quick-install-copy-bare-curl"`),
    //      which is the one this test cares about — the clean
    //      single-line `curl … | bash` that exists regardless of mint
    //      state.
    // Target #3 by testid so this test stays orthogonal to Options A/B.
    clipboardWriteTextMock.mockClear();
    // `userEvent.setup()` installs its own clipboard polyfill that
    // shadows our `Object.defineProperty` mock, so we spy on the live
    // `writeText` *just before* the click and inspect that.
    const liveWriteText = jest.spyOn(navigator.clipboard, "writeText");
    await user.click(
      within(dialog).getByTestId("quick-install-copy-bare-curl"),
    );

    await waitFor(() => {
      expect(liveWriteText).toHaveBeenCalled();
    });
    // The bare-curl button writes exactly one payload — the one-liner.
    const snippetCall = liveWriteText.mock.calls.find(
      ([arg]) =>
        typeof arg === "string" && /^curl -fsSL/.test(arg),
    );
    expect(snippetCall).toBeDefined();
    const copied = snippetCall![0] as string;

    // Per PR #1268 review feedback (Jeff Napper #6): the snippet is a clean
    // single-line `curl … | bash`. No `export CAIPE_CATALOG_KEY=`, no key
    // baked in — install.sh resolves the key from
    // ~/.config/caipe/config.json (Step 1).
    expect(copied).toMatch(/^curl -fsSL/);
    expect(copied).not.toContain("export CAIPE_CATALOG_KEY");
    expect(copied).not.toContain(FAKE_MINT_KEY);
    expect(copied).toContain("/api/skills/install.sh?");
    // ?agent= is omitted now -- the install is universal across
    // Claude / Cursor / Codex / Gemini / opencode and the route
    // defaults to claude. The UI no longer surfaces an agent picker
    // in the Quick install modal.
    expect(copied).not.toContain("agent=");
    // Scope must still be in the URL (drives ~/.claude vs ./.claude).
    expect(copied).toMatch(/scope=(user|project)/);
    expect(copied).toMatch(/\| bash$/);
    expect(copied).not.toContain("<your-catalog-api-key>");

    // Button label flips to "Copied" briefly.
    await within(dialog).findByRole("button", { name: /copied/i });
  });

  it("snippet is a clean curl one-liner regardless of mint state", async () => {
    // Per PR #1268 review feedback (Jeff Napper #6): the snippet must NEVER
    // embed the API key — not as `<your-catalog-api-key>`, not as the
    // freshly minted value. install.sh resolves the key from
    // ~/.config/caipe/config.json (Step 1).
    await renderAndOpenModal();
    const dialog = getDialog();

    expect(
      within(dialog).queryByText(/<your-catalog-api-key>/),
    ).toBeNull();
    expect(within(dialog).queryByText(/export CAIPE_CATALOG_KEY/)).toBeNull();
    // The `--upgrade` hint (idempotency advice) still belongs in the modal.
    expect(within(dialog).getAllByText(/--upgrade/).length).toBeGreaterThan(0);
  });

  it("footer action closes the dialog", async () => {
    const user = await renderAndOpenModal();
    const dialog = getDialog();

    await user.click(
      within(dialog).getByRole("button", { name: /close and jump to step 3/i }),
    );

    await waitFor(() => {
      expect(screen.queryByRole("dialog")).toBeNull();
    });
  });

  it("shows skill count chip after a Preview populates `previewData`", async () => {
    const user = await renderAndOpenModal();

    // Close the modal so we can hit the Preview button in the underlying
    // page (the modal sits above it and the Preview lives in Step 1).
    await user.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());

    // Trigger Preview: this hits /api/skills which is mocked above to
    // return meta.total = 10. After it resolves, opening the modal should
    // surface the "10 skills" chip in place of the "skills from catalog"
    // fallback.
    await user.click(screen.getByRole("button", { name: /^preview$/i }));
    await waitFor(() =>
      expect(screen.getByText(/10 skill(s)? found/i)).toBeInTheDocument(),
    );

    await user.click(
      screen.getAllByRole("button", { name: /quick install/i })[0],
    );
    const dialog = await screen.findByRole("dialog");

    expect(within(dialog).getByText(/^10 skills$/i)).toBeInTheDocument();
    expect(within(dialog).queryByText(/skills from catalog/i)).toBeNull();
  });

  // ---------------------------------------------------------------------
  // Overwrite-policy checkboxes (--upgrade / --force).
  //
  // The modal exposes two checkboxes that flip the rendered one-liner
  // between three modes:
  //
  //   * neither        → `curl … | bash`              (safe default)
  //   * --upgrade only → `curl … | bash -s -- --upgrade`
  //   * --force only   → `curl … | bash -s -- --force`
  //
  // The two checkboxes are mutually exclusive (install.sh treats
  // upgrade+force as force-wins, and exposing both as independent
  // toggles would let the UI ask for an illegal combination). These
  // tests pin (a) the default state, (b) each mode's effect on the
  // snippet, and (c) the mutual-exclusion rule.
  // ---------------------------------------------------------------------

  it("overwrite-policy: defaults to no flag and renders a clean curl | bash", async () => {
    await renderAndOpenModal();
    const dialog = getDialog();

    const upgrade = within(dialog).getByTestId(
      "quick-install-upgrade",
    ) as HTMLInputElement;
    const force = within(dialog).getByTestId(
      "quick-install-force",
    ) as HTMLInputElement;
    expect(upgrade.checked).toBe(false);
    expect(force.checked).toBe(false);

    // The snippet block is the only `<pre>` in the dialog.
    const snippet = dialog.querySelector("pre");
    expect(snippet).not.toBeNull();
    expect(snippet!.textContent || "").toMatch(/\| bash$/);
    expect(snippet!.textContent || "").not.toContain("bash -s --");
  });

  it("overwrite-policy: ticking --upgrade rewrites snippet to use bash -s -- --upgrade", async () => {
    const user = await renderAndOpenModal();
    const dialog = getDialog();

    await user.click(within(dialog).getByTestId("quick-install-upgrade"));

    const snippet = dialog.querySelector("pre");
    expect(snippet!.textContent || "").toMatch(
      /\| bash -s -- --upgrade$/,
    );
  });

  it("overwrite-policy: ticking --force rewrites snippet to use bash -s -- --force", async () => {
    const user = await renderAndOpenModal();
    const dialog = getDialog();

    await user.click(within(dialog).getByTestId("quick-install-force"));

    const snippet = dialog.querySelector("pre");
    expect(snippet!.textContent || "").toMatch(/\| bash -s -- --force$/);
  });

  // ---------------------------------------------------------------------
  // Helpers checkbox (default ON).
  //
  // The Quick Install URL must include &mode=bulk-with-helpers when the
  // checkbox is on so the server installs /skills + /update-skills
  // helper SKILL.md files. Without this the route silently downgrades
  // to catalog-query mode (DO_HELPERS=0) because ?catalog_url= takes
  // precedence over a missing mode.
  // ---------------------------------------------------------------------

  it("helpers checkbox: defaults to ON and snippet contains &mode=bulk-with-helpers", async () => {
    await renderAndOpenModal();
    const dialog = getDialog();

    const helpers = within(dialog).getByTestId(
      "quick-install-helpers",
    ) as HTMLInputElement;
    expect(helpers.checked).toBe(true);

    const snippet = dialog.querySelector("pre");
    expect(snippet!.textContent || "").toContain("mode=bulk-with-helpers");
  });

  it("helpers checkbox: unticking removes &mode=bulk-with-helpers from the snippet", async () => {
    const user = await renderAndOpenModal();
    const dialog = getDialog();

    await user.click(within(dialog).getByTestId("quick-install-helpers"));

    const snippet = dialog.querySelector("pre");
    expect(snippet!.textContent || "").not.toContain("mode=bulk-with-helpers");
    // The rest of the URL (scope, catalog_url) must still be there —
    // we're only stripping the mode override, not breaking the URL.
    expect(snippet!.textContent || "").toMatch(/scope=(user|project)/);
    expect(snippet!.textContent || "").toContain("catalog_url=");
  });

  it("helpers checkbox: stacks with --force (both flags coexist on the same one-liner)", async () => {
    const user = await renderAndOpenModal();
    const dialog = getDialog();

    // Default state already has helpers=on; layer --force on top.
    await user.click(within(dialog).getByTestId("quick-install-force"));

    const snippet = dialog.querySelector("pre");
    const text = snippet!.textContent || "";
    expect(text).toContain("mode=bulk-with-helpers");
    expect(text).toMatch(/\| bash -s -- --force$/);
  });

  // ---------------------------------------------------------------------
  // Option-4 bootstrap snippet (writes ~/.config/caipe/config.json with
  // the minted key, then runs the install one-liner).
  //
  // Background: install.sh resolves the catalog API key from
  // ~/.config/caipe/config.json on disk (Step 1 of the gateway flow).
  // After a `--purge` uninstall the file is removed; on re-install the
  // user has to recreate it before the curl works. Asking them to do
  // that by hand is the most common stumble in the install flow, so
  // when a key is freshly minted in this session the modal also shows
  // a single-shot bootstrap that:
  //   1) `mkdir -p ~/.config/caipe` so the dir exists.
  //   2) `cat > ~/.config/caipe/config.json <<'CAIPE_BOOTSTRAP_EOF'`
  //      using a *single-quoted* heredoc delimiter so bash doesn't try
  //      to expand $-sequences or backticks inside the embedded key.
  //   3) `chmod 600` the file (owner-readable only — the key is a
  //      bearer credential).
  //   4) Pipes into the same `curl … | bash` the bare snippet shows.
  //
  // These tests pin the *shape* of that snippet so a future refactor
  // can't silently regress security (chmod 600), correctness (quoted
  // heredoc), or completeness (must end with the install one-liner).
  // ---------------------------------------------------------------------

  it("bootstrap snippet: does NOT render until a key is minted", async () => {
    await renderAndOpenModal();
    const dialog = getDialog();

    expect(
      within(dialog).queryByTestId("quick-install-bootstrap-snippet"),
    ).toBeNull();
  });

  it("bootstrap snippet: renders with quoted heredoc, chmod 600, and the embedded key after mint", async () => {
    const user = await renderAndOpenModal();
    const dialog = getDialog();

    await user.click(
      within(dialog).getByRole("button", { name: /generate api key/i }),
    );
    await within(dialog).findByText(/API key minted/i);

    const panel = within(dialog).getByTestId(
      "quick-install-bootstrap-snippet",
    );
    const pre = panel.querySelector("pre");
    expect(pre).not.toBeNull();
    const text = pre!.textContent || "";

    // Step 1 — the dir is created before we try to `cat >` into it.
    // First-time installers don't have ~/.config/caipe yet.
    expect(text).toMatch(/^mkdir -p ~\/\.config\/caipe && \\$/m);

    // Step 2 — quoted heredoc delimiter. This is the load-bearing
    // bit: a bare `<<EOF` (or `<<"EOF"`) would let bash expand
    // `$(...)`, `` `...` ``, and `${...}` inside the embedded key,
    // which can corrupt the key or, worse, execute attacker-chosen
    // code if a future key format ever contains `$(...)`. We
    // single-quote the delimiter to disable all expansion.
    expect(text).toContain("<<'CAIPE_BOOTSTRAP_EOF'");
    // And the closing delimiter must match (no quotes on the closing
    // line, per heredoc syntax).
    expect(text).toMatch(/^CAIPE_BOOTSTRAP_EOF$/m);
    expect(text).not.toContain("<<EOF");
    expect(text).not.toContain('<<"CAIPE_BOOTSTRAP_EOF"');

    // The minted key is embedded inside a JSON string literal — both
    // the key and the base_url are JSON.stringify'd on the React side
    // so any future key character (including `"` and `\`) is safe.
    expect(text).toContain(`"api_key": "${FAKE_MINT_KEY}"`);
    expect(text).toMatch(/"base_url":\s*"[^"]+"/);

    // Step 3 — chmod 600 must come immediately after the heredoc and
    // *before* the install runs. The `&& \` chain means a failed
    // chmod aborts the install.
    expect(text).toContain("chmod 600 ~/.config/caipe/config.json && \\");

    // Step 4 — the snippet ends with the same install one-liner the
    // bare-curl block shows. This guarantees that toggling Options
    // A/B doesn't accidentally diverge the install URL between them.
    expect(text).toMatch(/\ncurl -fsSL '[^']+' \| bash$/);
    expect(text).toContain("/api/skills/install.sh?");
  });

  it("bootstrap snippet: install one-liner inside it tracks the --force toggle", async () => {
    const user = await renderAndOpenModal();
    const dialog = getDialog();

    await user.click(
      within(dialog).getByRole("button", { name: /generate api key/i }),
    );
    await within(dialog).findByText(/API key minted/i);

    // Tick --force in the overwrite-policy panel — the bootstrap
    // snippet's install line must pick up the same flag, otherwise
    // the two snippets would silently diverge on overwrite policy.
    await user.click(within(dialog).getByTestId("quick-install-force"));

    const panel = within(dialog).getByTestId(
      "quick-install-bootstrap-snippet",
    );
    const text = panel.querySelector("pre")!.textContent || "";
    expect(text).toMatch(/\| bash -s -- --force$/);
  });

  it("overwrite-policy: --upgrade and --force are mutually exclusive", async () => {
    const user = await renderAndOpenModal();
    const dialog = getDialog();

    const upgrade = within(dialog).getByTestId(
      "quick-install-upgrade",
    ) as HTMLInputElement;
    const force = within(dialog).getByTestId(
      "quick-install-force",
    ) as HTMLInputElement;

    await user.click(upgrade);
    expect(upgrade.checked).toBe(true);
    expect(force.checked).toBe(false);

    // Picking force flips upgrade off — install.sh treats them as
    // a precedence chain, so two independent toggles would let the
    // UI claim a state the script silently ignores.
    await user.click(force);
    expect(force.checked).toBe(true);
    expect(upgrade.checked).toBe(false);

    // Unticking the active one returns to the safe default (clean
    // `| bash` with no flag).
    await user.click(force);
    expect(upgrade.checked).toBe(false);
    expect(force.checked).toBe(false);
    const snippet = dialog.querySelector("pre");
    expect(snippet!.textContent || "").not.toContain("bash -s --");
  });
});
