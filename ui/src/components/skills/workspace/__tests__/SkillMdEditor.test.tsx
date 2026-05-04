/**
 * Tests for SkillMdEditor — focuses on the pure pieces that matter for
 * correctness (lint diagnostics + toolbar behaviour). The CodeMirror view
 * itself is not exercised in JSDOM (it requires a real layout engine);
 * we mock `RichCodeEditor` to a plain textarea so the test runs fast and
 * deterministically.
 */

import React from "react";
import { render, screen, fireEvent } from "@testing-library/react";

// `SkillMdPreview` pulls in `react-markdown` / `remark-gfm` which are ESM
// and not in the Jest transform allowlist. Mock them to plain pass-through
// renderers — preview-output assertions still work because we render the
// raw children verbatim.
jest.mock("react-markdown", () => ({
  __esModule: true,
  default: ({ children }: { children?: React.ReactNode }) => (
    <div data-testid="markdown-content">{children}</div>
  ),
}));
jest.mock("remark-gfm", () => ({ __esModule: true, default: () => {} }));

// Mock RichCodeEditor with a plain controlled textarea so we can drive
// onChange and assert lintSource wiring without booting CodeMirror.
jest.mock("@/components/skills/workspace/RichCodeEditor", () => {
  const React = jest.requireActual("react");
  type LintFn = (doc: string) =>
    | Array<{ from: number; to: number; severity: string; message: string }>
    | Promise<unknown>;
  type Props = {
    value: string;
    onChange?: (next: string) => void;
    lintSource?: LintFn;
    readOnly?: boolean;
    wrap?: boolean;
  };
  const RichCodeEditor = (props: Props) => {
    const [diags, setDiags] = React.useState<
      Array<{ from: number; to: number; severity: string; message: string }>
    >([]);
    React.useEffect(() => {
      if (!props.lintSource) {
        setDiags([]);
        return;
      }
      const result = props.lintSource(props.value);
      Promise.resolve(result).then((d) => setDiags(Array.isArray(d) ? d : []));
    }, [props.value, props.lintSource]);
    return (
      <div data-rich-editor>
        <textarea
          aria-label="rich-editor"
          value={props.value}
          readOnly={props.readOnly}
          data-wrap={props.wrap ? "on" : "off"}
          onChange={(e) => props.onChange?.(e.target.value)}
        />
        <ul data-testid="lint-diagnostics">
          {diags.map((d, i) => (
            <li
              key={i}
              data-severity={d.severity}
              data-from={d.from}
              data-to={d.to}
            >
              {d.message}
            </li>
          ))}
        </ul>
      </div>
    );
  };
  return {
    RichCodeEditor,
    cmUndo: jest.fn(),
    cmRedo: jest.fn(),
  };
});

import { SkillMdEditor } from "../SkillMdEditor";

beforeEach(() => {
  jest.clearAllMocks();
});

// ---------------------------------------------------------------------------
// Toolbar rendering
// ---------------------------------------------------------------------------

describe("SkillMdEditor — toolbar", () => {
  it("renders Undo / Redo / Wrap / Download buttons by default", () => {
    render(<SkillMdEditor value="" onChange={() => {}} />);
    expect(screen.getByLabelText("Undo")).toBeInTheDocument();
    expect(screen.getByLabelText("Redo")).toBeInTheDocument();
    expect(screen.getByLabelText("Toggle soft wrap")).toBeInTheDocument();
    expect(screen.getByLabelText("Download SKILL.md")).toBeInTheDocument();
  });

  it("hides the toolbar when hideToolbar is true", () => {
    render(<SkillMdEditor value="" onChange={() => {}} hideToolbar />);
    expect(screen.queryByLabelText("Undo")).not.toBeInTheDocument();
  });

  it("disables Undo/Redo when readOnly", () => {
    render(<SkillMdEditor value="" onChange={() => {}} readOnly />);
    expect(screen.getByLabelText("Undo")).toBeDisabled();
    expect(screen.getByLabelText("Redo")).toBeDisabled();
  });

  it("toggles soft-wrap state on the editor when Wrap is clicked", () => {
    render(<SkillMdEditor value="hello" onChange={() => {}} />);
    const editor = screen.getByLabelText("rich-editor");
    expect(editor).toHaveAttribute("data-wrap", "off");
    fireEvent.click(screen.getByLabelText("Toggle soft wrap"));
    expect(editor).toHaveAttribute("data-wrap", "on");
  });
});

