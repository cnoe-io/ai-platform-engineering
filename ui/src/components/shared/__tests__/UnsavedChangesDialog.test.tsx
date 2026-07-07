/**
 * Unit tests for UnsavedChangesDialog component
 *
 * Tests:
 * - Returns null when open is false
 * - Renders warning icon, title, and message when open
 * - "Keep editing" button calls onCancel
 * - "Discard changes" button calls onDiscard
 * - Clicking backdrop calls onCancel
 */

import React from "react";
import { render, screen, fireEvent } from "@testing-library/react";

// ============================================================================
// Mocks — must be before imports
// ============================================================================

jest.mock("lucide-react", () => ({
  AlertTriangle: () => <span data-testid="icon-alert-triangle" />,
}));

jest.mock("@/components/ui/button", () => ({
  Button: ({
    children,
    onClick,
    variant,
    ...props
  }: {
    children: React.ReactNode;
    onClick?: () => void;
    variant?: string;
    [key: string]: unknown;
  }) => (
    <button onClick={onClick} data-variant={variant} {...props}>
      {children}
    </button>
  ),
}));

// ============================================================================
// Imports — after mocks
// ============================================================================

import { UnsavedChangesDialog } from "../UnsavedChangesDialog";

// ============================================================================
// Tests
// ============================================================================

describe("UnsavedChangesDialog", () => {
  it("returns null when open is false", () => {
    const { container } = render(
      <UnsavedChangesDialog
        open={false}
        onDiscard={jest.fn()}
        onCancel={jest.fn()}
      />
    );
    expect(container.firstChild).toBeNull();
  });

  it("renders warning icon, title, and message when open", () => {
    render(
      <UnsavedChangesDialog
        open={true}
        onDiscard={jest.fn()}
        onCancel={jest.fn()}
      />
    );
    expect(screen.getByTestId("icon-alert-triangle")).toBeInTheDocument();
    expect(screen.getByText("Unsaved changes")).toBeInTheDocument();
    expect(
      screen.getByText(/You have unsaved changes in the Task Builder/)
    ).toBeInTheDocument();
  });

  it("Keep editing button calls onCancel", () => {
    const onCancel = jest.fn();
    render(
      <UnsavedChangesDialog
        open={true}
        onDiscard={jest.fn()}
        onCancel={onCancel}
      />
    );
    fireEvent.click(screen.getByText("Keep editing"));
    expect(onCancel).toHaveBeenCalled();
  });

  it("Discard changes button calls onDiscard", () => {
    const onDiscard = jest.fn();
    render(
      <UnsavedChangesDialog
        open={true}
        onDiscard={onDiscard}
        onCancel={jest.fn()}
      />
    );
    fireEvent.click(screen.getByText("Discard changes"));
    expect(onDiscard).toHaveBeenCalled();
  });

  it("clicking backdrop calls onCancel", () => {
    const onCancel = jest.fn();
    const { container } = render(
      <UnsavedChangesDialog
        open={true}
        onDiscard={jest.fn()}
        onCancel={onCancel}
      />
    );
    const backdrop = container.querySelector(".absolute.inset-0");
    expect(backdrop).toBeInTheDocument();
    fireEvent.click(backdrop!);
    expect(onCancel).toHaveBeenCalled();
  });
});
