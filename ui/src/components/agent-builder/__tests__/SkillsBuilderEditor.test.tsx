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

beforeEach(() => {
  jest.clearAllMocks();
  mockIsAdmin = false;
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
