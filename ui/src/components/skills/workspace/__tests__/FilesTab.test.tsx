/**
 * Tests for FilesTab — focuses on the multi-file behaviours added in
 * Stage 3 (file tree selection, drag-drop ingest, upload button, SKILL.md
 * replace confirmation, ancillary helpers). Editor surfaces are mocked.
 */

import React from "react";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

const mockToast = jest.fn();
jest.mock("@/components/ui/toast", () => ({
  useToast: () => ({ toast: mockToast }),
}));

// AiAssistButton calls useSession() + getConfig("ssoEnabled") at render time
// for its bearer-token wiring. The FilesTab tests don't exercise the AI
// flow, so we hand it benign stubs so the component mounts.
jest.mock("next-auth/react", () => ({
  useSession: () => ({ data: null, status: "unauthenticated" }),
}));
jest.mock("@/lib/config", () => ({
  getConfig: (key: string) => (key === "ssoEnabled" ? false : undefined),
}));

// Mock the heavy editor components — we just need them to render something
// and forward their `value`/`onChange` so we can introspect what file is
// active.
jest.mock("@/components/skills/workspace/SkillMdEditor", () => ({
  SkillMdEditor: (p: { value: string; onChange?: (v: string) => void }) => (
    <textarea
      data-testid="md-editor"
      value={p.value}
      onChange={(e) => p.onChange?.(e.target.value)}
    />
  ),
}));
jest.mock("@/components/skills/workspace/RichCodeEditor", () => ({
  RichCodeEditor: (p: {
    value: string;
    filename?: string;
    onChange?: (v: string) => void;
  }) => (
    <textarea
      data-testid="rich-editor"
      data-filename={p.filename}
      value={p.value}
      onChange={(e) => p.onChange?.(e.target.value)}
    />
  ),
  cmUndo: jest.fn(),
  cmRedo: jest.fn(),
}));

// Toolbar children — neutralise to keep the test surface small.
jest.mock("@/components/skills/workspace/SkillTemplatesMenu", () => ({
  SkillTemplatesMenu: () => <button>Templates</button>,
}));
jest.mock("@/components/skills/workspace/ImportSkillMdDialog", () => ({
  ImportSkillMdDialog: () => null,
}));
jest.mock("@/components/skills/workspace/GithubImportPanel", () => ({
  GithubImportPanel: () => <div data-testid="gh-panel" />,
}));
jest.mock("@/components/skills/workspace/SkillAiAssistPanel", () => ({
  SkillAiAssistPanel: () => <div data-testid="ai-panel" />,
}));

import { FilesTab } from "../tabs/FilesTab";
import type { UseSkillFormResult } from "../use-skill-form";

function makeForm(
  initial?: Partial<{
    skillContent: string;
    ancillaryFiles: Record<string, string>;
    ancillaryOverLimit: boolean;
  }>,
): UseSkillFormResult & {
  __skillContent: { current: string };
  __ancillary: { current: Record<string, string> };
} {
  const skillContent = { current: initial?.skillContent ?? "---\nname: x\n---\n" };
  const ancillary = { current: { ...(initial?.ancillaryFiles ?? {}) } };

  const setSkillContent = jest.fn((v: string | ((p: string) => string)) => {
    skillContent.current = typeof v === "function" ? (v as (p: string) => string)(skillContent.current) : v;
  });
  const setSkillContentAndSyncTools = jest.fn((v: string) => {
    skillContent.current = v;
  });
  const setAncillaryFiles = jest.fn(
    (
      v:
        | Record<string, string>
        | ((p: Record<string, string>) => Record<string, string>),
    ) => {
      ancillary.current =
        typeof v === "function" ? (v as (p: Record<string, string>) => Record<string, string>)(ancillary.current) : v;
    },
  );
  const setFormData = jest.fn();

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const form: any = {
    isEditMode: false,
    formData: { name: "", description: "", category: "", difficulty: "intermediate", thumbnail: "" },
    setFormData,
    tags: [],
    setTags: jest.fn(),
    visibility: "private",
    setVisibility: jest.fn(),
    selectedTeamIds: [],
    setSelectedTeamIds: jest.fn(),
    inputVariables: [],
    setInputVariables: jest.fn(),
    allowedTools: [],
    setAllowedTools: jest.fn(),
    get skillContent() {
      return skillContent.current;
    },
    setSkillContent,
    setSkillContentAndSyncTools,
    get ancillaryFiles() {
      return ancillary.current;
    },
    setAncillaryFiles,
    ancillaryTotalBytes: 0,
    ancillaryOverLimit: initial?.ancillaryOverLimit ?? false,
    errors: {},
    setErrors: jest.fn(),
    isSubmitting: false,
    submitStatus: "idle",
    validateForm: jest.fn(() => true),
    handleSubmit: jest.fn(),
    isDirty: false,
    saved: false,
    showDiscardConfirm: false,
    guardedClose: jest.fn(),
    confirmDiscard: jest.fn(),
    cancelDiscard: jest.fn(),
    resetForConfig: jest.fn(),
    toolSyncRef: { current: false },
    __skillContent: skillContent,
    __ancillary: ancillary,
  };
  return form;
}

