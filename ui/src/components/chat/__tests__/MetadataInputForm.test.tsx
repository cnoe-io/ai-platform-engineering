/**
 * Unit tests for MetadataInputForm component
 *
 * Tests:
 * - Renders dropdown by default for fields with field_values
 * - "Allow multiple" toggle shows checkboxes and stores comma-separated value
 * - field_type "multiselect" starts in multiselect (checkbox) mode
 * - Submit sends correct formData (single value / comma-separated)
 * - Toggling back to dropdown collapses to first value
 * - Browser draft cache restores and clears in the expected scope
 */

import React from "react";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { MetadataInputForm, parseUserInputRequest, type InputField } from "../MetadataInputForm";

jest.mock("framer-motion", () => ({
  motion: {
    // eslint-disable-next-line react/display-name
    div: React.forwardRef(
      ({ children, ...props }: { children?: React.ReactNode } & Record<string, unknown>, ref: React.Ref<HTMLDivElement>) => (
        <div ref={ref} {...props}>{children}</div>
      )
    ),
    p: ({ children, ...props }: { children?: React.ReactNode } & Record<string, unknown>) => <p {...props}>{children}</p>,
  },
}));

jest.mock("lucide-react", () => ({
  Send: () => <span data-testid="icon-send" />,
  AlertCircle: () => <span data-testid="icon-alert" />,
  ChevronDown: () => <span data-testid="icon-chevron" />,
}));

jest.mock("@/components/ui/button", () => ({
  // eslint-disable-next-line react/display-name
  Button: React.forwardRef(
    (
      { children, onClick, type, disabled, ...props }: { children?: React.ReactNode; onClick?: () => void; type?: string; disabled?: boolean } & Record<string, unknown>,
      ref: React.Ref<HTMLButtonElement>
    ) => (
      <button ref={ref} type={type as "button" | "submit"} onClick={onClick} disabled={disabled} {...props}>
        {children}
      </button>
    )
  ),
}));

const defaultFields: InputField[] = [
  {
    field_name: "provider",
    field_label: "Provider",
    field_values: ["OpenAI", "Anthropic", "Azure"],
    required: true,
  },
  {
    field_name: "model",
    field_label: "Model",
    field_values: ["gpt-4", "claude-3"],
    field_type: "multiselect",
  },
];

