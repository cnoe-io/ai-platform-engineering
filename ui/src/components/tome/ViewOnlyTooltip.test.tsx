import { act, fireEvent, render, screen } from "@testing-library/react";

import { ViewOnlyTooltip } from "./ViewOnlyTooltip";

describe("ViewOnlyTooltip", () => {
  afterEach(() => {
    jest.useRealTimers();
  });

  it("anchors the tooltip's right edge to the disabled control", () => {
    jest.useFakeTimers();
    render(
      <ViewOnlyTooltip viewOnly>
        <button type="button" disabled>
          Edit
        </button>
      </ViewOnlyTooltip>,
    );

    const trigger = screen.getByRole("button", { name: "Edit" }).parentElement;
    expect(trigger).not.toBeNull();

    fireEvent.mouseEnter(trigger!);
    act(() => {
      jest.advanceTimersByTime(200);
    });

    const tooltip = screen.getByRole("tooltip");
    expect(tooltip.className).toMatch(/-translate-x-full/);
    expect(tooltip.className).not.toMatch(/-translate-x-1\/2/);
  });
});
