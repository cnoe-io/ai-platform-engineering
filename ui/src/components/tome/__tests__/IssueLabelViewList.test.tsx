import { fireEvent, render, screen } from "@testing-library/react";

import { issueFiltersForLabel } from "@/lib/tome/issue-filter-views";
import { IssueLabelViewList } from "../IssueLabelViewList";

const views = [
  { id: "decision", title: "Decisions", filters: issueFiltersForLabel("decision") },
  { id: "critical", title: "Critical", filters: issueFiltersForLabel("critical") },
  { id: "bugs", title: "Bug", filters: issueFiltersForLabel("bug") },
];

describe("IssueLabelViewList", () => {
  it("reorders a label when its handle is dragged onto another row", () => {
    const onReorder = jest.fn();
    render(
      <IssueLabelViewList
        views={views}
        customViews={[]}
        onSelect={jest.fn()}
        onRemove={jest.fn()}
        onReorder={onReorder}
      />,
    );
    const handle = screen.getByRole("button", {
      name: "Drag Critical to reorder",
    });
    const decisionRow = screen
      .getByText("Decisions")
      .closest("[data-issue-filter-view]");

    fireEvent.mouseDown(handle, { button: 0 });
    fireEvent.mouseEnter(decisionRow!);
    fireEvent.mouseUp(decisionRow!);

    expect(onReorder).toHaveBeenCalledWith("critical", "decision");
  });

  it("supports keyboard reordering from the drag handle", () => {
    const onReorder = jest.fn();
    render(
      <IssueLabelViewList
        views={views}
        customViews={[]}
        onSelect={jest.fn()}
        onRemove={jest.fn()}
        onReorder={onReorder}
      />,
    );

    fireEvent.keyDown(
      screen.getByRole("button", { name: "Drag Critical to reorder" }),
      { key: "ArrowUp" },
    );

    expect(onReorder).toHaveBeenCalledWith("critical", "decision");
  });

  it("hides reordering for product-owned fixed views", () => {
    render(
      <IssueLabelViewList
        views={views.slice(0, 2)}
        customViews={[]}
        reorderable={false}
        onSelect={jest.fn()}
        onRemove={jest.fn()}
        onReorder={jest.fn()}
      />,
    );

    expect(screen.getByText("Decisions")).toBeInTheDocument();
    expect(screen.getByText("Critical")).toBeInTheDocument();
    expect(screen.queryByRole("button", {
      name: "Drag Decisions to reorder",
    })).not.toBeInTheDocument();
  });
});
