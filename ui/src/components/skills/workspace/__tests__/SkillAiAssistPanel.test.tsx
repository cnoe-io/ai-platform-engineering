/**
 * Tests for SkillAiAssistPanel — focuses on the UI shell + interactions.
 * The underlying `useSkillAiAssist` is mocked so we never hit `fetch`.
 */

import React from "react";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

const mockGenerate = jest.fn().mockResolvedValue(undefined);
const mockEnhance = jest.fn().mockResolvedValue(undefined);
const mockCancel = jest.fn();
const mockResetDebug = jest.fn();

let mockState: {
  status: "idle" | "generating" | "enhancing";
  isBusy: boolean;
  error: Error | null;
  cancelled: boolean;
  debugLog: string[];
  promptSent: string;
};

function resetMockState() {
  mockState = {
    status: "idle",
    isBusy: false,
    error: null,
    cancelled: false,
    debugLog: [],
    promptSent: "",
  };
}
resetMockState();

jest.mock("@/components/skills/workspace/use-skill-ai-assist", () => ({
  ENHANCE_PRESETS: [
    { label: "Rewrite", instruction: "Rewrite the SKILL.md" },
    { label: "Make Concise", instruction: "Be concise" },
    { label: "Add Examples", instruction: "Add examples" },
  ],
  useSkillAiAssist: () => ({
    ...mockState,
    generate: (...a: unknown[]) => mockGenerate(...a),
    enhance: (...a: unknown[]) => mockEnhance(...a),
    cancel: () => mockCancel(),
    resetDebug: () => mockResetDebug(),
  }),
}));

const mockToast = jest.fn();
jest.mock("@/components/ui/toast", () => ({
  useToast: () => ({ toast: mockToast }),
}));

import { SkillAiAssistPanel } from "../SkillAiAssistPanel";

beforeEach(() => {
  resetMockState();
  mockGenerate.mockClear();
  mockEnhance.mockClear();
  mockCancel.mockClear();
  mockToast.mockClear();
});

// ---------------------------------------------------------------------------
// Mode toggle
// ---------------------------------------------------------------------------

describe("SkillAiAssistPanel — mode toggle", () => {
  it("starts in Generate mode by default", () => {
    render(
      <SkillAiAssistPanel
        getCurrentContent={() => ""}
        onApply={() => {}}
      />,
    );
    expect(screen.getByLabelText(/Describe the skill you want/i)).toBeInTheDocument();
    expect(screen.queryByText(/Quick presets/i)).not.toBeInTheDocument();
  });

  it("switches to Enhance and back", () => {
    render(
      <SkillAiAssistPanel
        getCurrentContent={() => "current body"}
        onApply={() => {}}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /Enhance/i }));
    expect(screen.getByText(/Quick presets/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /^Generate$/i }));
    expect(screen.getByLabelText(/Describe the skill you want/i)).toBeInTheDocument();
  });

  it("respects defaultMode prop", () => {
    render(
      <SkillAiAssistPanel
        getCurrentContent={() => "x"}
        onApply={() => {}}
        defaultMode="enhance"
      />,
    );
    expect(screen.getByText(/Quick presets/i)).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Generate flow
// ---------------------------------------------------------------------------

describe("SkillAiAssistPanel — generate", () => {
  it("disables Generate when input is empty and enables on text", () => {
    render(<SkillAiAssistPanel getCurrentContent={() => ""} onApply={() => {}} />);
    const buttons = screen.getAllByRole("button");
    // Two "Generate" buttons exist — the mode toggle (no svg) and the
    // action button (with the Wand svg). Pick the action one.
    const run = buttons.find(
      (b) => b.textContent === "Generate" && b.querySelector("svg") !== null,
    );
    expect(run).toBeDisabled();
    fireEvent.change(screen.getByLabelText(/Describe the skill/i), {
      target: { value: "Build a triage skill" },
    });
    expect(run).toBeEnabled();
  });

  it("calls ai.generate with the typed input", () => {
    render(<SkillAiAssistPanel getCurrentContent={() => ""} onApply={() => {}} />);
    fireEvent.change(screen.getByLabelText(/Describe the skill/i), {
      target: { value: "do a thing" },
    });
    const buttons = screen.getAllByRole("button");
    const run = buttons.find(
      (b) => b.textContent === "Generate" && b.querySelector("svg") !== null,
    )!;
    fireEvent.click(run);
    expect(mockGenerate).toHaveBeenCalledWith("do a thing");
  });
});

// ---------------------------------------------------------------------------
// Enhance flow
// ---------------------------------------------------------------------------

describe("SkillAiAssistPanel — enhance", () => {
  it("disables Run until at least one preset OR custom text is provided", () => {
    render(
      <SkillAiAssistPanel
        getCurrentContent={() => "existing"}
        onApply={() => {}}
        defaultMode="enhance"
      />,
    );
    const buttons = screen.getAllByRole("button");
    const run = buttons.find(
      (b) => b.textContent === "Enhance" && b.querySelector("svg") !== null,
    )!;
    expect(run).toBeDisabled();

    fireEvent.click(screen.getByLabelText(/Rewrite/i));
    expect(run).toBeEnabled();
  });

  it("passes selected preset labels and custom text to enhance()", () => {
    render(
      <SkillAiAssistPanel
        getCurrentContent={() => "existing"}
        onApply={() => {}}
        defaultMode="enhance"
      />,
    );
    fireEvent.click(screen.getByLabelText(/Rewrite/i));
    fireEvent.click(screen.getByLabelText(/Add Examples/i));
    fireEvent.change(screen.getByLabelText(/Custom instructions/i), {
      target: { value: "and short" },
    });
    const buttons = screen.getAllByRole("button");
    const run = buttons.find(
      (b) => b.textContent === "Enhance" && b.querySelector("svg") !== null,
    )!;
    fireEvent.click(run);
    expect(mockEnhance).toHaveBeenCalledWith({
      presetLabels: expect.arrayContaining(["Rewrite", "Add Examples"]),
      customInstruction: "and short",
    });
  });
});

// ---------------------------------------------------------------------------
// Busy state
// ---------------------------------------------------------------------------

describe("SkillAiAssistPanel — busy state", () => {
  it("shows Stop button and disables inputs while busy", () => {
    mockState.status = "generating";
    mockState.isBusy = true;
    render(<SkillAiAssistPanel getCurrentContent={() => ""} onApply={() => {}} />);
    expect(screen.getByRole("button", { name: /Stop/i })).toBeInTheDocument();
    expect(screen.getByLabelText(/Describe the skill/i)).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: /Stop/i }));
    expect(mockCancel).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------------
// Toast surfacing
// ---------------------------------------------------------------------------

describe("SkillAiAssistPanel — error/cancel surfacing", () => {
  it("toasts the error message when ai.error is set", async () => {
    mockState.error = new Error("upstream failed");
    render(
      <SkillAiAssistPanel getCurrentContent={() => ""} onApply={() => {}} />,
    );
    await waitFor(() => {
      expect(mockToast).toHaveBeenCalledWith("upstream failed", "error", 5000);
    });
  });

  it("toasts cancellation", async () => {
    mockState.cancelled = true;
    render(
      <SkillAiAssistPanel getCurrentContent={() => ""} onApply={() => {}} />,
    );
    await waitFor(() => {
      expect(mockToast).toHaveBeenCalledWith(
        "AI operation cancelled",
        "info",
      );
    });
  });
});

void React;
