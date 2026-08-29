import { fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";

import { IssueLabelDisclosure } from "../IssueLabelDisclosure";

function DisclosureHarness() {
  const [expanded, setExpanded] = useState(false);
  return (
    <IssueLabelDisclosure
      expanded={expanded}
      onExpandedChange={setExpanded}
      controlsId="issue-label-views"
      header={<span>Issues</span>}
      actions={<button type="button">Add</button>}
    >
      <span>Decisions</span>
    </IssueLabelDisclosure>
  );
}

describe("IssueLabelDisclosure", () => {
  it("is collapsed by default and toggles its label views", () => {
    render(<DisclosureHarness />);

    const expand = screen.getByRole("button", {
      name: "Expand issue label views",
    });
    expect(expand).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByText("Decisions")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Add" })).toBeInTheDocument();

    fireEvent.click(expand);
    const collapse = screen.getByRole("button", {
      name: "Collapse issue label views",
    });
    expect(collapse).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByText("Decisions")).toBeInTheDocument();

    fireEvent.click(collapse);
    expect(screen.queryByText("Decisions")).not.toBeInTheDocument();
  });

  it("keeps fixed issue views expanded when collapsing is disabled", () => {
    render(
      <IssueLabelDisclosure
        expanded
        collapsible={false}
        onExpandedChange={jest.fn()}
        controlsId="fixed-issue-views"
        header={<span>Issues</span>}
        actions={null}
      >
        <span>Tome Tracker</span>
      </IssueLabelDisclosure>,
    );

    expect(screen.getByText("Tome Tracker")).toBeInTheDocument();
    expect(screen.queryByRole("button", {
      name: "Collapse issue label views",
    })).not.toBeInTheDocument();
  });
});
