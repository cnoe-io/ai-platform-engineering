/**
 * Tests for how DynamicAgentEditor enforces required fields on submit.
 *
 * Submission controls remain enabled while required fields are missing. The
 * editor shows the first blocker inline, keeps forward navigation on the
 * relevant step, and never sends an incomplete payload to the API.
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

jest.mock("@/lib/config", () => ({
  getConfig: jest.fn(() => null),
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
import { pickTeam } from "@/__test-utils__/team-picker";
import { getConfig } from "@/lib/config";

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
 * populated) and own-able teams (so the Owner Team blocker can flip from
 * "missing" to "filled" and edit-mode transfers can switch teams without
 * rerendering).
 */
const defaultTeams = [
  { _id: "team-1", slug: "platform", name: "Platform", can_own_agents: true, user_role: "admin" },
  { _id: "team-2", slug: "data-eng", name: "Data Eng", can_own_agents: true, user_role: "admin" },
];

function mockApi(teams = defaultTeams) {
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
        data: teams,
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

describe("DynamicAgentEditor — required-field enforcement", () => {
  beforeEach(() => {
    jest.mocked(getConfig).mockReturnValue(null);
    mockApi();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("keeps Create Agent enabled and shows an inline warning while Owner Team is empty", async () => {
    render(<DynamicAgentEditor onCancel={jest.fn()} onSave={jest.fn()} />);
    await flushAsync();

    // Fill the blockers that come BEFORE Owner Team in the array — name
    // and model — so Owner Team is the first remaining blocker. (System
    // prompt comes AFTER ownerTeam in the blockers list; the title= mirror
    // always reflects blockers[0].)
    const nameInput = screen.getByPlaceholderText(/Code Review Agent/i) as HTMLInputElement;
    fireEvent.change(nameInput, { target: { value: "blocker-test-agent" } });

    // At this point: name ✔, model ✔ (auto-picked from the models fetch),
    // owner_team ✗. The action remains available and its blocker is visible.
    const createButton = await screen.findByRole("button", { name: /Create Agent/i });
    expect(createButton).toBeEnabled();
    expect(createButton).toHaveAttribute(
      "title",
      expect.stringContaining("Owner Team is required") as unknown as string
    );
    expect(screen.getByTestId("create-agent-blocker-hint")).toHaveTextContent(
      "Owner Team is required",
    );
  });

  it("marks the empty Owner Team picker invalid and explains how to continue", async () => {
    render(<DynamicAgentEditor onCancel={jest.fn()} onSave={jest.fn()} />);
    await flushAsync();

    const nameInput = screen.getByPlaceholderText(/Code Review Agent/i) as HTMLInputElement;
    fireEvent.change(nameInput, { target: { value: "blocker-test-agent" } });

    expect(screen.getByLabelText(/Owner Team/i)).toHaveAttribute("aria-invalid", "true");
    expect(
      screen.getByText(/Choose an owner team before continuing/i),
    ).toBeInTheDocument();
  });

  it("buzzes Next, focuses the first required field, and explains why navigation stopped", async () => {
    render(<DynamicAgentEditor onCancel={jest.fn()} onSave={jest.fn()} />);
    await flushAsync();

    const nextButton = screen.getByRole("button", { name: /Next/i });
    expect(nextButton).toBeEnabled();
    expect(screen.getByTestId("next-step-feedback")).toHaveAttribute(
      "data-validation-buzz",
      "0",
    );

    fireEvent.click(nextButton);

    expect(screen.getByRole("heading", { name: "Step 1: Basic Info" })).toBeInTheDocument();
    expect(screen.getByTestId("create-agent-blocker-hint")).toBeInTheDocument();
    expect(screen.getByTestId("next-step-feedback")).toHaveAttribute(
      "data-validation-buzz",
      "1",
    );
    expect(
      screen.getByText("Enter an agent name before continuing."),
    ).toBeInTheDocument();
    const nameInput = screen.getByPlaceholderText(/Code Review Agent/i);
    expect(nameInput).toHaveAttribute("aria-invalid", "true");
    await waitFor(() => expect(nameInput).toHaveFocus());
  });

  it("auto-selects outshift-everyone when it is an eligible owner team", async () => {
    mockApi([
      {
        _id: "team-everyone",
        slug: "outshift-everyone",
        name: "Outshift Everyone",
        can_own_agents: true,
        user_role: "member",
      },
      ...defaultTeams,
    ]);

    render(<DynamicAgentEditor onCancel={jest.fn()} onSave={jest.fn()} />);
    await flushAsync();

    expect(screen.getByLabelText(/Owner Team/i)).toHaveTextContent("Outshift Everyone");
    expect(screen.getByLabelText(/Owner Team/i)).not.toHaveAttribute("aria-invalid", "true");
    expect(screen.queryByText(/Choose an owner team before continuing/i)).not.toBeInTheDocument();
  });

  it("uses DEFAULT_TEAM_SLUG as the owner-team override", async () => {
    jest.mocked(getConfig).mockReturnValue("platform");

    render(<DynamicAgentEditor onCancel={jest.fn()} onSave={jest.fn()} />);
    await flushAsync();

    expect(screen.getByLabelText(/Owner Team/i)).toHaveTextContent("Platform");
  });

  it("starts on the deep-linked setup step and reports subsequent step changes", async () => {
    const onStepChange = jest.fn();
    render(
      <DynamicAgentEditor
        initialStep="tools"
        onStepChange={onStepChange}
        onCancel={jest.fn()}
        onSave={jest.fn()}
      />,
    );
    await flushAsync();

    expect(screen.getByRole("heading", { name: "Step 3: Tools" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /Advanced/i }));

    expect(onStepChange).toHaveBeenCalledWith("advanced");
    expect(screen.getByRole("heading", { name: "Step 5: Advanced" })).toBeInTheDocument();
  });

  it("clears the Owner Team warning once a team is selected", async () => {
    render(<DynamicAgentEditor onCancel={jest.fn()} onSave={jest.fn()} />);
    await flushAsync();

    const nameInput = screen.getByPlaceholderText(/Code Review Agent/i) as HTMLInputElement;
    fireEvent.change(nameInput, { target: { value: "blocker-test-agent" } });

    // Pre-condition: button is available, owner picker is flagged.
    const createButton = screen.getByRole("button", { name: /Create Agent/i });
    expect(createButton).toBeEnabled();

    // Pick the team via the searchable TeamPicker (2026-05-27).
    await pickTeam(/Owner Team/i, "platform");

    // Owner Team is no longer the blocker, so the picker clears aria-invalid
    // and the tooltip stops naming it (system prompt is the remaining blocker).
    await waitFor(() => {
      expect(screen.getByLabelText(/Owner Team/i)).not.toHaveAttribute("aria-invalid", "true");
      expect(createButton).not.toHaveAttribute(
        "title",
        expect.stringContaining("Owner Team is required") as unknown as string,
      );
      expect(screen.getByTestId("create-agent-blocker-hint")).not.toHaveTextContent(
        "Owner Team is required",
      );
    });
  });

  it("lets edit-mode owner team changes save as ownership transfers", async () => {
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

    const onSave = jest.fn();
    render(<DynamicAgentEditor agent={agent} onCancel={jest.fn()} onSave={onSave} />);
    await flushAsync();

    expect(screen.queryByTestId("create-agent-blocker-hint")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Transfer ownership/i })).not.toBeInTheDocument();
    expect(screen.getByLabelText(/Owner Team/i)).not.toBeDisabled();
    expect(
      screen.getByText(/Changing the owner team will transfer ownership when you save/i),
    ).toBeInTheDocument();

    await pickTeam(/Owner Team/i, "data-eng");

    const saveButton = screen.getByRole("button", { name: /Save Changes/i });
    expect(saveButton).not.toBeDisabled();

    await act(async () => {
      fireEvent.click(saveButton);
      await new Promise((r) => setTimeout(r, 50));
    });

    const fetchMock = global.fetch as jest.Mock;
    const putCall = fetchMock.mock.calls.find(([, init]) => init?.method === "PUT");
    expect(putCall).toBeDefined();
    expect(JSON.parse(String(putCall?.[1]?.body))).toMatchObject({
      owner_team_slug: "data-eng",
      confirm_not_member: false,
    });
    expect(onSave).toHaveBeenCalledTimes(1);
  });
});