beforeEach(() => {
  mockToast.mockClear();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (window as any).confirm = jest.fn(() => true);
  // JSDOM doesn't ship File.prototype.text(); polyfill via the FileReader
  // path so our component code (which uses `file.text()`) works.
  if (typeof File !== "undefined" && typeof File.prototype.text !== "function") {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (File.prototype as any).text = function () {
      return new Promise<string>((resolve, reject) => {
        const fr = new FileReader();
        fr.onload = () => resolve(String(fr.result || ""));
        fr.onerror = () => reject(fr.error);
        fr.readAsText(this);
      });
    };
  }
});

// ---------------------------------------------------------------------------

describe("FilesTab — file selection", () => {
  it("starts on SKILL.md and renders SkillMdEditor", () => {
    const form = makeForm();
    render(<FilesTab form={form} />);
    expect(screen.getByTestId("md-editor")).toBeInTheDocument();
    expect(screen.queryByTestId("rich-editor")).toBeNull();
  });

  it("clicking an ancillary file switches to RichCodeEditor with the right filename", () => {
    const form = makeForm({
      ancillaryFiles: { "tools.py": "print('hi')" },
    });
    render(<FilesTab form={form} />);
    fireEvent.click(screen.getByText("tools.py"));
    const rich = screen.getByTestId("rich-editor");
    expect(rich).toHaveAttribute("data-filename", "tools.py");
    expect(rich).toHaveValue("print('hi')");
  });
});

// ---------------------------------------------------------------------------

describe("FilesTab — file ingestion", () => {
  function makeFile(name: string, content: string): File {
    return new File([content], name, { type: "text/plain" });
  }

  it("upload button drops files into form.ancillaryFiles", async () => {
    const form = makeForm();
    render(<FilesTab form={form} />);
    const input = screen.getByTestId("files-tab-upload-input") as HTMLInputElement;
    Object.defineProperty(input, "files", {
      value: [makeFile("a.json", '{"x":1}'), makeFile("README.md", "hi")],
    });
    fireEvent.change(input);
    await waitFor(() => {
      expect(Object.keys(form.ancillaryFiles)).toEqual(
        expect.arrayContaining(["a.json", "README.md"]),
      );
    });
    expect(form.ancillaryFiles["a.json"]).toBe('{"x":1}');
    expect(mockToast).toHaveBeenCalledWith(
      expect.stringContaining("Imported 2"),
      "success",
    );
  });

  it("uploading SKILL.md replaces the form's SKILL.md (with confirm)", async () => {
    const form = makeForm({ skillContent: "old body" });
    render(<FilesTab form={form} />);
    const input = screen.getByTestId("files-tab-upload-input") as HTMLInputElement;
    Object.defineProperty(input, "files", {
      value: [makeFile("SKILL.md", "---\nname: new\n---\n")],
    });
    fireEvent.change(input);
    await waitFor(() => {
      expect(form.skillContent).toContain("name: new");
    });
    expect(window.confirm).toHaveBeenCalledWith(
      expect.stringMatching(/Replace the current SKILL\.md/i),
    );
  });

  it("rejects oversized files and reports them", async () => {
    const form = makeForm();
    render(<FilesTab form={form} />);
    const input = screen.getByTestId("files-tab-upload-input") as HTMLInputElement;
    const huge = makeFile("huge.txt", "x");
    // Mock size to exceed limit
    Object.defineProperty(huge, "size", { value: 2 * 1024 * 1024 });
    Object.defineProperty(input, "files", { value: [huge] });
    fireEvent.change(input);
    await waitFor(() => {
      expect(mockToast).toHaveBeenCalledWith(
        expect.stringContaining("Skipped"),
        "warning",
        6000,
      );
    });
    expect(form.ancillaryFiles).not.toHaveProperty("huge.txt");
  });

  it("rejects binary files (non-text extensions)", async () => {
    const form = makeForm();
    render(<FilesTab form={form} />);
    const input = screen.getByTestId("files-tab-upload-input") as HTMLInputElement;
    Object.defineProperty(input, "files", {
      value: [makeFile("logo.png", "binary-bytes")],
    });
    fireEvent.change(input);
    await waitFor(() => {
      expect(mockToast).toHaveBeenCalledWith(
        expect.stringContaining("logo.png (binary)"),
        "warning",
        6000,
      );
    });
    expect(form.ancillaryFiles).not.toHaveProperty("logo.png");
  });
});

// ---------------------------------------------------------------------------

describe("FilesTab — read-only", () => {
  it("hides toolbar actions and editor is read-only", () => {
    const form = makeForm();
    render(<FilesTab form={form} readOnly />);
    expect(screen.queryByText("Templates")).toBeNull();
    expect(screen.queryByText(/Import \.md/i)).toBeNull();
    expect(screen.queryByText(/^GitHub$/)).toBeNull();
    expect(screen.queryByText(/AI Assist/i)).toBeNull();
  });
});

// ---------------------------------------------------------------------------

describe("FilesTab — over-limit warning", () => {
  it("renders the size warning when ancillaryOverLimit is true", () => {
    const form = makeForm({ ancillaryOverLimit: true });
    render(<FilesTab form={form} />);
    expect(
      screen.getByText(/exceed the 1 MiB limit/i),
    ).toBeInTheDocument();
  });
});
