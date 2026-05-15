/**
 * Tests for ImportConflictDialog — the duplicate-resolution modal
 * shared by all bulk-import flows (zip, repo, future marketplace).
 *
 * We focus on:
 *   - Default action is "skip" so a misclick on Apply doesn't
 *     destroy data
 *   - Per-row radios mutate just that row, not the whole batch
 *   - "Apply to all" sets every row at once
 *   - Switching to Rename auto-suggests a unique name
 *   - Rename validation: empty name AND match-existing-name both
 *     block Apply
 *   - Cancel triggers `onCancel`, Apply emits the finalised list
 *   - Re-opening the dialog re-seeds local state from new props
 */

import React from "react";
import {
  render,
  screen,
  within,
  cleanup,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { ImportConflictDialog } from "@/components/skills/ImportConflictDialog";
import type { ImportConflictDecision } from "@/lib/skill-import-helpers";

const baseConflict = (
  over: Partial<ImportConflictDecision> = {},
): ImportConflictDecision => ({
  candidateId: "cand-1",
  candidateName: "Foo",
  existingName: "Foo",
  existingId: "skill-foo-abc",
  action: "skip",
  ...over,
});

afterEach(() => {
  cleanup();
});

describe("ImportConflictDialog — defaults & layout", () => {
  it("seeds every row with action='skip' so Apply is non-destructive by default", async () => {
    const user = userEvent.setup();
    const onResolve = jest.fn();
    const onCancel = jest.fn();
    render(
      <ImportConflictDialog
        open
        conflicts={[
          baseConflict({ candidateId: "a", candidateName: "Foo" }),
          baseConflict({ candidateId: "b", candidateName: "Bar" }),
        ]}
        existingNames={["Foo", "Bar"]}
        onResolve={onResolve}
        onCancel={onCancel}
      />,
    );
    // Both rows start on "skip".
    expect(
      screen.getByTestId("import-conflict-a-skip"),
    ).toBeChecked();
    expect(
      screen.getByTestId("import-conflict-b-skip"),
    ).toBeChecked();
    await user.click(screen.getByTestId("import-conflicts-apply"));
    expect(onResolve).toHaveBeenCalledTimes(1);
    const out = onResolve.mock.calls[0][0] as ImportConflictDecision[];
    expect(out.map((d) => d.action)).toEqual(["skip", "skip"]);
    expect(onCancel).not.toHaveBeenCalled();
  });

  it("renders the existing skill id as monospace breadcrumb", () => {
    render(
      <ImportConflictDialog
        open
        conflicts={[baseConflict({ existingId: "skill-foo-abc" })]}
        onResolve={jest.fn()}
        onCancel={jest.fn()}
      />,
    );
    expect(screen.getByText(/skill-foo-abc/)).toBeInTheDocument();
  });
});

describe("ImportConflictDialog — per-row mutation", () => {
  it("toggling overwrite on one row leaves the other rows alone", async () => {
    const user = userEvent.setup();
    render(
      <ImportConflictDialog
        open
        conflicts={[
          baseConflict({ candidateId: "a" }),
          baseConflict({ candidateId: "b" }),
        ]}
        onResolve={jest.fn()}
        onCancel={jest.fn()}
      />,
    );
    await user.click(screen.getByTestId("import-conflict-a-overwrite"));
    expect(
      screen.getByTestId("import-conflict-a-overwrite"),
    ).toBeChecked();
    expect(
      screen.getByTestId("import-conflict-b-skip"),
    ).toBeChecked();
    // Overwrite warning is rendered inline. We just check the
    // distinctive trailing fragment that lives in a single text
    // node — testing-library's default `getByText` traverses leaf
    // text nodes, so this avoids the "matched multiple ancestors"
    // failure mode of a function matcher.
    // The word "SKILL.md" lives in its own JSX text fragment so a
    // simple substring match against that token finds the warning
    // body without colliding with ancestor elements.
    expect(
      screen.getByText(/SKILL\.md and ancillary files/i, {
        normalizer: (s) => s.replace(/\s+/g, " ").trim(),
      }),
    ).toBeInTheDocument();
  });

  it("switching to Rename auto-fills a unique suggestion", async () => {
    const user = userEvent.setup();
    render(
      <ImportConflictDialog
        open
        conflicts={[baseConflict({ candidateName: "Foo" })]}
        existingNames={["Foo"]}
        onResolve={jest.fn()}
        onCancel={jest.fn()}
      />,
    );
    await user.click(screen.getByTestId("import-conflict-cand-1-rename"));
    const input = screen.getByTestId(
      "import-conflict-cand-1-rename-input",
    ) as HTMLInputElement;
    expect(input.value).toBe("Foo (imported)");
  });

  it("re-suggests with (imported 2) when (imported) is also taken", async () => {
    const user = userEvent.setup();
    render(
      <ImportConflictDialog
        open
        conflicts={[baseConflict({ candidateName: "Foo" })]}
        existingNames={["Foo", "Foo (imported)"]}
        onResolve={jest.fn()}
        onCancel={jest.fn()}
      />,
    );
    await user.click(screen.getByTestId("import-conflict-cand-1-rename"));
    const input = screen.getByTestId(
      "import-conflict-cand-1-rename-input",
    ) as HTMLInputElement;
    expect(input.value).toBe("Foo (imported 2)");
  });

  it("two same-named candidates each get a unique seed (no collision)", () => {
    render(
      <ImportConflictDialog
        open
        conflicts={[
          baseConflict({
            candidateId: "a",
            candidateName: "Foo",
            action: "rename",
          }),
          baseConflict({
            candidateId: "b",
            candidateName: "Foo",
            action: "rename",
          }),
        ]}
        existingNames={["Foo"]}
        onResolve={jest.fn()}
        onCancel={jest.fn()}
      />,
    );
    const a = screen.getByTestId(
      "import-conflict-a-rename-input",
    ) as HTMLInputElement;
    const b = screen.getByTestId(
      "import-conflict-b-rename-input",
    ) as HTMLInputElement;
    expect(a.value).toBe("Foo (imported)");
    expect(b.value).toBe("Foo (imported 2)");
  });
});

describe("ImportConflictDialog — bulk apply", () => {
  it("'Apply to all: Overwrite' switches every row at once", async () => {
    const user = userEvent.setup();
    render(
      <ImportConflictDialog
        open
        conflicts={[
          baseConflict({ candidateId: "a" }),
          baseConflict({ candidateId: "b" }),
          baseConflict({ candidateId: "c" }),
        ]}
        onResolve={jest.fn()}
        onCancel={jest.fn()}
      />,
    );
    await user.click(
      screen.getByTestId("import-conflicts-apply-all-overwrite"),
    );
    expect(
      screen.getByTestId("import-conflict-a-overwrite"),
    ).toBeChecked();
    expect(
      screen.getByTestId("import-conflict-b-overwrite"),
    ).toBeChecked();
    expect(
      screen.getByTestId("import-conflict-c-overwrite"),
    ).toBeChecked();
  });

  it("summary counter reflects the chosen actions", async () => {
    const user = userEvent.setup();
    render(
      <ImportConflictDialog
        open
        conflicts={[
          baseConflict({ candidateId: "a" }),
          baseConflict({ candidateId: "b" }),
        ]}
        onResolve={jest.fn()}
        onCancel={jest.fn()}
      />,
    );
    expect(
      screen.getByTestId("import-conflicts-summary"),
    ).toHaveTextContent("2 skip · 0 overwrite · 0 rename");
    await user.click(screen.getByTestId("import-conflict-a-overwrite"));
    expect(
      screen.getByTestId("import-conflicts-summary"),
    ).toHaveTextContent("1 skip · 1 overwrite · 0 rename");
  });
});

describe("ImportConflictDialog — Apply validation", () => {
  it("blocks Apply when a Rename row has an empty name", async () => {
    const user = userEvent.setup();
    const onResolve = jest.fn();
    render(
      <ImportConflictDialog
        open
        conflicts={[baseConflict({ action: "rename", renameTo: "" })]}
        existingNames={["Foo"]}
        onResolve={onResolve}
        onCancel={jest.fn()}
      />,
    );
    // The seeder fills in a suggestion when action is rename;
    // simulate the user clearing it before clicking Apply.
    const input = screen.getByTestId(
      "import-conflict-cand-1-rename-input",
    ) as HTMLInputElement;
    await user.clear(input);
    await user.click(screen.getByTestId("import-conflicts-apply"));
    expect(onResolve).not.toHaveBeenCalled();
    expect(
      screen.getByText(/A new name is required/i),
    ).toBeInTheDocument();
  });

  it("blocks Apply when a Rename target matches the existing name", async () => {
    const user = userEvent.setup();
    const onResolve = jest.fn();
    render(
      <ImportConflictDialog
        open
        conflicts={[
          baseConflict({
            action: "rename",
            renameTo: "Foo", // same as existingName
          }),
        ]}
        existingNames={["Foo"]}
        onResolve={onResolve}
        onCancel={jest.fn()}
      />,
    );
    await user.click(screen.getByTestId("import-conflicts-apply"));
    expect(onResolve).not.toHaveBeenCalled();
    expect(
      screen.getByText(/matches the existing skill/i),
    ).toBeInTheDocument();
  });

  it("clears the validation error as soon as the user types", async () => {
    const user = userEvent.setup();
    const onResolve = jest.fn();
    render(
      <ImportConflictDialog
        open
        conflicts={[baseConflict({ action: "rename", renameTo: "" })]}
        existingNames={["Foo"]}
        onResolve={onResolve}
        onCancel={jest.fn()}
      />,
    );
    const input = screen.getByTestId(
      "import-conflict-cand-1-rename-input",
    ) as HTMLInputElement;
    await user.clear(input);
    await user.click(screen.getByTestId("import-conflicts-apply"));
    expect(
      screen.getByText(/A new name is required/i),
    ).toBeInTheDocument();
    await user.type(input, "Foo Imported");
    expect(
      screen.queryByText(/A new name is required/i),
    ).not.toBeInTheDocument();
  });

  it("trims whitespace on rename targets before emitting", async () => {
    const user = userEvent.setup();
    const onResolve = jest.fn();
    render(
      <ImportConflictDialog
        open
        conflicts={[baseConflict({ action: "rename", renameTo: "" })]}
        existingNames={["Foo"]}
        onResolve={onResolve}
        onCancel={jest.fn()}
      />,
    );
    const input = screen.getByTestId(
      "import-conflict-cand-1-rename-input",
    ) as HTMLInputElement;
    await user.clear(input);
    await user.type(input, "  Padded  ");
    await user.click(screen.getByTestId("import-conflicts-apply"));
    expect(onResolve).toHaveBeenCalledTimes(1);
    expect(onResolve.mock.calls[0][0][0].renameTo).toBe("Padded");
  });
});

describe("ImportConflictDialog — Cancel", () => {
  it("Cancel button calls onCancel and not onResolve", async () => {
    const user = userEvent.setup();
    const onResolve = jest.fn();
    const onCancel = jest.fn();
    render(
      <ImportConflictDialog
        open
        conflicts={[baseConflict()]}
        onResolve={onResolve}
        onCancel={onCancel}
      />,
    );
    await user.click(screen.getByTestId("import-conflicts-cancel"));
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onResolve).not.toHaveBeenCalled();
  });
});

