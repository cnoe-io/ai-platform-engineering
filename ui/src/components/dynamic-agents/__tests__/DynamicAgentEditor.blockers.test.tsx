/**
 * Tests for the "what's blocking submit" hint on DynamicAgentEditor.
 *
 * Before this fix, the Create Agent button silently went `disabled` whenever
 * any required field was missing — most commonly Owner Team — with no
 * explanation. The form is a 5-step wizard; the picker lives on step 1 but
 * the submit button is below step 5, so users on later steps saw a disabled
 * button with nothing telling them why. This suite locks in the new
 * behaviour: a visible blocker hint + a one-click "go to that step" shortcut
 * + a native title= mirror for hover.
 *
 * assisted-by Cursor claude-opus-4-7
 */

import React from "react";
import { render, screen, fireEvent, act, waitFor } from "@testing-library/react";

// ============================================================================
// Mocks — must be hoisted above the component import
// ============================================================================

jest.mock("@uiw/react-codemirror", () => ({
  __esModule: true,
  default: ({ value, onChange }: { value?: string; onChange?: (v: string) => void }) => (
    <textarea
      data-testid="codemirror-mock"
      value={value || ""}
      onChange={(e) => onChange?.(e.target.value)}
    />
  ),
}));

jest.mock("@codemirror/lang-markdown", () => ({ markdown: () => ({}) }));
jest.mock("@codemirror/language-data", () => ({ languages: [] }));
jest.mock("@codemirror/view", () => ({ EditorView: { lineWrapping: {} } }));
jest.mock("@/lib/codemirror/jinja2-highlight", () => ({ jinja2Highlight: {} }));
jest.mock("@/lib/codemirror/markdown-highlight", () => ({ markdownHighlight: {} }));

jest.mock("@/components/dynamic-agents/AllowedToolsPicker", () => ({
  AllowedToolsPicker: () => <div data-testid="allowed-tools-picker" />,
}));
jest.mock("@/components/dynamic-agents/BuiltinToolsPicker", () => ({
  BuiltinToolsPicker: () => <div data-testid="builtin-tools-picker" />,
}));
jest.mock("@/components/dynamic-agents/MiddlewarePicker", () => ({
  MiddlewarePicker: () => <div data-testid="middleware-picker" />,
}));
jest.mock("@/components/dynamic-agents/SubagentPicker", () => ({
  SubagentPicker: () => <div data-testid="subagent-picker" />,
}));
jest.mock("@/components/dynamic-agents/SkillsSelector", () => ({
  SkillsSelector: () => <div data-testid="skills-selector" />,
}));

