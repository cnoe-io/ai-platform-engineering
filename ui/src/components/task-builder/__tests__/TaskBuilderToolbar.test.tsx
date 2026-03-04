/**
 * Unit tests for TaskBuilderToolbar component
 *
 * Tests:
 * - Renders all buttons (Back, Add Step, Import, Preview, Download, Save/Update)
 * - Name input updates on change
 * - Category dropdown updates on change
 * - Description input updates on change
 * - Save is disabled when name is empty
 * - Save is disabled when stepCount is 0
 * - Preview is disabled when stepCount is 0
 * - Save button shows "Update" when isEditing is true
 * - Shows step count text
 * - Shows env var count badge when envVarCount > 0
 * - All button clicks fire correct callbacks
 */

import React from "react";
import { render, screen, fireEvent } from "@testing-library/react";

// ============================================================================
// Mocks — must be before imports
// ============================================================================

jest.mock("lucide-react", () => ({
  ArrowLeft: () => <span data-testid="icon-arrow-left" />,
  Save: () => <span data-testid="icon-save" />,
  Plus: () => <span data-testid="icon-plus" />,
  Download: () => <span data-testid="icon-download" />,
  Upload: () => <span data-testid="icon-upload" />,
  Variable: () => <span data-testid="icon-variable" />,
  Eye: () => <span data-testid="icon-eye" />,
}));

jest.mock("@/components/ui/button", () => ({
  Button: ({
    children,
    onClick,
    disabled,
    ...props
  }: {
    children: React.ReactNode;
    onClick?: () => void;
    disabled?: boolean;
    [key: string]: unknown;
  }) => (
    <button onClick={onClick} disabled={disabled} {...props}>
      {children}
    </button>
  ),
}));

jest.mock("@/components/ui/input", () => ({
  Input: ({
    value,
    onChange,
    placeholder,
    ...props
  }: {
    value: string;
    onChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
    placeholder?: string;
    [key: string]: unknown;
  }) => (
    <input
      value={value}
      onChange={onChange}
      placeholder={placeholder}
      data-testid={placeholder?.includes("name") ? "input-name" : placeholder?.includes("Description") ? "input-description" : "input"}
      {...props}
    />
  ),
}));

jest.mock("@/lib/utils", () => ({
  cn: (...args: unknown[]) => args.filter(Boolean).join(" "),
}));

// ============================================================================
// Imports — after mocks
// ============================================================================

import { TaskBuilderToolbar } from "../TaskBuilderToolbar";

// ============================================================================
// Helpers
// ============================================================================

function renderToolbar(overrides: Record<string, unknown> = {}) {
  const defaults = {
    name: "My Workflow",
    category: "GitHub Operations",
    description: "Test description",
    onNameChange: jest.fn(),
    onCategoryChange: jest.fn(),
    onDescriptionChange: jest.fn(),
    onAddStep: jest.fn(),
    onSave: jest.fn(),
    onExportYaml: jest.fn(),
    onPreview: jest.fn(),
    onImport: jest.fn(),
    onBack: jest.fn(),
    isSaving: false,
    isEditing: false,
    stepCount: 2,
    envVarCount: 0,
  };
  return render(
    <TaskBuilderToolbar {...{ ...defaults, ...overrides }} />
  );
}

// ============================================================================
// Tests
// ============================================================================

