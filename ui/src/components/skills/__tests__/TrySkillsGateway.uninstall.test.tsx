/**
 * Uninstall section tests for `TrySkillsGateway`.
 *
 * The Step 3 install panel exposes an "Uninstall (reverse the install)"
 * `<details>` block that surfaces three flavors of the
 * `?mode=uninstall` one-liner. These tests pin:
 *
 *   1. The block is hidden until a scope is chosen (matches install-side
 *      behavior; the URL needs scope to compute the right manifest path).
 *   2. The three snippets all hit `install.sh?mode=uninstall` and carry
 *      the agent + scope query params (no leak of the catalog query
 *      params from Step 1).
 *   3. Default flavor is interactive (no `--all`/`--purge`/`--dry-run`)
 *      so a user copy-paste can never wipe their config.json by accident.
 *   4. Dry-run is `bash -s -- --dry-run` (the conventional way to pass
 *      flags to a piped script).
 *   5. Purge is `bash -s -- --purge` and the helper text mentions
 *      re-entering the gateway URL + api_key.
 *   6. Each "copy" button writes the verbatim snippet to the clipboard
 *      (no key injection, no shell-quote round-trip surprises).
 *
 * We deliberately do NOT re-test the install / quick-install flows here;
 * those have their own file. Keeping this test file scoped to the
 * uninstall block makes regressions in the destructive flow easy to
 * triage (the file fails or it doesn't).
 */

import React from "react";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

// ----------------------------------------------------------------------------
// next/* mocks (same shape as the quick-install test file)
// ----------------------------------------------------------------------------

jest.mock("next/link", () => {
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
// Per-URL fetch mock
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

// Post-overhaul shape: install_paths is keyed by scope and each value
// is an ARRAY of universal-target paths (Claude tree + agents tree).
// All deprecated layout/format/fragment fields are gone.
const LIVE_SKILLS_BODY = {
  agent: "claude",
  label: "Claude Code",
  template:
    "---\nname: skills\ndescription: Browse the catalog\n---\n# Live skills\nDo a thing.",
  install_path: "~/.claude/skills/skills/SKILL.md",
  install_paths: {
    user: [
      "~/.claude/skills/skills/SKILL.md",
      "~/.agents/skills/skills/SKILL.md",
    ],
    project: [
      "./.claude/skills/skills/SKILL.md",
      "./.agents/skills/skills/SKILL.md",
    ],
  },
  scope: "user",
  scope_requested: "user",
  scope_fallback: false,
  scopes_available: ["user", "project"],
  launch_guide:
    "## Launch the skill\n\nRun `/skills` inside Claude Code.\n",
  agents: [
    {
      id: "claude",
      label: "Claude Code",
      install_paths: {
        user: [
          "~/.claude/skills/skills/SKILL.md",
          "~/.agents/skills/skills/SKILL.md",
        ],
        project: [
          "./.claude/skills/skills/SKILL.md",
          "./.agents/skills/skills/SKILL.md",
        ],
      },
      scopes_available: ["user", "project"],
    },
  ],
  source: "chart-default",
};

let clipboardWriteTextMock: jest.Mock;

beforeEach(() => {
  global.fetch = jest.fn((input: RequestInfo | URL, _init?: RequestInit) => {
    const url = typeof input === "string" ? input : input.toString();
    if (url.startsWith("/api/catalog-api-keys")) {
      return jsonResponse({ ok: true, body: { keys: [] } });
    }
    if (url.startsWith("/api/skills/live-skills")) {
      return jsonResponse({ ok: true, body: LIVE_SKILLS_BODY });
    }
    if (url.startsWith("/api/skills")) {
      return jsonResponse({ ok: true, body: { skills: [], meta: { total: 0 } } });
    }
    // Anything else: empty 200 keeps the component from crashing.
    return jsonResponse({ ok: true, body: {} });
  }) as unknown as typeof fetch;

  clipboardWriteTextMock = jest.fn().mockResolvedValue(undefined);
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: { writeText: clipboardWriteTextMock },
  });
});

afterEach(() => {
  jest.restoreAllMocks();
});

// ----------------------------------------------------------------------------
// Helpers
// ----------------------------------------------------------------------------

