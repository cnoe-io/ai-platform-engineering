/**
 * Tests for SkillFileTree.
 */

import React from "react";
import { render, screen, fireEvent } from "@testing-library/react";

import { SkillFileTree } from "../SkillFileTree";

beforeEach(() => {
  // suppress JSDOM confirm prompt
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (window as any).confirm = jest.fn(() => true);
});

const baseProps = {
  ancillaryFiles: { "a.json": "{}", "tools.py": "print()" } as Record<string, string>,
  selected: "SKILL.md",
  onSelect: jest.fn(),
  onAddFile: jest.fn(),
  onDeleteFile: jest.fn(),
};

beforeEach(() => {
  baseProps.onSelect = jest.fn();
  baseProps.onAddFile = jest.fn();
  baseProps.onDeleteFile = jest.fn();
});

describe("SkillFileTree", () => {
  it("always renders SKILL.md pinned at the top", () => {
    render(<SkillFileTree {...baseProps} />);
    const items = screen.getAllByRole("treeitem");
    expect(items[0]).toHaveTextContent("SKILL.md");
  });

  it("renders ancillary files alphabetically", () => {
    render(<SkillFileTree {...baseProps} />);
    const items = screen.getAllByRole("treeitem");
    expect(items.map((i) => i.textContent)).toEqual(
      expect.arrayContaining([
        expect.stringContaining("SKILL.md"),
        expect.stringContaining("a.json"),
        expect.stringContaining("tools.py"),
      ]),
    );
  });

  it("calls onSelect when a row is clicked", () => {
    render(<SkillFileTree {...baseProps} />);
    fireEvent.click(screen.getByText("a.json"));
    expect(baseProps.onSelect).toHaveBeenCalledWith("a.json");
  });

  it("calls onDeleteFile (after confirm) for ancillary rows only", () => {
    render(<SkillFileTree {...baseProps} />);
    // SKILL.md row should NOT have a delete button.
    const skillRow = screen
      .getAllByRole("treeitem")
      .find((el) => el.textContent?.includes("SKILL.md"))!;
    expect(skillRow.querySelector('[aria-label^="Delete"]')).toBeNull();

    // a.json row should have one.
    fireEvent.click(screen.getByLabelText("Delete a.json"));
    expect(window.confirm).toHaveBeenCalledWith("Remove a.json?");
    expect(baseProps.onDeleteFile).toHaveBeenCalledWith("a.json");
  });

  it("does not delete when confirm returns false", () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (window as any).confirm = jest.fn(() => false);
    render(<SkillFileTree {...baseProps} />);
    fireEvent.click(screen.getByLabelText("Delete a.json"));
    expect(baseProps.onDeleteFile).not.toHaveBeenCalled();
  });

  it("hides the New file affordance in readOnly mode", () => {
    render(<SkillFileTree {...baseProps} readOnly />);
    expect(screen.queryByLabelText("New file")).toBeNull();
    expect(
      screen.queryByLabelText("Delete a.json"),
    ).not.toBeInTheDocument();
  });

  it("clicking + opens an inline name input that submits on Enter", () => {
    render(<SkillFileTree {...baseProps} />);
    fireEvent.click(screen.getByLabelText("New file"));
    const input = screen.getByLabelText("New file path");
    fireEvent.change(input, { target: { value: "new.txt" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(baseProps.onAddFile).toHaveBeenCalledWith("new.txt");
  });

  it("Escape cancels the inline input without adding", () => {
    render(<SkillFileTree {...baseProps} />);
    fireEvent.click(screen.getByLabelText("New file"));
    const input = screen.getByLabelText("New file path");
    fireEvent.change(input, { target: { value: "ignored.txt" } });
    fireEvent.keyDown(input, { key: "Escape" });
    expect(baseProps.onAddFile).not.toHaveBeenCalled();
  });

  it("colliding filename selects existing entry instead of creating", () => {
    render(<SkillFileTree {...baseProps} />);
    fireEvent.click(screen.getByLabelText("New file"));
    const input = screen.getByLabelText("New file path");
    fireEvent.change(input, { target: { value: "a.json" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(baseProps.onAddFile).not.toHaveBeenCalled();
    expect(baseProps.onSelect).toHaveBeenCalledWith("a.json");
  });

  it("preserves nested paths when submitting (e.g. examples/onboard.md)", () => {
    render(<SkillFileTree {...baseProps} />);
    fireEvent.click(screen.getByLabelText("New file"));
    const input = screen.getByLabelText("New file path");
    fireEvent.change(input, { target: { value: "examples/onboard.md" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(baseProps.onAddFile).toHaveBeenCalledWith("examples/onboard.md");
  });
});