describe("TaskBuilderToolbar", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("renders all buttons", () => {
    renderToolbar();
    expect(screen.getByText("Back")).toBeInTheDocument();
    expect(screen.getByText("Add Step")).toBeInTheDocument();
    expect(screen.getByText("Import")).toBeInTheDocument();
    expect(screen.getByText("Preview")).toBeInTheDocument();
    expect(screen.getByText("Download")).toBeInTheDocument();
    expect(screen.getByText("Save")).toBeInTheDocument();
  });

  it("name input updates on change", () => {
    const onNameChange = jest.fn();
    renderToolbar({ onNameChange });
    const nameInput = screen.getByPlaceholderText("Workflow name...");
    fireEvent.change(nameInput, { target: { value: "New Name" } });
    expect(onNameChange).toHaveBeenCalledWith("New Name");
  });

  it("category dropdown updates on change", () => {
    const onCategoryChange = jest.fn();
    renderToolbar({ onCategoryChange });
    const select = screen.getByDisplayValue("GitHub Operations");
    fireEvent.change(select, { target: { value: "AWS Operations" } });
    expect(onCategoryChange).toHaveBeenCalledWith("AWS Operations");
  });

  it("description input updates on change", () => {
    const onDescriptionChange = jest.fn();
    renderToolbar({ onDescriptionChange });
    const descInput = screen.getByPlaceholderText("Description (optional)");
    fireEvent.change(descInput, { target: { value: "New desc" } });
    expect(onDescriptionChange).toHaveBeenCalledWith("New desc");
  });

  it("save is disabled when name is empty", () => {
    renderToolbar({ name: "" });
    const saveBtn = screen.getByRole("button", { name: /Save|Update/ });
    expect(saveBtn).toBeDisabled();
  });

  it("save is disabled when stepCount is 0", () => {
    renderToolbar({ name: "Workflow", stepCount: 0 });
    const saveBtn = screen.getByRole("button", { name: /Save|Update/ });
    expect(saveBtn).toBeDisabled();
  });

  it("preview is disabled when stepCount is 0", () => {
    renderToolbar({ stepCount: 0 });
    const previewBtn = screen.getByText("Preview").closest("button");
    expect(previewBtn).toBeDisabled();
  });

  it("save button shows Update when isEditing is true", () => {
    renderToolbar({ isEditing: true });
    expect(screen.getByText("Update")).toBeInTheDocument();
  });

  it("shows step count text", () => {
    renderToolbar({ stepCount: 3 });
    expect(screen.getByText("3 steps")).toBeInTheDocument();
  });

  it("shows step (singular) when stepCount is 1", () => {
    renderToolbar({ stepCount: 1 });
    expect(screen.getByText("1 step")).toBeInTheDocument();
  });

  it("shows env var count badge when envVarCount > 0", () => {
    renderToolbar({ envVarCount: 2 });
    expect(screen.getByText("2 vars")).toBeInTheDocument();
  });

  it("does not show env var badge when envVarCount is 0", () => {
    renderToolbar({ envVarCount: 0 });
    expect(screen.queryByText(/var/)).not.toBeInTheDocument();
  });

  it("Back button calls onBack", () => {
    const onBack = jest.fn();
    renderToolbar({ onBack });
    fireEvent.click(screen.getByText("Back"));
    expect(onBack).toHaveBeenCalled();
  });

  it("Add Step button calls onAddStep", () => {
    const onAddStep = jest.fn();
    renderToolbar({ onAddStep });
    fireEvent.click(screen.getByText("Add Step"));
    expect(onAddStep).toHaveBeenCalled();
  });

  it("Import button calls onImport", () => {
    const onImport = jest.fn();
    renderToolbar({ onImport });
    fireEvent.click(screen.getByText("Import"));
    expect(onImport).toHaveBeenCalled();
  });

  it("Preview button calls onPreview", () => {
    const onPreview = jest.fn();
    renderToolbar({ onPreview, stepCount: 1 });
    fireEvent.click(screen.getByText("Preview"));
    expect(onPreview).toHaveBeenCalled();
  });

  it("Download button calls onExportYaml", () => {
    const onExportYaml = jest.fn();
    renderToolbar({ onExportYaml });
    fireEvent.click(screen.getByText("Download"));
    expect(onExportYaml).toHaveBeenCalled();
  });

  it("Save button calls onSave when enabled", () => {
    const onSave = jest.fn();
    renderToolbar({ onSave, name: "Workflow", stepCount: 1 });
    fireEvent.click(screen.getByText("Save"));
    expect(onSave).toHaveBeenCalled();
  });
});
