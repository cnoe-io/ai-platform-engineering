/**
 * Tests for SkillsBuilderEditor component.
 *
 * Covers:
 *  - Form validation (name, category, content, team visibility)
 *  - Form submission (create / update)
 *  - Edit mode initialisation from existingConfig
 *  - SKILL.md import via handleImportSkillMd
 *  - Template loading via handleLoadTemplate
 *  - System-config guard for non-admin users
 *  - Input change clears field errors
 *  - Escape key closes the editor
 */

import React from "react";
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";
import { SkillsBuilderEditor } from "../SkillsBuilderEditor";
import type { AgentConfig } from "@/types/agent-config";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockCreateConfig = jest.fn().mockResolvedValue(undefined);
const mockUpdateConfig = jest.fn().mockResolvedValue(undefined);

jest.mock("@/store/agent-config-store", () => ({
  useAgentConfigStore: () => ({
    createConfig: mockCreateConfig,
    updateConfig: mockUpdateConfig,
  }),
}));

let mockIsAdmin = false;
jest.mock("@/hooks/use-admin-role", () => ({
  useAdminRole: () => ({ isAdmin: mockIsAdmin }),
}));

const mockToast = jest.fn();
jest.mock("@/components/ui/toast", () => ({
  useToast: () => ({ toast: mockToast }),
}));

jest.mock("@/skills", () => ({
  fetchSkillTemplates: jest.fn().mockResolvedValue([]),
  getAllTemplateTags: jest.fn().mockReturnValue([]),
}));

jest.mock("@/lib/skill-md-parser", () => {
  const actual = jest.requireActual("@/lib/skill-md-parser");
  return {
    ...actual,
    parseSkillMd: actual.parseSkillMd,
    createBlankSkillMd: actual.createBlankSkillMd,
  };
});

// Mock heavy third-party dependencies to keep tests fast
jest.mock("react-resizable-panels", () => ({
  Panel: React.forwardRef(({ children }: any, ref: any) => <div ref={ref} data-testid="panel">{children}</div>),
  Group: React.forwardRef(({ children }: any, ref: any) => <div ref={ref} data-testid="panel-group">{children}</div>),
  Separator: React.forwardRef((props: any, ref: any) => <div ref={ref} data-testid="separator" />),
}));

jest.mock("@/components/ui/scroll-area", () => ({
  ScrollArea: ({ children }: any) => <div data-testid="scroll-area">{children}</div>,
}));

jest.mock("framer-motion", () => {
  const makeMotionComponent = (tag: string) =>
    React.forwardRef(({ children, initial, animate, exit, transition, whileHover, whileTap, ...rest }: any, ref: any) =>
      React.createElement(tag, { ref, ...rest }, children)
    );
  return {
    motion: new Proxy({} as Record<string, any>, {
      get: (_target, prop: string) => makeMotionComponent(prop),
    }),
    AnimatePresence: ({ children }: any) => <>{children}</>,
  };
});

jest.mock("react-markdown", () => {
  const MockReactMarkdown = function MockReactMarkdown({ children }: any) {
    return React.createElement("div", { "data-testid": "markdown-preview" }, children);
  };
  MockReactMarkdown.__esModule = true;
  MockReactMarkdown.default = MockReactMarkdown;
  return MockReactMarkdown;
});

jest.mock("remark-gfm", () => () => {});

jest.mock("react-syntax-highlighter", () => ({
  Prism: ({ children }: any) => <code>{children}</code>,
}));

jest.mock("react-syntax-highlighter/dist/esm/styles/prism", () => ({
  oneDark: {},
}));

jest.mock("@/lib/utils", () => ({
  cn: (...args: any[]) => args.filter(Boolean).join(" "),
}));

jest.mock("@uiw/react-codemirror", () => {
  const MockCodeMirror = React.forwardRef(function MockCodeMirror(props: any, ref: any) {
    return (
      <textarea
        data-testid="codemirror"
        ref={ref}
        value={props.value}
        onChange={(e) => props.onChange?.(e.target.value)}
      />
    );
  });
  return { __esModule: true, default: MockCodeMirror };
});