// ---------------------------------------------------------------------------
// Download
// ---------------------------------------------------------------------------

describe("SkillMdEditor — download", () => {
  it("creates a blob URL and triggers an anchor click on Download", () => {
    const createObjectURL = jest.fn(() => "blob:fake");
    const revokeObjectURL = jest.fn();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (URL as any).createObjectURL = createObjectURL;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (URL as any).revokeObjectURL = revokeObjectURL;
    const clickSpy = jest.spyOn(HTMLAnchorElement.prototype, "click");

    render(
      <SkillMdEditor
        value="# Hello"
        onChange={() => {}}
        skillName="My Skill"
      />,
    );
    fireEvent.click(screen.getByLabelText("Download SKILL.md"));
    expect(createObjectURL).toHaveBeenCalledTimes(1);
    expect(clickSpy).toHaveBeenCalledTimes(1);
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:fake");
    clickSpy.mockRestore();
  });
});

// ---------------------------------------------------------------------------
// Lint diagnostics
// ---------------------------------------------------------------------------

describe("SkillMdEditor — frontmatter linting", () => {
  it("flags missing frontmatter as a warning", async () => {
    render(<SkillMdEditor value="just a body" onChange={() => {}} />);
    const items = await screen.findAllByRole("listitem");
    expect(
      items.some(
        (li) =>
          li.getAttribute("data-severity") === "warning" &&
          /should start with a YAML frontmatter/i.test(li.textContent || ""),
      ),
    ).toBe(true);
  });

  it("flags an unterminated frontmatter as an error", async () => {
    render(
      <SkillMdEditor
        value={"---\nname: foo\nstill open"}
        onChange={() => {}}
      />,
    );
    const items = await screen.findAllByRole("listitem");
    expect(
      items.some(
        (li) =>
          li.getAttribute("data-severity") === "error" &&
          /not closed/i.test(li.textContent || ""),
      ),
    ).toBe(true);
  });

  it("flags missing `name:` field in an otherwise-valid frontmatter", async () => {
    render(
      <SkillMdEditor
        value={"---\ndescription: hello\n---\nbody"}
        onChange={() => {}}
      />,
    );
    const items = await screen.findAllByRole("listitem");
    expect(
      items.some(
        (li) =>
          li.getAttribute("data-severity") === "warning" &&
          /missing a `name:` field/i.test(li.textContent || ""),
      ),
    ).toBe(true);
  });

  it("does not flag a well-formed SKILL.md", async () => {
    render(
      <SkillMdEditor
        value={"---\nname: hi\ndescription: ok\n---\nbody"}
        onChange={() => {}}
      />,
    );
    // Wait one tick so the mocked lintSource effect can run, then assert
    // synchronously (queryAll returns [] when nothing matches — findAll
    // would time out).
    await new Promise((r) => setTimeout(r, 0));
    const items = screen.queryAllByRole("listitem");
    expect(
      items.some((li) =>
        /frontmatter|name:/i.test(li.textContent || ""),
      ),
    ).toBe(false);
  });
});