describe("ImportConflictDialog — re-seeding on open", () => {
  it("re-seeds local state when `open` flips false → true with new conflicts", () => {
    const onResolve = jest.fn();
    const onCancel = jest.fn();
    const { rerender } = render(
      <ImportConflictDialog
        open={false}
        conflicts={[baseConflict({ candidateId: "a" })]}
        onResolve={onResolve}
        onCancel={onCancel}
      />,
    );
    // Re-render with a fresh conflict set; nothing visible yet.
    rerender(
      <ImportConflictDialog
        open
        conflicts={[
          baseConflict({ candidateId: "x", candidateName: "Bar" }),
          baseConflict({ candidateId: "y", candidateName: "Baz" }),
        ]}
        onResolve={onResolve}
        onCancel={onCancel}
      />,
    );
    // The list now reflects the new conflicts, not the old one.
    expect(
      screen.queryByTestId("import-conflict-a-skip"),
    ).not.toBeInTheDocument();
    expect(
      screen.getByTestId("import-conflict-x-skip"),
    ).toBeChecked();
    expect(
      screen.getByTestId("import-conflict-y-skip"),
    ).toBeChecked();
  });
});

describe("ImportConflictDialog — accessibility", () => {
  it("each row's radios share a name attribute (exclusive selection)", () => {
    render(
      <ImportConflictDialog
        open
        conflicts={[baseConflict({ candidateId: "a" })]}
        onResolve={jest.fn()}
        onCancel={jest.fn()}
      />,
    );
    const skip = screen.getByTestId("import-conflict-a-skip");
    const overwrite = screen.getByTestId("import-conflict-a-overwrite");
    const rename = screen.getByTestId("import-conflict-a-rename");
    expect(skip.getAttribute("name")).toBe(overwrite.getAttribute("name"));
    expect(skip.getAttribute("name")).toBe(rename.getAttribute("name"));
  });

  it("rename input is marked aria-invalid when validation fails", async () => {
    const user = userEvent.setup();
    render(
      <ImportConflictDialog
        open
        conflicts={[baseConflict({ action: "rename", renameTo: "" })]}
        existingNames={["Foo"]}
        onResolve={jest.fn()}
        onCancel={jest.fn()}
      />,
    );
    const input = screen.getByTestId(
      "import-conflict-cand-1-rename-input",
    );
    await user.clear(input);
    await user.click(screen.getByTestId("import-conflicts-apply"));
    expect(input).toHaveAttribute("aria-invalid", "true");
    // Voiceover announces the message via aria-describedby.
    const errorId = input.getAttribute("aria-describedby");
    expect(errorId).toBeTruthy();
    expect(
      within(document.body).getByText(/A new name is required/i).id,
    ).toBe(errorId);
  });
});