async function renderAndChooseScope(scope: "user" | "project" = "user") {
  const { TrySkillsGateway } = await import("../TrySkillsGateway");
  // userEvent.setup() installs its own jsdom clipboard handler which
  // shadows the one we install in beforeEach. Re-install ours AFTER
  // setup so the copy-button assertions see the writes.
  const user = userEvent.setup();
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: { writeText: clipboardWriteTextMock },
  });
  render(<TrySkillsGateway />);

  // Wait for live-skills + agents to populate so the scope picker is
  // rendered with both options.
  await waitFor(() =>
    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining("/api/skills/live-skills"),
      expect.anything(),
    ),
  );

  // The scope picker is a pair of <input type="radio" name="install-scope">
  // with human-friendly labels ("User-wide (reused across all projects)"
  // for `user`, "Project-local (committed with this repo)" for `project`).
  // After the skills-only overhaul, the project radio sits inside an
  // "Advanced: install per-project instead" <details>. We must open
  // that disclosure first or the radio won't render in the DOM.
  await waitFor(() => {
    expect(
      document.querySelectorAll('input[name="install-scope"][value="user"]').length,
    ).toBeGreaterThan(0);
  });

  if (scope === "project") {
    const advanced = await waitFor(() =>
      screen.getByText(/Advanced: install per-project instead/i),
    );
    await user.click(advanced);
  }

  // Click the matching radio. Both Step 3 picker and the Quick install
  // dialog share `name="install-scope"`, so we click the FIRST one
  // (the dialog is closed in these tests).
  const radios = Array.from(
    document.querySelectorAll<HTMLInputElement>(
      `input[name="install-scope"][value="${scope}"]`,
    ),
  );
  expect(radios.length).toBeGreaterThan(0);
  await user.click(radios[0]);
  return { user };
}

async function openUninstallDetails() {
  // The summary text is exactly what the source prints. We use a partial
  // match so a future copy tweak ("Uninstall this install" etc.) doesn't
  // break the test.
  const summary = await waitFor(() =>
    screen.getByText(/Uninstall \(reverse the install\)/i),
  );
  // <details> opens by clicking the <summary> child; testing-library's
  // user-event handles this correctly even though the element isn't a
  // standard "button" role.
  const user = userEvent.setup();
  await user.click(summary);
  return summary.closest("details") as HTMLDetailsElement;
}

// ----------------------------------------------------------------------------
// Tests
// ----------------------------------------------------------------------------

describe("TrySkillsGateway — uninstall block visibility", () => {
  it("appears on first paint because user-wide scope is the new default", async () => {
    // After the agent-picker drop + scope-default change, the
    // installerSnippets block (which hosts the uninstall <details>)
    // is gated on `selectedScope` -- and `selectedScope` now starts
    // at "user" instead of null. So the uninstall summary should
    // show up immediately, no clicks required.
    const { TrySkillsGateway } = await import("../TrySkillsGateway");
    render(<TrySkillsGateway />);
    await waitFor(() =>
      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringContaining("/api/skills/live-skills"),
        expect.anything(),
      ),
    );
    await waitFor(() =>
      expect(
        screen.getByText(/Uninstall \(reverse the install\)/i),
      ).toBeInTheDocument(),
    );
  });

  it("still appears after explicitly re-picking user scope", async () => {
    await renderAndChooseScope("user");
    await waitFor(() =>
      expect(
        screen.getByText(/Uninstall \(reverse the install\)/i),
      ).toBeInTheDocument(),
    );
  });
});