describe("SkillMdEditor — variable linting", () => {
  it("flags `{{undeclared}}` references when declaredVariables is provided", async () => {
    render(
      <SkillMdEditor
        value={"---\nname: x\n---\nHello {{ name }} and {{ unknown }}"}
        onChange={() => {}}
        declaredVariables={[
          {
            name: "name",
            type: "string",
            required: true,
            description: "",
          },
        ]}
      />,
    );
    const items = await screen.findAllByRole("listitem");
    const undecl = items.filter(
      (li) =>
        li.getAttribute("data-severity") === "warning" &&
        /\{\{unknown\}\}/i.test(li.textContent || ""),
    );
    expect(undecl).toHaveLength(1);
  });

  it("does NOT flag variables when declaredVariables is undefined", async () => {
    render(
      <SkillMdEditor
        value={"---\nname: x\n---\nHello {{ unknown }}"}
        onChange={() => {}}
      />,
    );
    await new Promise((r) => setTimeout(r, 0));
    const items = screen.queryAllByRole("listitem");
    expect(
      items.some((li) => /\{\{unknown\}\}/i.test(li.textContent || "")),
    ).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// onChange wiring
// ---------------------------------------------------------------------------

describe("SkillMdEditor — onChange", () => {
  it("propagates editor edits", () => {
    const onChange = jest.fn();
    render(<SkillMdEditor value="abc" onChange={onChange} />);
    fireEvent.change(screen.getByLabelText("rich-editor"), {
      target: { value: "abcd" },
    });
    expect(onChange).toHaveBeenCalledWith("abcd");
  });
});

// ---------------------------------------------------------------------------
// View-mode toggle — Edit / Split / Preview (parity with the previous editor)
// ---------------------------------------------------------------------------

describe("SkillMdEditor — view mode toggle", () => {
  it("renders the Edit/Split/Preview toggle by default", () => {
    render(<SkillMdEditor value="" onChange={() => {}} />);
    expect(screen.getByTestId("skill-md-view-toggle")).toBeInTheDocument();
    expect(screen.getByTestId("skill-md-view-edit")).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(screen.getByTestId("skill-md-view-split")).toHaveAttribute(
      "aria-pressed",
      "false",
    );
    expect(screen.getByTestId("skill-md-view-preview")).toHaveAttribute(
      "aria-pressed",
      "false",
    );
  });

  it("Edit mode: shows the editor only, no preview", () => {
    render(<SkillMdEditor value="# Hi" onChange={() => {}} />);
    expect(screen.getByLabelText("rich-editor")).toBeInTheDocument();
    expect(screen.queryByTestId("skill-md-preview")).not.toBeInTheDocument();
  });

  it("Split mode: renders both editor and preview", () => {
    render(<SkillMdEditor value="# Hi" onChange={() => {}} />);
    fireEvent.click(screen.getByTestId("skill-md-view-split"));
    expect(screen.getByLabelText("rich-editor")).toBeInTheDocument();
    expect(screen.getByTestId("skill-md-preview")).toBeInTheDocument();
  });

  it("Preview mode: hides the editor, disables Undo/Redo/Wrap", () => {
    render(<SkillMdEditor value="# Hi" onChange={() => {}} />);
    fireEvent.click(screen.getByTestId("skill-md-view-preview"));
    expect(screen.queryByLabelText("rich-editor")).not.toBeInTheDocument();
    expect(screen.getByTestId("skill-md-preview")).toBeInTheDocument();
    expect(screen.getByLabelText("Undo")).toBeDisabled();
    expect(screen.getByLabelText("Redo")).toBeDisabled();
    expect(screen.getByLabelText("Toggle soft wrap")).toBeDisabled();
  });

  it("Preview strips frontmatter from the rendered body", () => {
    render(
      <SkillMdEditor
        value={"---\nname: x\ndescription: y\n---\nBODY-TEXT-HERE"}
        onChange={() => {}}
      />,
    );
    fireEvent.click(screen.getByTestId("skill-md-view-preview"));
    // Frontmatter summary card surfaces the YAML block.
    const fm = screen.getByTestId("skill-md-preview-frontmatter");
    expect(fm).toHaveTextContent(/name: x/);
    expect(fm).toHaveTextContent(/description: y/);
    // The mocked react-markdown renders children verbatim — the body
    // should NOT contain the `---` delimiter or the frontmatter keys.
    const md = screen.getByTestId("markdown-content");
    expect(md).toHaveTextContent("BODY-TEXT-HERE");
    expect(md).not.toHaveTextContent(/^---/);
    expect(md.textContent || "").not.toMatch(/name: x/);
  });

  it("Preview: shows an empty-state hint when source is blank", () => {
    render(<SkillMdEditor value="" onChange={() => {}} />);
    fireEvent.click(screen.getByTestId("skill-md-view-preview"));
    expect(
      screen.getByTestId("skill-md-preview"),
    ).toHaveTextContent(/Nothing to preview yet/i);
  });

  it("Preview is allowed even on read-only skills (so users can flip to source)", () => {
    render(<SkillMdEditor value="# Hi" onChange={() => {}} readOnly />);
    fireEvent.click(screen.getByTestId("skill-md-view-preview"));
    expect(screen.getByTestId("skill-md-preview")).toBeInTheDocument();
  });
});

void React;