describe("MetadataInputForm", () => {
  const onSubmit = jest.fn().mockResolvedValue(undefined);

  beforeEach(() => {
    jest.clearAllMocks();
    window.localStorage.clear();
  });

  it("renders dropdown by default for select fields", () => {
    render(
      <MetadataInputForm
        messageId="msg-1"
        inputFields={defaultFields}
        onSubmit={onSubmit}
      />
    );
    const comboboxes = screen.getAllByRole("combobox");
    expect(comboboxes.length).toBe(1);
    expect(screen.getByText("Select an option...")).toBeInTheDocument();
  });

  it("shows Allow multiple checkbox for fields with options", () => {
    render(
      <MetadataInputForm
        messageId="msg-1"
        inputFields={defaultFields}
        onSubmit={onSubmit}
      />
    );
    expect(screen.getAllByText("Allow multiple").length).toBeGreaterThanOrEqual(1);
  });

  it("starts in multiselect (checkbox) mode when field_type is multiselect", () => {
    render(
      <MetadataInputForm
        messageId="msg-1"
        inputFields={defaultFields}
        onSubmit={onSubmit}
      />
    );
    const modelCheckboxes = screen.getAllByRole("checkbox", { name: /gpt-4|claude-3/i });
    expect(modelCheckboxes.length).toBe(2);
  });

  it("toggling Allow multiple shows checkboxes and submits comma-separated value", async () => {
    render(
      <MetadataInputForm
        messageId="msg-1"
        inputFields={defaultFields}
        onSubmit={onSubmit}
      />
    );
    const allowMultipleLabels = screen.getAllByText("Allow multiple");
    const providerAllowMultiple = allowMultipleLabels[0];
    fireEvent.click(providerAllowMultiple);
    const openaiCheck = screen.getByRole("checkbox", { name: /OpenAI/i });
    const anthropicCheck = screen.getByRole("checkbox", { name: /Anthropic/i });
    fireEvent.click(openaiCheck);
    fireEvent.click(anthropicCheck);
    fireEvent.click(screen.getByRole("checkbox", { name: /gpt-4/i }));
    fireEvent.click(screen.getByRole("button", { name: /submit/i }));
    await waitFor(() => {
      expect(onSubmit).toHaveBeenCalledWith(
        expect.objectContaining({
          provider: expect.stringMatching(/OpenAI.*Anthropic|Anthropic.*OpenAI/),
        })
      );
    });
  });

  it("submit with dropdown selection sends single value", async () => {
    render(
      <MetadataInputForm
        messageId="msg-1"
        conversationId="conv-1"
        inputFields={defaultFields}
        onSubmit={onSubmit}
      />
    );
    const select = screen.getAllByRole("combobox")[0];
    fireEvent.change(select, { target: { value: "Anthropic" } });
    fireEvent.click(screen.getByRole("checkbox", { name: /gpt-4/i }));
    fireEvent.click(screen.getByRole("button", { name: /submit/i }));
    await waitFor(() => {
      expect(onSubmit).toHaveBeenCalledWith(
        expect.objectContaining({
          provider: "Anthropic",
        })
      );
    });
  });

  it("restores cached values when the same form remounts", async () => {
    const { unmount } = render(
      <MetadataInputForm
        messageId="msg-1"
        conversationId="conv-1"
        inputFields={defaultFields}
        onSubmit={onSubmit}
      />
    );

    fireEvent.change(screen.getAllByRole("combobox")[0], { target: { value: "Anthropic" } });
    await waitFor(() => {
      expect(window.localStorage.length).toBeGreaterThan(0);
    });

    unmount();

    render(
      <MetadataInputForm
        messageId="msg-1"
        conversationId="conv-1"
        inputFields={defaultFields}
        onSubmit={onSubmit}
      />
    );

    await waitFor(() => {
      expect(screen.getAllByRole("combobox")[0]).toHaveValue("Anthropic");
    });
  });

  it("keeps cached values isolated by conversation", async () => {
    const { unmount } = render(
      <MetadataInputForm
        messageId="msg-1"
        conversationId="conv-1"
        inputFields={defaultFields}
        onSubmit={onSubmit}
      />
    );

    fireEvent.change(screen.getAllByRole("combobox")[0], { target: { value: "Azure" } });
    await waitFor(() => {
      expect(window.localStorage.length).toBeGreaterThan(0);
    });

    unmount();

    render(
      <MetadataInputForm
        messageId="msg-1"
        conversationId="conv-2"
        inputFields={defaultFields}
        onSubmit={onSubmit}
      />
    );

    await waitFor(() => {
      expect(screen.getAllByRole("combobox")[0]).toHaveValue("");
    });
  });

  it("restores cached multiselect mode and checked values", async () => {
    const fields: InputField[] = [
      {
        field_name: "region",
        field_label: "Region",
        field_values: ["us-east", "eu-west"],
        required: false,
      },
    ];

    const { unmount } = render(
      <MetadataInputForm
        messageId="msg-1"
        conversationId="conv-1"
        inputFields={fields}
        onSubmit={onSubmit}
      />
    );

    fireEvent.click(screen.getByText("Allow multiple"));
    fireEvent.click(screen.getByRole("checkbox", { name: /us-east/i }));
    await waitFor(() => {
      expect(window.localStorage.length).toBeGreaterThan(0);
    });

    unmount();

    render(
      <MetadataInputForm
        messageId="msg-1"
        conversationId="conv-1"
        inputFields={fields}
        onSubmit={onSubmit}
      />
    );

    await waitFor(() => {
      expect(screen.getByRole("checkbox", { name: /us-east/i })).toBeChecked();
    });
  });

  it("clears the cached draft after successful submit", async () => {
    const { unmount } = render(
      <MetadataInputForm
        messageId="msg-1"
        conversationId="conv-1"
        inputFields={defaultFields}
        onSubmit={onSubmit}
      />
    );

    fireEvent.change(screen.getAllByRole("combobox")[0], { target: { value: "OpenAI" } });
    fireEvent.click(screen.getByRole("checkbox", { name: /gpt-4/i }));
    fireEvent.click(screen.getByRole("button", { name: /submit/i }));

    await waitFor(() => {
      expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ provider: "OpenAI" }));
      expect(window.localStorage.length).toBe(0);
    });

    unmount();

    render(
      <MetadataInputForm
        messageId="msg-1"
        conversationId="conv-1"
        inputFields={defaultFields}
        onSubmit={onSubmit}
      />
    );

    await waitFor(() => {
      expect(screen.getAllByRole("combobox")[0]).toHaveValue("");
    });
  });

  it("parseUserInputRequest returns null when no input_fields pattern", () => {
    expect(parseUserInputRequest("plain text")).toBeNull();
  });

  it("parseUserInputRequest parses JSON with input_fields", () => {
    const content = '{"user_input": true, "input_fields": [{"field_name": "x", "field_values": ["a","b"]}]}';
    const result = parseUserInputRequest(content);
    expect(result).not.toBeNull();
    expect(result?.input_fields).toHaveLength(1);
    expect(result?.input_fields?.[0].field_name).toBe("x");
  });
});