describe("TrySkillsGateway — uninstall snippet content", () => {
  it("interactive flavor: targets ?mode=uninstall and is the default (no flags)", async () => {
    await renderAndChooseScope("user");
    const details = await openUninstallDetails();

    // The interactive snippet is the first <pre> inside the open <details>.
    // Use a regex on its text content so we tolerate whitespace tweaks.
    const pres = within(details).getAllByText(
      (_content, node) => !!node && node.tagName === "PRE",
    );
    const interactive = pres[0].textContent ?? "";
    expect(interactive).toMatch(/curl -fsSL '.+install\.sh\?[^']+' \| bash$/);
    // Must include mode=uninstall (the whole point of the block).
    expect(interactive).toContain("mode=uninstall");
    // Scope must still be in the URL so the script reads the right
    // manifest. The agent picker was dropped from the UI -- ?agent=
    // is no longer emitted; install.sh defaults to claude server-
    // side. We only assert the scope key, not URL ordering.
    expect(interactive).not.toContain("agent=");
    expect(interactive).toContain("scope=user");
    // Default flavor MUST NOT carry --all/--purge/--dry-run -- the
    // safety net is the per-item prompt, and a destructive default
    // shouldn't be a `curl | bash` away.
    expect(interactive).not.toContain("--all");
    expect(interactive).not.toContain("--purge");
    expect(interactive).not.toContain("--dry-run");
  });

  it("dry-run flavor: passes --dry-run via `bash -s --`", async () => {
    await renderAndChooseScope("user");
    const details = await openUninstallDetails();
    const pres = within(details).getAllByText(
      (_content, node) => !!node && node.tagName === "PRE",
    );
    // Order in the source: interactive, dry-run, purge.
    const dryRun = pres[1].textContent ?? "";
    expect(dryRun).toContain("mode=uninstall");
    expect(dryRun).toMatch(/bash -s -- --dry-run$/);
  });

  it("purge flavor: passes --purge and warns about re-entering credentials", async () => {
    await renderAndChooseScope("user");
    const details = await openUninstallDetails();

    const pres = within(details).getAllByText(
      (_content, node) => !!node && node.tagName === "PRE",
    );
    const purge = pres[2].textContent ?? "";
    expect(purge).toContain("mode=uninstall");
    expect(purge).toMatch(/bash -s -- --purge$/);

    // The helper text underneath must mention the credential re-entry
    // cost so the user understands what --purge actually does.
    expect(
      within(details).getByText(/re-enter the gateway URL/i),
    ).toBeInTheDocument();
    expect(within(details).getByText(/catalog API key/i)).toBeInTheDocument();
  });

  it("project scope flips the URL's scope query param", async () => {
    await renderAndChooseScope("project");
    const details = await openUninstallDetails();
    const pres = within(details).getAllByText(
      (_content, node) => !!node && node.tagName === "PRE",
    );
    const interactive = pres[0].textContent ?? "";
    expect(interactive).toContain("scope=project");
    expect(interactive).not.toContain("scope=user");
  });
});

describe("TrySkillsGateway — uninstall snippet copy buttons", () => {
  // Each copy button writes a different snippet; we exercise all three to
  // pin that the click handlers pass the RIGHT body to clipboard.writeText
  // (an easy way to break this is a copy-paste bug in the JSX).

  async function copyNthSnippet(n: 0 | 1 | 2) {
    await renderAndChooseScope("user");
    const details = await openUninstallDetails();
    // Collect every <pre> inside the open details by querying the DOM
    // directly. `within().getAllByText(matcher)` is finicky because
    // testing-library matches the *text content*, not the element
    // itself, and a <pre> with whitespace can match zero or many text
    // nodes depending on jsdom's normalization.
    const pres = Array.from(
      details.querySelectorAll<HTMLPreElement>("pre"),
    );
    expect(pres.length).toBeGreaterThanOrEqual(3);
    const target = pres[n];
    // The Button is a sibling inside the `relative group` wrapper:
    //   <div className="relative group">
    //     <pre>...</pre>
    //     <Button onClick={writeText(snippet)}>...</Button>
    //   </div>
    const wrapper = target.parentElement!;
    const buttons = wrapper.querySelectorAll("button");
    expect(buttons.length).toBeGreaterThan(0);
    // userEvent.setup() (called inside renderAndChooseScope) installs
    // its own clipboard polyfill that shadows the `defineProperty` mock
    // from beforeEach. Mirror the existing quick-install test: spy on
    // the LIVE `writeText` immediately before the click and inspect
    // that, not our outer mock.
    const liveWriteText = jest.spyOn(navigator.clipboard, "writeText");
    const user = userEvent.setup();
    await user.click(buttons[0] as HTMLElement);
    return { expected: target.textContent ?? "", liveWriteText };
  }

  it("interactive Copy writes the interactive one-liner", async () => {
    const { expected, liveWriteText } = await copyNthSnippet(0);
    await waitFor(() => expect(liveWriteText).toHaveBeenCalled());
    expect(liveWriteText).toHaveBeenCalledWith(expected);
    expect(expected).toContain("mode=uninstall");
    expect(expected).not.toContain("--purge");
  });

  it("dry-run Copy writes the dry-run one-liner", async () => {
    const { expected, liveWriteText } = await copyNthSnippet(1);
    await waitFor(() => expect(liveWriteText).toHaveBeenCalled());
    expect(liveWriteText).toHaveBeenCalledWith(expected);
    expect(expected).toContain("--dry-run");
  });

  it("purge Copy writes the purge one-liner", async () => {
    const { expected, liveWriteText } = await copyNthSnippet(2);
    await waitFor(() => expect(liveWriteText).toHaveBeenCalled());
    expect(liveWriteText).toHaveBeenCalledWith(expected);
    expect(expected).toContain("--purge");
  });
});
