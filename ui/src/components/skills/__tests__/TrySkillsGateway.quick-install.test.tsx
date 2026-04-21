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
 *   3. After minting, the gate flips to green, the raw key is shown in a
 *      copyable block (one-time visibility warning), and the curl snippet
 *      auto-fills `CAIPE_CATALOG_KEY` with the real value.
 *   4. The Copy button writes the verbatim two-line `export ... ; curl ...`
 *      to the clipboard (no URL-encoded soup).
 *   5. The footer action closes the dialog.
 *
 * We mock `fetch` per-URL so the component receives realistic shapes from
 * `/api/skills/bootstrap`, `/api/skills`, `/api/catalog-api-keys`, etc.
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

const BOOTSTRAP_BODY = {
  agent: "claude",
  label: "Claude Code",
  template: "# Skills bootstrap\nDo a thing.",
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

let mintedKeyValue = "test-mint-key-abcdef123";
let mintCallCount = 0;
const mintPostMock = jest.fn();

beforeEach(() => {
  mintCallCount = 0;
  mintPostMock.mockReset();
  mintedKeyValue = "test-mint-key-abcdef123";

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
    if (url.startsWith("/api/skills") && !url.includes("/bootstrap")) {
      return jsonResponse({ ok: true, body: SKILLS_LIST_BODY });
    }

    // Bootstrap (per-agent rendered template).
    if (url.startsWith("/api/skills/bootstrap")) {
      return jsonResponse({ ok: true, body: BOOTSTRAP_BODY });
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

  // Wait for the bootstrap fetch to resolve so the modal has agents +
  // install_paths populated. Without this the dialog opens with
  // "Pick an install scope" because `bootstrap` is still null.
  await waitFor(() =>
    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining("/api/skills/bootstrap"),
      expect.anything(),
    ),
  );
  await waitFor(() => {
    expect(screen.getByRole("button", { name: /quick install/i })).toBeEnabled();
  });

  await user.click(screen.getByRole("button", { name: /quick install/i }));
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
    // The chip appears alongside the bootstrap target path. We use
    // `getAllByText` because the agent label also appears in the picker
    // <select>.
    expect(within(dialog).getAllByText(/Claude Code/).length).toBeGreaterThan(0);

    // Default scope after bootstrap returns is "project" (from the mocked
    // BOOTSTRAP_BODY.scope), so the project path should be in the chip
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

    expect(within(dialog).getByText(/API key required/i)).toBeInTheDocument();
    expect(
      within(dialog).getByRole("button", { name: /generate api key/i }),
    ).toBeEnabled();

    // The two-line snippet uses the placeholder until a key is minted.
    expect(within(dialog).getByText(/<your-catalog-api-key>/)).toBeInTheDocument();
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

    // Green "API key ready" row appears, amber row disappears.
    await within(dialog).findByText(/API key ready/i);
    expect(within(dialog).queryByText(/API key required/i)).toBeNull();

    // The raw key is rendered in its own copyable block with the
    // one-time-visibility warning.
    expect(within(dialog).getByText(mintedKeyValue)).toBeInTheDocument();
    expect(
      within(dialog).getByText(/shown only once/i),
    ).toBeInTheDocument();

    // The snippet now embeds the real key value; the placeholder is gone.
    expect(within(dialog).queryByText(/<your-catalog-api-key>/)).toBeNull();
  });

  it("Copy writes the verbatim two-line snippet (export + curl) to clipboard", async () => {
    const user = await renderAndOpenModal();
    const dialog = getDialog();

    // Mint first so the snippet contains the real key (more useful assertion
    // than copying the placeholder version).
    await user.click(
      within(dialog).getByRole("button", { name: /generate api key/i }),
    );
    await within(dialog).findByText(/API key ready/i);

    // The minted-key block exposes its own Copy button (CopyableBlock),
    // which may have already been clicked or auto-focused depending on
    // implementation. Reset the mock so we only observe the snippet copy.
    clipboardWriteTextMock.mockClear();

    // The snippet's Copy button has visible text "Copy" — the
    // CopyableBlock for the minted key uses an icon-only button with
    // aria-label="Copy API key". Match the more specific name to avoid
    // ambiguity, falling back to the broader regex if names change.
    const copyButtons = within(dialog)
      .getAllByRole("button")
      .filter((b) => /^\s*copy\s*$/i.test(b.textContent ?? ""));
    expect(copyButtons.length).toBeGreaterThan(0);
    // `userEvent.setup()` installs its own clipboard polyfill that
    // shadows our `Object.defineProperty` mock, so we spy on the live
    // `writeText` *just before* the click and inspect that.
    const liveWriteText = jest.spyOn(navigator.clipboard, "writeText");
    await user.click(copyButtons[0]);

    await waitFor(() => {
      expect(liveWriteText).toHaveBeenCalled();
    });
    // Find the call whose payload looks like the install snippet — the
    // minted-key block also writes to clipboard, but its payload is just
    // the bare key, not a multi-line `export ; curl` script.
    const snippetCall = liveWriteText.mock.calls.find(
      ([arg]) => typeof arg === "string" && arg.includes("curl -fsSL"),
    );
    expect(snippetCall).toBeDefined();
    const copied = snippetCall![0] as string;

    // Must be the two-line `export ; curl | bash` form, NOT the placeholder.
    expect(copied).toMatch(/^export CAIPE_CATALOG_KEY='test-mint-key-abcdef123'\n/);
    expect(copied).toContain("curl -fsSL");
    expect(copied).toContain("/api/skills/install.sh?");
    expect(copied).toContain("agent=claude");
    expect(copied).toMatch(/\| bash$/);
    expect(copied).not.toContain("<your-catalog-api-key>");

    // Button label flips to "Copied" briefly.
    await within(dialog).findByRole("button", { name: /copied/i });
  });

  it("snippet shows the placeholder + idempotency hint when no key has been minted", async () => {
    await renderAndOpenModal();
    const dialog = getDialog();

    expect(within(dialog).getByText(/<your-catalog-api-key>/)).toBeInTheDocument();
    expect(
      within(dialog).getByText(/idempotent and safe to re-run/i),
    ).toBeInTheDocument();
    // `--upgrade` is referenced in both the idempotency hint AND the
    // optional "after minting" copy section if it's rendered, so just
    // assert at-least-one occurrence.
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

    await user.click(screen.getByRole("button", { name: /quick install/i }));
    const dialog = await screen.findByRole("dialog");

    expect(within(dialog).getByText(/^10 skills$/i)).toBeInTheDocument();
    expect(within(dialog).queryByText(/skills from catalog/i)).toBeNull();
  });
});