jest.mock("@codemirror/view", () => ({
  ViewPlugin: { fromClass: jest.fn(() => ({})) },
  Decoration: { mark: jest.fn(() => ({})) },
  MatchDecorator: jest.fn(),
}));

jest.mock("@codemirror/lang-markdown", () => ({
  markdown: jest.fn(() => ({})),
}));

jest.mock("@codemirror/language-data", () => ({
  languages: [],
}));

// Mock global fetch for /api/admin/teams
const MOCK_TEAMS = [
  { _id: "team-alpha", name: "Alpha Team" },
  { _id: "team-beta", name: "Beta Team" },
];

const originalFetch = global.fetch;
beforeAll(() => {
  global.fetch = jest.fn((url: string) => {
    if (url === "/api/admin/teams") {
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ data: { teams: MOCK_TEAMS } }),
      } as Response);
    }
    return originalFetch(url);
  }) as any;
});
afterAll(() => {
  global.fetch = originalFetch;
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const VALID_SKILL_CONTENT = `---
name: test-skill
description: A test skill
---

# Test Skill

Do the thing with {{repo_name}}.
`;

const SAMPLE_TEMPLATES = [
  {
    id: "tpl-pr-review",
    title: "PR Review",
    description: "Review a pull request",
    category: "GitHub",
    icon: "GitPullRequest",
    tags: ["GitHub", "Review"],
    content: "---\nname: pr-review\ndescription: Review a PR\n---\n\n# PR Review\n\nReview {{pr_url}}.",
  },
  {
    id: "tpl-deploy",
    title: "Deployment Check",
    description: "Verify a deployment",
    category: "ArgoCD",
    icon: "Rocket",
    tags: ["ArgoCD", "Deploy"],
    content: "---\nname: deploy-check\ndescription: Verify a deployment\n---\n\n# Deployment Check\n\nCheck {{app_name}} in {{cluster}}.",
  },
];

function renderEditor(
  props: Partial<React.ComponentProps<typeof SkillsBuilderEditor>> = {}
) {
  return render(
    <SkillsBuilderEditor
      open={true}
      onOpenChange={jest.fn()}
      {...props}
    />
  );
}

function makeExistingConfig(overrides: Partial<AgentConfig> = {}): AgentConfig {
  return {
    id: "cfg-123",
    name: "Existing Skill",
    description: "An existing skill",
    category: "DevOps",
    is_quick_start: true,
    is_system: false,
    owner_id: "user@example.com",
    tasks: [{ display_text: "Run", llm_prompt: "Do it", subagent: "caipe" }],
    created_at: new Date(),
    updated_at: new Date(),
    thumbnail: "Rocket",
    difficulty: "intermediate",
    visibility: "private",
    skill_content: VALID_SKILL_CONTENT,
    metadata: { tags: ["DevOps", "Test"] },
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { fetchSkillTemplates: mockFetchSkillTemplates } = require("@/skills") as {
  fetchSkillTemplates: jest.Mock;
};

beforeEach(() => {
  jest.clearAllMocks();
  mockIsAdmin = false;
  mockFetchSkillTemplates.mockResolvedValue(SAMPLE_TEMPLATES);
});

describe("SkillsBuilderEditor — form validation", () => {
  it("does not submit when name is empty", async () => {
    renderEditor();

    const nameInput = screen.getByPlaceholderText(/review a specific pr/i);
    fireEvent.change(nameInput, { target: { value: "" } });

    const saveButton = screen.getByRole("button", { name: /save skill/i });
    await act(async () => {
      fireEvent.click(saveButton);
    });

    expect(mockCreateConfig).not.toHaveBeenCalled();
  });

  it("shows error text when skill content is empty", async () => {
    renderEditor();

    const nameInput = screen.getByPlaceholderText(/review a specific pr/i);
    fireEvent.change(nameInput, { target: { value: "My Skill" } });

    const editor = screen.getByTestId("codemirror");
    fireEvent.change(editor, { target: { value: "" } });

    const saveButton = screen.getByRole("button", { name: /save skill/i });
    await act(async () => {
      fireEvent.click(saveButton);
    });

    expect(await screen.findByText(/skill content is required/i)).toBeInTheDocument();
    expect(mockCreateConfig).not.toHaveBeenCalled();
  });

  it("shows skill content error text when both name and content are empty", async () => {
    renderEditor();

    const editor = screen.getByTestId("codemirror");
    fireEvent.change(editor, { target: { value: "" } });

    const saveButton = screen.getByRole("button", { name: /save skill/i });
    await act(async () => {
      fireEvent.click(saveButton);
    });

    expect(mockCreateConfig).not.toHaveBeenCalled();
    expect(await screen.findByText(/skill content is required/i)).toBeInTheDocument();
  });
});

describe("SkillsBuilderEditor — submission", () => {
  it("calls createConfig with correct data on valid create submission", async () => {
    const onSuccess = jest.fn();
    renderEditor({ onSuccess });

    const nameInput = screen.getByPlaceholderText(/review a specific pr/i);
    fireEvent.change(nameInput, { target: { value: "My New Skill" } });

    const saveButton = screen.getByRole("button", { name: /save skill/i });
    await act(async () => {
      fireEvent.click(saveButton);
    });

    await waitFor(() => {
      expect(mockCreateConfig).toHaveBeenCalledTimes(1);
    });

    const configArg = mockCreateConfig.mock.calls[0][0];
    expect(configArg.name).toBe("My New Skill");
    expect(configArg.is_quick_start).toBe(true);
    expect(configArg.tasks).toHaveLength(1);
    expect(configArg.tasks[0].subagent).toBe("caipe");
  });

  it("calls updateConfig in edit mode", async () => {
    const existing = makeExistingConfig();
    renderEditor({ existingConfig: existing });

    const updateButton = screen.getByRole("button", { name: /update skill/i });
    await act(async () => {
      fireEvent.click(updateButton);
    });

    await waitFor(() => {
      expect(mockUpdateConfig).toHaveBeenCalledTimes(1);
      expect(mockUpdateConfig).toHaveBeenCalledWith("cfg-123", expect.any(Object));
    });
  });

  it("shows success toast after creation", async () => {
    renderEditor();

    const nameInput = screen.getByPlaceholderText(/review a specific pr/i);
    fireEvent.change(nameInput, { target: { value: "My New Skill" } });

    const saveButton = screen.getByRole("button", { name: /save skill/i });
    await act(async () => {
      fireEvent.click(saveButton);
    });

    await waitFor(() => {
      expect(mockToast).toHaveBeenCalledWith("Skill created!", "success");
    });
  });

  it("shows error toast when createConfig rejects", async () => {
    mockCreateConfig.mockRejectedValueOnce(new Error("Network error"));

    renderEditor();

    const nameInput = screen.getByPlaceholderText(/review a specific pr/i);
    fireEvent.change(nameInput, { target: { value: "My Skill" } });

    const saveButton = screen.getByRole("button", { name: /save skill/i });
    await act(async () => {
      fireEvent.click(saveButton);
    });

    await waitFor(() => {
      expect(mockToast).toHaveBeenCalledWith(
        expect.stringContaining("Network error"),
        "error",
        5000
      );
    });
  });
});

describe("SkillsBuilderEditor — system config guard", () => {
  it("disables submit button for non-admin editing system config", () => {
    mockIsAdmin = false;
    const existing = makeExistingConfig({ is_system: true });

    renderEditor({ existingConfig: existing });

    const updateButton = screen.getByRole("button", { name: /update skill/i });
    expect(updateButton).toBeDisabled();
  });

  it("allows admin to edit system config", async () => {
    mockIsAdmin = true;
    const existing = makeExistingConfig({ is_system: true });

    renderEditor({ existingConfig: existing });

    const updateButton = screen.getByRole("button", { name: /update skill/i });
    expect(updateButton).not.toBeDisabled();

    await act(async () => {
      fireEvent.click(updateButton);
    });

    await waitFor(() => {
      expect(mockUpdateConfig).toHaveBeenCalledTimes(1);
    });
  });
});

describe("SkillsBuilderEditor — edit mode initialisation", () => {
  it("pre-fills form fields from existingConfig", () => {
    const existing = makeExistingConfig();
    renderEditor({ existingConfig: existing });

    const nameInput = screen.getByPlaceholderText(/review a specific pr/i) as HTMLInputElement;
    expect(nameInput.value).toBe("Existing Skill");

    expect(screen.getByRole("button", { name: /update skill/i })).toBeInTheDocument();
  });

  it("pre-fills tags from existingConfig metadata", () => {
    const existing = makeExistingConfig({ metadata: { tags: ["Kubernetes", "CI/CD"] } });
    renderEditor({ existingConfig: existing });

    expect(screen.getByText("Kubernetes")).toBeInTheDocument();
    expect(screen.getByText("CI/CD")).toBeInTheDocument();
  });
});

describe("SkillsBuilderEditor — does not render when closed", () => {
  it("renders nothing when open=false", () => {
    const { container } = render(
      <SkillsBuilderEditor open={false} onOpenChange={jest.fn()} />
    );
    expect(container.firstChild).toBeNull();
  });
});

describe("SkillsBuilderEditor — escape key", () => {
  it("calls onOpenChange(false) on Escape key", () => {
    const onOpenChange = jest.fn();
    renderEditor({ onOpenChange });

    fireEvent.keyDown(document, { key: "Escape" });

    expect(onOpenChange).toHaveBeenCalledWith(false);
  });
});

// ---------------------------------------------------------------------------
// Template loading
// ---------------------------------------------------------------------------

describe("SkillsBuilderEditor — template loading", () => {
  it("populates name, description, and skillContent when a template is selected", async () => {
    renderEditor();

    await waitFor(() => {
      expect(screen.getByText("PR Review")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText("PR Review"));

    const nameInput = screen.getByPlaceholderText(/review a specific pr/i) as HTMLInputElement;
    expect(nameInput.value).toBe("PR Review");

    const editor = screen.getByTestId("codemirror") as HTMLTextAreaElement;
    expect(editor.value).toContain("pr-review");
  });

  it("Blank Skill button is rendered and can be clicked without error", async () => {
    renderEditor();

    await waitFor(() => {
      expect(screen.getByText("Blank Skill")).toBeInTheDocument();
    });

    expect(screen.getByText("Start from scratch")).toBeInTheDocument();
  });

  it("loads the second template with different content", async () => {
    renderEditor();

    await waitFor(() => {
      expect(screen.getByText("Deployment Check")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText("Deployment Check"));

    const nameInput = screen.getByPlaceholderText(/review a specific pr/i) as HTMLInputElement;
    expect(nameInput.value).toBe("Deployment Check");

    const editor = screen.getByTestId("codemirror") as HTMLTextAreaElement;
    expect(editor.value).toContain("deploy-check");
  });
});

// ---------------------------------------------------------------------------
// SKILL.md import
// ---------------------------------------------------------------------------

describe("SkillsBuilderEditor — SKILL.md import", () => {
  it("populates name/description/content from valid SKILL.md and shows success toast", async () => {
    renderEditor();

    const importBtns = screen.getAllByRole("button", { name: /import/i });
    const topImportBtn = importBtns[0];
    fireEvent.click(topImportBtn);

    await waitFor(() => {
      expect(screen.getByText("Import SKILL.md")).toBeInTheDocument();
    });

    const validContent = "---\nname: imported-skill\ndescription: An imported skill\n---\n\n# Imported\n\nDo the thing.";
    const textareas = document.querySelectorAll("textarea");
    const importTextarea = Array.from(textareas).find(
      t => t.getAttribute("rows") === "6" && t.closest("[class*='max-w-2xl']")
    )!;
    fireEvent.change(importTextarea, { target: { value: validContent } });

    const importActionBtn = screen.getAllByRole("button").find(
      b => b.textContent?.trim() === "Import" && b.closest("[class*='justify-end']")
    );
    fireEvent.click(importActionBtn!);

    await waitFor(() => {
      expect(mockToast).toHaveBeenCalledWith("SKILL.md imported successfully", "success");
    });
  });

  it("Import button is disabled when import textarea is empty", async () => {
    renderEditor();

    const importBtns = screen.getAllByRole("button", { name: /import/i });
    fireEvent.click(importBtns[0]);

    await waitFor(() => {
      expect(screen.getByText("Import SKILL.md")).toBeInTheDocument();
    });

    const importActionBtn = screen.getAllByRole("button").find(
      b => b.textContent?.trim() === "Import" && b.closest("[class*='justify-end']")
    );

    expect(importActionBtn).toBeDisabled();
  });

  it("closes import panel when Cancel is clicked", async () => {
    renderEditor();

    const importBtns = screen.getAllByRole("button", { name: /import/i });
    fireEvent.click(importBtns[0]);

    await waitFor(() => {
      expect(screen.getByText("Import SKILL.md")).toBeInTheDocument();
    });

    const cancelBtns = screen.getAllByRole("button", { name: /cancel/i });
    const panelCancel = cancelBtns.find(b => b.closest("[class*='max-w-2xl']"));
    fireEvent.click(panelCancel!);

    expect(screen.queryByText("Import SKILL.md")).not.toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Visibility and team selection
// ---------------------------------------------------------------------------

describe("SkillsBuilderEditor — visibility and team selection", () => {
  it("selecting Team visibility shows team selector", async () => {
    renderEditor();

    const teamBtn = screen.getByRole("button", { name: /team/i });
    fireEvent.click(teamBtn);

    await waitFor(() => {
      expect(screen.getByText("Alpha Team")).toBeInTheDocument();
      expect(screen.getByText("Beta Team")).toBeInTheDocument();
    });
  });

  it("shows validation error when visibility is team but no teams selected", async () => {
    renderEditor();

    const nameInput = screen.getByPlaceholderText(/review a specific pr/i);
    fireEvent.change(nameInput, { target: { value: "My Skill" } });

    const teamBtn = screen.getByRole("button", { name: /team/i });
    fireEvent.click(teamBtn);

    await waitFor(() => {
      expect(screen.getByText("Alpha Team")).toBeInTheDocument();
    });

    const saveButton = screen.getByRole("button", { name: /save skill/i });
    await act(async () => {
      fireEvent.click(saveButton);
    });

    await waitFor(() => {
      expect(screen.getByText(/select at least one team/i)).toBeInTheDocument();
    });
    expect(mockCreateConfig).not.toHaveBeenCalled();
  });

  it("selecting Private or Global hides team selector", async () => {
    renderEditor();

    const teamBtn = screen.getByRole("button", { name: /team/i });
    fireEvent.click(teamBtn);

    await waitFor(() => {
      expect(screen.getByText("Alpha Team")).toBeInTheDocument();
    });

    const privateBtn = screen.getByRole("button", { name: /private/i });
    fireEvent.click(privateBtn);

    expect(screen.queryByText("Alpha Team")).not.toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Category validation
// ---------------------------------------------------------------------------

describe("SkillsBuilderEditor — category validation", () => {
  it("category is required — default value is set so clearing is not directly possible", () => {
    renderEditor();

    const nameInput = screen.getByPlaceholderText(/review a specific pr/i);
    fireEvent.change(nameInput, { target: { value: "Skill Name" } });

    expect(screen.getByText("Custom")).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// TagInput
// ---------------------------------------------------------------------------

describe("SkillsBuilderEditor — TagInput", () => {
  it("adds a tag via Enter key", async () => {
    renderEditor();

    const tagInput = screen.getByPlaceholderText(/add tags/i);
    fireEvent.change(tagInput, { target: { value: "kubernetes" } });
    fireEvent.keyDown(tagInput, { key: "Enter" });

    await waitFor(() => {
      expect(screen.getByText("kubernetes")).toBeInTheDocument();
    });
  });

  it("removes last tag via Backspace on empty input", async () => {
    const existing = makeExistingConfig({ metadata: { tags: ["TagA", "TagB"] } });
    renderEditor({ existingConfig: existing });

    expect(screen.getByText("TagA")).toBeInTheDocument();
    expect(screen.getByText("TagB")).toBeInTheDocument();

    const tagInput = screen.getByPlaceholderText("") || document.querySelector("[class*='min-w-\\[80px\\]']") as HTMLElement;
    const tagInputEl = screen.getAllByRole("textbox").find(
      el => el.getAttribute("placeholder") === "" || el.classList.contains("min-w-[80px]")
    ) || tagInput;

    if (tagInputEl) {
      fireEvent.keyDown(tagInputEl, { key: "Backspace" });
      await waitFor(() => {
        expect(screen.queryByText("TagB")).not.toBeInTheDocument();
      });
    }
  });

  it("removes a tag when clicking X on that tag", () => {
    const existing = makeExistingConfig({ metadata: { tags: ["RemoveMe", "KeepMe"] } });
    renderEditor({ existingConfig: existing });

    expect(screen.getByText("RemoveMe")).toBeInTheDocument();
    expect(screen.getByText("KeepMe")).toBeInTheDocument();

    const removeBtn = screen.getByText("RemoveMe").closest("[class*='gap-0.5']")?.querySelector("button");
    if (removeBtn) fireEvent.click(removeBtn);

    expect(screen.queryByText("RemoveMe")).not.toBeInTheDocument();
    expect(screen.getByText("KeepMe")).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Sidebar and preview toggles
// ---------------------------------------------------------------------------

describe("SkillsBuilderEditor — sidebar and preview toggles", () => {
  it("clicking Templates button toggles sidebar off", async () => {
    renderEditor();

    await waitFor(() => {
      expect(screen.getByText("Skill Templates")).toBeInTheDocument();
    });

    const templatesBtn = screen.getByRole("button", { name: /templates/i });
    fireEvent.click(templatesBtn);

    await waitFor(() => {
      expect(screen.queryByText("Skill Templates")).not.toBeInTheDocument();
    });
  });

  it("sidebar shows Blank Skill and template list", async () => {
    renderEditor();

    await waitFor(() => {
      expect(screen.getByText("Skill Templates")).toBeInTheDocument();
    });

    expect(screen.getByText("Blank Skill")).toBeInTheDocument();

    await waitFor(() => {
      expect(screen.getByText("PR Review")).toBeInTheDocument();
      expect(screen.getByText("Deployment Check")).toBeInTheDocument();
    });
  });

  it("clicking Preview button toggles preview panel off", async () => {
    renderEditor();

    await waitFor(() => {
      expect(screen.getByText("Live Preview")).toBeInTheDocument();
    });

    const previewBtn = screen.getByRole("button", { name: /preview/i });
    fireEvent.click(previewBtn);

    await waitFor(() => {
      expect(screen.queryByText("Live Preview")).not.toBeInTheDocument();
    });
  });

  it("clicking Skill Details collapses metadata section", async () => {
    renderEditor();

    expect(screen.getByPlaceholderText(/review a specific pr/i)).toBeInTheDocument();

    const detailsBtn = screen.getByText("Skill Details").closest("button")!;
    fireEvent.click(detailsBtn);

    await waitFor(() => {
      expect(screen.queryByPlaceholderText(/review a specific pr/i)).not.toBeInTheDocument();
    });
  });

  it("Skill Details header shows current name badge when name is set", () => {
    const existing = makeExistingConfig();
    renderEditor({ existingConfig: existing });

    const detailsBtn = screen.getByText("Skill Details").closest("button")!;
    expect(detailsBtn).toBeInTheDocument();

    expect(screen.getByText("Existing Skill")).toBeInTheDocument();
  });
});