jest.mock("react-markdown", () => ({
  __esModule: true,
  default: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));
jest.mock("remark-gfm", () => ({}));
jest.mock("@/lib/markdown-components", () => ({ getMarkdownComponents: () => ({}) }));

jest.mock("@/components/ui/toast", () => ({
  useToast: () => ({ toast: jest.fn() }),
}));

jest.mock("framer-motion", () => ({
  __esModule: true,
  motion: new Proxy(
    {},
    {
      get:
        () =>
        ({ children, ...props }: { children?: React.ReactNode; [k: string]: unknown }) =>
          <div {...(props as object)}>{children}</div>,
    }
  ),
  AnimatePresence: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

// ============================================================================
// Imports — after mocks
// ============================================================================

import { DynamicAgentEditor } from "../DynamicAgentEditor";

// ============================================================================
// Helpers
// ============================================================================

function jsonResponse(body: unknown) {
  return {
    ok: true,
    status: 200,
    json: async () => body,
    text: async () => JSON.stringify(body),
  };
}

/**
 * Wire up a fetch mock that returns a single model (so the model dropdown is
 * populated) and one own-able team (so the Owner Team blocker can flip from
 * "missing" to "filled" inside a test without rerendering).
 */
function mockApi() {
  const fetchMock = jest.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
    const u = typeof url === "string" ? url : url.toString();
    if (u.includes("/api/dynamic-agents/models")) {
      return jsonResponse({
        success: true,
        data: [
          { model_id: "gpt-4o", name: "GPT-4o", provider: "openai", description: "" },
        ],
      });
    }
    if (u.includes("/api/dynamic-agents/teams")) {
      return jsonResponse({
        success: true,
        data: [
          { _id: "team-1", slug: "platform", name: "Platform", can_own_agents: true, user_role: "admin" },
        ],
      });
    }
    if (init?.method === "PUT" || init?.method === "POST") {
      return jsonResponse({ success: true, data: {} });
    }
    if (u.includes("/api/dynamic-agents")) {
      return jsonResponse({ success: true, data: { items: [] } });
    }
    return jsonResponse({ success: true, data: {} });
  });
  // @ts-expect-error - global fetch override for tests
  global.fetch = fetchMock;
  return fetchMock;
}

async function flushAsync() {
  await act(async () => {
    await new Promise((r) => setTimeout(r, 50));
  });
}

// ============================================================================
// Tests
// ============================================================================

describe("DynamicAgentEditor — submit-blocked hint", () => {
  beforeEach(() => {
    mockApi();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("shows an Owner Team required hint when creating an agent and the picker is empty", async () => {
    render(<DynamicAgentEditor onCancel={jest.fn()} onSave={jest.fn()} />);
    await flushAsync();

    // Fill the blockers that come BEFORE Owner Team in the array — name
    // and model — so Owner Team is the first remaining blocker. (System
    // prompt comes AFTER ownerTeam in the blockers list, so we don't need
    // to fill it for this test; the inline hint always surfaces blockers[0].)
    const nameInput = screen.getByPlaceholderText(/Code Review Agent/i) as HTMLInputElement;
    fireEvent.change(nameInput, { target: { value: "blocker-test-agent" } });

    // At this point: name ✔, model ✔ (auto-picked from the models fetch),
    // owner_team ✗. The blocker hint MUST surface Owner Team.
    const hint = await screen.findByTestId("create-agent-blocker-hint");
    expect(hint).toHaveTextContent(/Owner Team/);
    expect(hint).toHaveTextContent(/Basic Info/);

    // The Create Agent button is the disabled one (and has the tooltip).
    const createButton = screen.getByRole("button", { name: /Create Agent/i });
    expect(createButton).toBeDisabled();
    expect(createButton).toHaveAttribute(
      "title",
      expect.stringContaining("Owner Team is required") as unknown as string
    );
  });

  it("removes the Owner Team blocker from the hint once the picker is filled", async () => {
    render(<DynamicAgentEditor onCancel={jest.fn()} onSave={jest.fn()} />);
    await flushAsync();

    const nameInput = screen.getByPlaceholderText(/Code Review Agent/i) as HTMLInputElement;
    fireEvent.change(nameInput, { target: { value: "blocker-test-agent" } });

    // Pre-condition: Owner Team is currently the first blocker.
    expect(await screen.findByTestId("create-agent-blocker-hint")).toHaveTextContent(/Owner Team/);

    // Pick the team.
    const ownerSelect = screen.getByLabelText(/Owner Team/i) as HTMLSelectElement;
    fireEvent.change(ownerSelect, { target: { value: "platform" } });

    // System prompt is still empty — so the hint stays visible, but now it
    // surfaces Instructions instead of Owner Team. Owner Team must be gone.
    await waitFor(() => {
      const hint = screen.queryByTestId("create-agent-blocker-hint");
      // Either the hint disappeared entirely (no remaining blockers) or it
      // no longer surfaces Owner Team. Both indicate the picker fixed it.
      if (hint) {
        expect(hint).not.toHaveTextContent(/Owner Team/);
      }
    });
  });

  it("does NOT render the hint or block submit when editing an existing agent (Owner Team is fixed at create time)", async () => {
    // When `agent` is supplied, isEditing is true and the Owner Team picker
    // is disabled; the blocker logic skips the Owner Team check entirely.
    const agent = {
      _id: "agent-edit-1",
      name: "Existing Agent",
      description: "",
      system_prompt: "You exist.",
      allowed_tools: {},
      builtin_tools: undefined,
      model: { id: "gpt-4o", provider: "openai" as const },
      visibility: "team" as const,
      owner_team_slug: "platform",
      owner_team_id: "team-1",
      shared_with_teams: [],
      subagents: [],
      skills: [],
      ui: { gradient_theme: "default" as const },
      enabled: true,
      owner_id: "user-1",
      is_system: false,
      created_at: "2026-04-29T00:00:00Z",
      updated_at: "2026-04-29T00:00:00Z",
    };

    render(<DynamicAgentEditor agent={agent} onCancel={jest.fn()} onSave={jest.fn()} />);
    await flushAsync();

    expect(screen.queryByTestId("create-agent-blocker-hint")).not.toBeInTheDocument();
    const saveButton = screen.getByRole("button", { name: /Save Changes/i });
    expect(saveButton).not.toBeDisabled();
  });

  it("offers a 'Go to Basic Info' shortcut that jumps the wizard to the right step", async () => {
    render(<DynamicAgentEditor onCancel={jest.fn()} onSave={jest.fn()} />);
    await flushAsync();

    // Fill the name so Owner Team becomes blockers[0] (otherwise "Agent name"
    // is the first blocker and the Go-to shortcut would still point at basic
    // but we couldn't differentiate "ownerTeam-blocked" from "name-blocked").
    const nameInput = screen.getByPlaceholderText(/Code Review Agent/i) as HTMLInputElement;
    fireEvent.change(nameInput, { target: { value: "blocker-test-agent" } });

    // Click "Next" once to leave the basic step. The Next button has the
    // exact label "Next" inside the step navigation row.
    const nextBtn = screen.getByRole("button", { name: /^Next$/i });
    fireEvent.click(nextBtn); // basic → instructions

    // The blocker hint should still render (it lives in the footer, outside
    // the step content) and the "Go to Basic Info" link should appear because
    // we're no longer on the basic step.
    const hint = await screen.findByTestId("create-agent-blocker-hint");
    expect(hint).toHaveTextContent(/Owner Team/);

    const goToBtn = screen.getByRole("button", { name: /Go to Basic Info/i });
    expect(goToBtn).toBeInTheDocument();
    fireEvent.click(goToBtn);

    // After clicking, the Owner Team picker is back on screen (i.e. we
    // jumped to basic). Use the select's label as proof of presence.
    expect(screen.getByLabelText(/Owner Team/i)).toBeInTheDocument();
  });
});
