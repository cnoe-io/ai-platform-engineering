import { act, fireEvent, render, screen } from "@testing-library/react";

import { BetaBadge } from "@/components/tome/BetaBadge";
import { TooltipProvider } from "@/components/ui/tooltip";

describe("BetaBadge", () => {
  afterEach(() => {
    jest.useRealTimers();
  });

  it("stays presentational when its parent already provides a tooltip", () => {
    jest.useFakeTimers();
    render(
      <TooltipProvider delayDuration={0}>
        <BetaBadge showTooltip={false} />
      </TooltipProvider>,
    );

    fireEvent.mouseEnter(screen.getByText("Beta"));
    act(() => {
      jest.runOnlyPendingTimers();
    });

    expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();
  });
});
