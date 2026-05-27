// assisted-by Cursor Claude:claude-opus-4-7

import * as React from "react";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { TeamPicker, TeamMultiPicker } from "../team-picker";

const TEAMS = [
  { slug: "platform", name: "Platform" },
  { slug: "sre", name: "SRE" },
  { slug: "ops", name: "Operations" },
  { slug: "aws-009-admin", name: "AWS-009 Admin", _id: "mongo-aws-009" },
];

describe("TeamPicker (single)", () => {
  it("renders the placeholder when no value is selected and reveals the list only when opened", () => {
    const onChange = jest.fn();
    render(<TeamPicker options={TEAMS} value="" onChange={onChange} />);

    expect(screen.getByText("Select team...")).toBeInTheDocument();
    // List is hidden until the trigger is clicked — confirms we are
    // NOT rendering the full 600+ team list straight into the form.
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /Select team/ }));
    expect(screen.getByRole("listbox")).toBeInTheDocument();
    expect(screen.getByRole("option", { name: /Platform/ })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: /SRE/ })).toBeInTheDocument();
  });

  it("filters by typed name or slug substring", () => {
    render(<TeamPicker options={TEAMS} value="" onChange={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: /Select team/ }));

    const input = screen.getByPlaceholderText("Search teams...");
    fireEvent.change(input, { target: { value: "aws" } });

    expect(screen.getByRole("option", { name: /AWS-009 Admin/ })).toBeInTheDocument();
    expect(screen.queryByRole("option", { name: /^Platform/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("option", { name: /^SRE/ })).not.toBeInTheDocument();
  });

  it("emits the slug when an option is picked and closes the popover", () => {
    const onChange = jest.fn();
    render(<TeamPicker options={TEAMS} value="" onChange={onChange} />);
    fireEvent.click(screen.getByRole("button", { name: /Select team/ }));
    fireEvent.click(screen.getByRole("option", { name: /SRE/ }));

    expect(onChange).toHaveBeenCalledWith("sre");
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
  });

  it("renders the current selection on the trigger using the team name and slug code", () => {
    render(<TeamPicker options={TEAMS} value="platform" onChange={() => {}} />);
    expect(screen.getByText("Platform")).toBeInTheDocument();
    expect(screen.getByText("team:platform")).toBeInTheDocument();
  });

  it("matches a legacy Mongo _id value back to the canonical slug option", () => {
    // Existing data in the field is the team Mongo _id; the picker
    // must still render the correct option as selected so the form
    // round-trips without surprising the admin.
    render(<TeamPicker options={TEAMS} value="mongo-aws-009" onChange={() => {}} />);
    expect(screen.getByText("AWS-009 Admin")).toBeInTheDocument();
    expect(screen.getByText("team:aws-009-admin")).toBeInTheDocument();
  });

  it("clears the selection when the X button on the trigger is clicked", () => {
    const onChange = jest.fn();
    render(<TeamPicker options={TEAMS} value="sre" onChange={onChange} />);
    fireEvent.click(screen.getByRole("button", { name: /Clear team selection/ }));
    expect(onChange).toHaveBeenCalledWith("");
  });
});

describe("TeamMultiPicker", () => {
  it("renders only selected teams on the trigger, not the full list", () => {
    render(
      <TeamMultiPicker
        options={TEAMS}
        selected={["sre"]}
        onChange={() => {}}
        placeholder="Share with teams..."
      />,
    );
    // Selected chip is visible…
    expect(screen.getByText("SRE")).toBeInTheDocument();
    // …but the un-selected teams are NOT painted into the trigger.
    expect(screen.queryByText("Platform")).not.toBeInTheDocument();
    expect(screen.queryByText("Operations")).not.toBeInTheDocument();
  });

  it("collapses overflow into a +N more badge above the chip cap", () => {
    render(
      <TeamMultiPicker
        options={TEAMS}
        selected={["sre", "ops", "platform"]}
        onChange={() => {}}
        triggerChipCap={2}
      />,
    );
    expect(screen.getByText("SRE")).toBeInTheDocument();
    expect(screen.getByText("Operations")).toBeInTheDocument();
    expect(screen.getByText("+1 more")).toBeInTheDocument();
  });

  it("groups selected entries above 'Available' in the open popover", () => {
    render(
      <TeamMultiPicker
        options={TEAMS}
        selected={["sre"]}
        onChange={() => {}}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /Share with teams/i }));

    const listbox = screen.getByRole("listbox");
    expect(within(listbox).getByText("Selected")).toBeInTheDocument();
    expect(within(listbox).getByText("Available")).toBeInTheDocument();

    // The first option under "Selected" is the picked one. We compare
    // option ordering by querying all options.
    const options = within(listbox).getAllByRole("option");
    expect(options[0]).toHaveAccessibleName(/SRE/);
    expect(options[0]).toHaveAttribute("aria-selected", "true");
  });

  it("toggles a selection on click and emits the next array", () => {
    const onChange = jest.fn();
    render(
      <TeamMultiPicker
        options={TEAMS}
        selected={["sre"]}
        onChange={onChange}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /Share with teams/i }));

    // Click an UN-selected team (Platform) — should be appended.
    fireEvent.click(screen.getByRole("option", { name: /Platform/ }));
    expect(onChange).toHaveBeenCalledWith(["sre", "platform"]);

    onChange.mockClear();

    // Click the already-selected team (SRE) — should be removed.
    fireEvent.click(screen.getByRole("option", { name: /SRE/ }));
    expect(onChange).toHaveBeenCalledWith([]);
  });

  it("removes a chip from the trigger without opening the popover", () => {
    const onChange = jest.fn();
    render(
      <TeamMultiPicker
        options={TEAMS}
        selected={["sre", "ops"]}
        onChange={onChange}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /Remove SRE/ }));
    expect(onChange).toHaveBeenCalledWith(["ops"]);
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
  });

  it("filters and preserves a stale slug as an unresolved chip", () => {
    // A team that no longer exists in the options list (e.g. it was
    // deleted from the Teams admin after being added to the agent's
    // shared list) must still render as a chip so the admin can see
    // it and remove it. The raw slug is the fallback label.
    render(
      <TeamMultiPicker
        options={TEAMS}
        selected={["zombie-team"]}
        onChange={() => {}}
      />,
    );
    expect(screen.getByText("zombie-team")).toBeInTheDocument();
  });

  it("Clear all wipes the selection from the popover footer", () => {
    const onChange = jest.fn();
    render(
      <TeamMultiPicker
        options={TEAMS}
        selected={["sre", "ops"]}
        onChange={onChange}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /Share with teams/i }));
    fireEvent.click(screen.getByRole("button", { name: /^Clear all$/ }));
    expect(onChange).toHaveBeenCalledWith([]);
  });
});
