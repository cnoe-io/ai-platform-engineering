import { fireEvent, render, screen, within } from "@testing-library/react";

import { AgentPicker } from "@/components/ui/agent-picker";

describe("AgentPicker", () => {
  it("searches by label and selects the matching agent", () => {
    const onChange = jest.fn();
    render(
      <AgentPicker
        ariaLabel="Example agent"
        options={[
          { value: "agent-primary", label: "Primary Agent" },
          { value: "agent-secondary", label: "Secondary Agent" },
        ]}
        value=""
        onChange={onChange}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Example agent" }));
    fireEvent.change(screen.getByRole("textbox", { name: "Search agents..." }), {
      target: { value: "secondary" },
    });

    const listbox = screen.getByRole("listbox", { name: "Example agent" });
    expect(within(listbox).getAllByRole("option")).toHaveLength(1);
    fireEvent.click(within(listbox).getByRole("option", { name: /Secondary Agent/ }));
    expect(onChange).toHaveBeenCalledWith("agent-secondary");
  });

  it("can require a selection by hiding the clear action", () => {
    render(
      <AgentPicker
        ariaLabel="Required agent"
        options={[{ value: "agent-primary", label: "Primary Agent" }]}
        value="agent-primary"
        onChange={jest.fn()}
        allowClear={false}
      />,
    );

    expect(screen.queryByRole("button", { name: "Clear agent selection" })).not.toBeInTheDocument();
  });
});
