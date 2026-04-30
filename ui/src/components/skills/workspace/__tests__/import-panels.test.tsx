/**
 * Tests for the three import surfaces in the Workspace toolbar:
 *   - SkillTemplatesMenu
 *   - ImportSkillMdDialog
 *   - GithubImportPanel
 */

import React from "react";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

const mockToast = jest.fn();
jest.mock("@/components/ui/toast", () => ({
  useToast: () => ({ toast: mockToast }),
}));

const mockFetchTemplates = jest.fn();
jest.mock("@/skills", () => ({
  fetchSkillTemplates: () => mockFetchTemplates(),
  getAllTemplateTags: () => [],
}));

import { SkillTemplatesMenu } from "../SkillTemplatesMenu";
import { ImportSkillMdDialog } from "../ImportSkillMdDialog";
import { GithubImportPanel } from "../GithubImportPanel";

beforeEach(() => {
  mockToast.mockClear();
  mockFetchTemplates.mockReset();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (global as any).fetch = jest.fn();
});

// ---------------------------------------------------------------------------
// SkillTemplatesMenu
// ---------------------------------------------------------------------------

describe("SkillTemplatesMenu", () => {
  const tpls = [
    {
      id: "tpl-a",
      name: "Triage Issues",
      description: "Triage GitHub issues",
      content: "---\nname: triage\n---\n",
      tags: ["github", "triage"],
    },
    {
      id: "tpl-b",
      name: "Postmortem",
      description: "Write a postmortem",
      content: "---\nname: postmortem\n---\n",
      tags: ["incident"],
    },
  ];

  it("lazy-loads templates on first open", async () => {
    mockFetchTemplates.mockResolvedValue(tpls);
    render(<SkillTemplatesMenu onSelect={() => {}} />);
    expect(mockFetchTemplates).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: /Templates/i }));
    await waitFor(() => expect(mockFetchTemplates).toHaveBeenCalledTimes(1));
    await screen.findByText("Triage Issues");
    await screen.findByText("Postmortem");
  });

  it("filters by name/description/tag", async () => {
    mockFetchTemplates.mockResolvedValue(tpls);
    render(<SkillTemplatesMenu onSelect={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: /Templates/i }));
    await screen.findByText("Triage Issues");
    fireEvent.change(screen.getByPlaceholderText(/Search templates/i), {
      target: { value: "incident" },
    });
    expect(screen.queryByText("Triage Issues")).not.toBeInTheDocument();
    expect(screen.getByText("Postmortem")).toBeInTheDocument();
  });

  it("fires onSelect with the chosen template and closes", async () => {
    mockFetchTemplates.mockResolvedValue(tpls);
    const onSelect = jest.fn();
    render(<SkillTemplatesMenu onSelect={onSelect} />);
    fireEvent.click(screen.getByRole("button", { name: /Templates/i }));
    const item = await screen.findByText("Triage Issues");
    fireEvent.click(item);
    expect(onSelect).toHaveBeenCalledWith(tpls[0]);
    // Menu should now be closed
    expect(screen.queryByText("Postmortem")).not.toBeInTheDocument();
  });

  it("renders empty state when API returns nothing", async () => {
    mockFetchTemplates.mockResolvedValue([]);
    render(<SkillTemplatesMenu onSelect={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: /Templates/i }));
    await screen.findByText(/No templates available/i);
  });
});

// ---------------------------------------------------------------------------
// ImportSkillMdDialog
// ---------------------------------------------------------------------------

describe("ImportSkillMdDialog", () => {
  it("disables Import until content is non-empty", () => {
    render(
      <ImportSkillMdDialog open onOpenChange={() => {}} onImport={() => {}} />,
    );
    expect(screen.getByRole("button", { name: /^Import$/ })).toBeDisabled();
    fireEvent.change(screen.getByRole("textbox"), {
      target: { value: "hello" },
    });
    expect(screen.getByRole("button", { name: /^Import$/ })).toBeEnabled();
  });

  it("fires onImport with trimmed content and closes", () => {
    const onImport = jest.fn();
    const onOpenChange = jest.fn();
    render(
      <ImportSkillMdDialog
        open
        onOpenChange={onOpenChange}
        onImport={onImport}
      />,
    );
    fireEvent.change(screen.getByRole("textbox"), {
      target: { value: "  ---\nname: x\n---\nbody  " },
    });
    fireEvent.click(screen.getByRole("button", { name: /^Import$/ }));
    expect(onImport).toHaveBeenCalledWith("---\nname: x\n---\nbody");
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("Cancel closes without firing onImport", () => {
    const onImport = jest.fn();
    const onOpenChange = jest.fn();
    render(
      <ImportSkillMdDialog
        open
        onOpenChange={onOpenChange}
        onImport={onImport}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /Cancel/ }));
    expect(onImport).not.toHaveBeenCalled();
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });
});

// ---------------------------------------------------------------------------
// GithubImportPanel
// ---------------------------------------------------------------------------

describe("GithubImportPanel", () => {
  it("disables Import until repo + path are filled", () => {
    render(<GithubImportPanel onImported={() => {}} />);
    const btn = screen.getByRole("button", { name: /^Import$/ });
    expect(btn).toBeDisabled();
    fireEvent.change(screen.getByLabelText(/Repository/i), {
      target: { value: "owner/repo" },
    });
    expect(btn).toBeDisabled();
    fireEvent.change(screen.getByLabelText(/Directory path/i), {
      target: { value: "skills/foo" },
    });
    expect(btn).toBeEnabled();
  });

  it("calls /api/skills/import-github and forwards files via onImported", async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (global.fetch as any).mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({
        data: { files: { "SKILL.md": "---\nname: x\n---\n", "a.txt": "hi" } },
      }),
    });
    const onImported = jest.fn();
    render(<GithubImportPanel onImported={onImported} />);
    fireEvent.change(screen.getByLabelText(/Repository/i), {
      target: { value: "owner/repo" },
    });
    fireEvent.change(screen.getByLabelText(/Directory path/i), {
      target: { value: "skills/foo" },
    });
    fireEvent.click(screen.getByRole("button", { name: /^Import$/ }));
    await waitFor(() => expect(onImported).toHaveBeenCalledTimes(1));
    expect(onImported).toHaveBeenCalledWith({
      "SKILL.md": "---\nname: x\n---\n",
      "a.txt": "hi",
    });
    expect(mockToast).toHaveBeenCalledWith(
      "Imported 2 files",
      "success",
    );
    // fields cleared on success
    expect(screen.getByLabelText(/Repository/i)).toHaveValue("");
  });

  it("toasts on non-OK responses and does NOT call onImported", async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (global.fetch as any).mockResolvedValueOnce({
      ok: false,
      status: 404,
      json: async () => ({ error: "not found" }),
    });
    const onImported = jest.fn();
    render(<GithubImportPanel onImported={onImported} />);
    fireEvent.change(screen.getByLabelText(/Repository/i), {
      target: { value: "owner/repo" },
    });
    fireEvent.change(screen.getByLabelText(/Directory path/i), {
      target: { value: "skills/foo" },
    });
    fireEvent.click(screen.getByRole("button", { name: /^Import$/ }));
    await waitFor(() =>
      expect(mockToast).toHaveBeenCalledWith(
        expect.stringContaining("not found"),
        "error",
        5000,
      ),
    );
    expect(onImported).not.toHaveBeenCalled();
  });
});

void React;
