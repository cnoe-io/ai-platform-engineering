/**
 * Tests for the three import surfaces in the Workspace toolbar:
 *   - SkillTemplatesMenu
 *   - ImportSkillMdDialog
 *   - RepoImportPanel (formerly GithubImportPanel — re-exported as a shim)
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
import { RepoImportPanel } from "../RepoImportPanel";
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
// RepoImportPanel (FR-019)
// ---------------------------------------------------------------------------

describe("RepoImportPanel", () => {
  it("disables Import until repo + at least one path are filled", () => {
    render(<RepoImportPanel onImported={() => {}} />);
    const btn = screen.getByRole("button", { name: /^Import$/ });
    expect(btn).toBeDisabled();
    fireEvent.change(screen.getByLabelText(/Repository/i), {
      target: { value: "anthropics/skills" },
    });
    expect(btn).toBeDisabled();
    fireEvent.change(screen.getByLabelText(/Directory path 1/i), {
      target: { value: "skills/foo" },
    });
    expect(btn).toBeEnabled();
  });

  it("POSTs to /api/skills/import with source=github by default", async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (global.fetch as any).mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({
        data: {
          files: { "a.txt": "hi", "b.txt": "ho" },
          count: 2,
          conflicts: [],
        },
      }),
    });
    const onImported = jest.fn();
    render(<RepoImportPanel onImported={onImported} />);
    fireEvent.change(screen.getByLabelText(/Repository/i), {
      target: { value: "anthropics/skills" },
    });
    fireEvent.change(screen.getByLabelText(/Directory path 1/i), {
      target: { value: "skills/foo" },
    });
    fireEvent.click(screen.getByRole("button", { name: /^Import$/ }));
    await waitFor(() => expect(onImported).toHaveBeenCalledTimes(1));
    expect(onImported).toHaveBeenCalledWith({ "a.txt": "hi", "b.txt": "ho" });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const fetchMock = global.fetch as any;
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/skills/import",
      expect.objectContaining({
        method: "POST",
      }),
    );
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body).toEqual({
      source: "github",
      repo: "anthropics/skills",
      paths: ["skills/foo"],
    });
    expect(mockToast).toHaveBeenCalledWith("Imported 2 files", "success");
  });

  it("switches placeholders + body source when GitLab is selected", async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (global.fetch as any).mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({
        data: { files: { "x.py": "" }, count: 1, conflicts: [] },
      }),
    });
    render(<RepoImportPanel onImported={() => {}} />);

    // Pre-toggle placeholder is GitHub
    expect(
      (screen.getByLabelText(/Repository/i) as HTMLInputElement).placeholder,
    ).toBe("anthropics/skills");

    // Toggle to GitLab via the radiogroup
    const gitlabRadio = screen.getByRole("radio", { name: /GitLab/i });
    fireEvent.click(gitlabRadio);

    // Placeholder + label switch
    expect(
      (screen.getByLabelText(/Project/i) as HTMLInputElement).placeholder,
    ).toBe("mycorp/platform");

    fireEvent.change(screen.getByLabelText(/Project/i), {
      target: { value: "mycorp/platform" },
    });
    fireEvent.change(screen.getByLabelText(/Directory path 1/i), {
      target: { value: "skills/example" },
    });
    fireEvent.click(screen.getByRole("button", { name: /^Import$/ }));

    await waitFor(() => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      expect((global.fetch as any).mock.calls).toHaveLength(1);
    });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const body = JSON.parse((global.fetch as any).mock.calls[0][1].body);
    expect(body.source).toBe("gitlab");
    expect(body.repo).toBe("mycorp/platform");
    expect(body.paths).toEqual(["skills/example"]);
  });

  it("appends a path with the '+ Add another path' affordance (capped at 5)", () => {
    render(<RepoImportPanel onImported={() => {}} />);
    expect(screen.getByLabelText(/Directory path 1/i)).toBeInTheDocument();
    expect(screen.queryByLabelText(/Directory path 2/i)).not.toBeInTheDocument();

    // Click + 4 times to reach the cap of 5
    for (let i = 0; i < 4; i++) {
      fireEvent.click(screen.getByRole("button", { name: /Add another path/i }));
    }
    expect(screen.getByLabelText(/Directory path 5/i)).toBeInTheDocument();
    // Button should disappear once cap is reached
    expect(
      screen.queryByRole("button", { name: /Add another path/i }),
    ).not.toBeInTheDocument();
  });

  it("surfaces a conflict toast when first-wins drops a duplicate", async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (global.fetch as any).mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({
        data: {
          files: { "shared.txt": "from a", "onlya.txt": "" },
          count: 2,
          conflicts: [
            { name: "shared.txt", kept_from: "skills/a", dropped_from: "skills/b" },
          ],
        },
      }),
    });
    render(<RepoImportPanel onImported={() => {}} />);
    fireEvent.change(screen.getByLabelText(/Repository/i), {
      target: { value: "owner/repo" },
    });
    fireEvent.change(screen.getByLabelText(/Directory path 1/i), {
      target: { value: "skills/a" },
    });
    fireEvent.click(screen.getByRole("button", { name: /Add another path/i }));
    fireEvent.change(screen.getByLabelText(/Directory path 2/i), {
      target: { value: "skills/b" },
    });
    fireEvent.click(screen.getByRole("button", { name: /^Import$/ }));
    await waitFor(() =>
      expect(mockToast).toHaveBeenCalledWith(
        expect.stringMatching(/Imported 2 files; skipped 1 duplicate/),
        "success",
      ),
    );
  });

  it("toasts on non-OK responses and does NOT call onImported", async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (global.fetch as any).mockResolvedValueOnce({
      ok: false,
      status: 404,
      json: async () => ({ error: "not found" }),
    });
    const onImported = jest.fn();
    render(<RepoImportPanel onImported={onImported} />);
    fireEvent.change(screen.getByLabelText(/Repository/i), {
      target: { value: "owner/repo" },
    });
    fireEvent.change(screen.getByLabelText(/Directory path 1/i), {
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

// ---------------------------------------------------------------------------
// GithubImportPanel re-export shim — keep existing imports working (FR-019)
// ---------------------------------------------------------------------------

describe("GithubImportPanel re-export shim", () => {
  it("is the same component as RepoImportPanel", () => {
    expect(GithubImportPanel).toBe(RepoImportPanel);
  });
});

void React;
