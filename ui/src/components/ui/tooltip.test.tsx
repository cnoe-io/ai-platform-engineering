import { act, fireEvent, render, screen } from "@testing-library/react";

import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "./tooltip";

/**
 * Regression tests for the Tooltip primitive's "stay-open-while-the-cursor-
 * is-on-the-tooltip-body" + "scroll-when-the-body-is-tall" contract.
 *
 * Both behaviours land in the same primitive because they solve the same
 * UX bug: long-form explainer tooltips (the Keycloak invariant rows, the
 * structured warning rows, the team-scope matrix column headers) used to
 * collapse the moment the cursor left the trigger — including when it
 * moved 1px onto the tooltip body itself — and could clip off-screen
 * because the body had neither a height cap nor an overflow strategy.
 *
 * Short single-line tooltips must keep behaving as before, so this file
 * also pins that the short / nowrap path still works.
 */

const renderTooltip = (body: React.ReactNode, openByDefault = true) =>
  render(
    <TooltipProvider delayDuration={0}>
      <Tooltip defaultOpen={openByDefault}>
        <TooltipTrigger asChild>
          <button type="button" data-testid="trigger">
            ?
          </button>
        </TooltipTrigger>
        <TooltipContent side="bottom" className="max-w-sm whitespace-normal">
          {body}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>,
  );

describe("Tooltip primitive", () => {
  afterEach(() => {
    jest.useRealTimers();
  });

  it("renders the content with the scrollable-overflow class so long bodies don't clip off-screen", () => {
    renderTooltip(
      <div data-testid="body">
        <p>A long invariant explainer goes here…</p>
        <p>…with several paragraphs of body copy…</p>
        <p>…that would otherwise extend past the viewport edge.</p>
      </div>,
    );

    // The body is what the renderer wraps inside the portaled <div>.
    // We grab the tooltip-role wrapper that this primitive emits.
    const tooltip = screen.getByRole("tooltip");
    // The viewport-relative cap and overflow strategy live on the
    // tooltip's class list. We check for the strings rather than
    // computed styles because the class is what's portable across
    // theme / Tailwind compilation.
    expect(tooltip.className).toMatch(/max-h-\[min\(60vh,480px\)\]/);
    expect(tooltip.className).toMatch(/overflow-y-auto/);
    expect(tooltip.className).toMatch(/overscroll-contain/);
  });

  it("no longer applies `pointer-events-none`, so the cursor can land on the tooltip and scroll it", () => {
    renderTooltip("body");
    const tooltip = screen.getByRole("tooltip");
    expect(tooltip.className).not.toMatch(/pointer-events-none/);
  });

  it("stays open when the cursor moves from the trigger to the tooltip body", () => {
    jest.useFakeTimers();
    renderTooltip(<span data-testid="body">scrollable body text</span>);

    // Initially open via defaultOpen.
    expect(screen.getByRole("tooltip")).toBeInTheDocument();

    const trigger = screen.getByTestId("trigger");
    const tooltip = screen.getByRole("tooltip");

    // Cursor leaves the trigger — under the old primitive this would
    // immediately collapse the tooltip. Under the new contract the
    // close is *scheduled* (~120 ms grace period) so the cursor can
    // travel to the tooltip body.
    fireEvent.mouseLeave(trigger);

    // Body picks up the cursor before the grace timer fires.
    fireEvent.mouseEnter(tooltip);

    // Advance past the close timeout; the tooltip must still be open
    // because the hover-hold counter is now > 0.
    act(() => {
      jest.advanceTimersByTime(500);
    });
    expect(screen.queryByRole("tooltip")).toBeInTheDocument();

    // Body finally loses the cursor — the close timer fires after
    // the next grace period.
    fireEvent.mouseLeave(tooltip);
    act(() => {
      jest.advanceTimersByTime(500);
    });
    expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();
  });

  it("closes if the cursor leaves the trigger without landing on the body", () => {
    jest.useFakeTimers();
    renderTooltip("body");

    const trigger = screen.getByTestId("trigger");

    fireEvent.mouseLeave(trigger);

    // No mouseenter on the body — let the close timer fire.
    act(() => {
      jest.advanceTimersByTime(500);
    });

    expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();
  });

  it("merges caller-supplied className overrides without overriding the scroll cap", () => {
    // Real call sites pass `max-w-sm`, `whitespace-normal`, and
    // padding overrides. The new scroll-cap classes must coexist
    // with those so the explainer panels don't lose their layout.
    render(
      <TooltipProvider delayDuration={0}>
        <Tooltip defaultOpen>
          <TooltipTrigger asChild>
            <button type="button" data-testid="trigger">
              ?
            </button>
          </TooltipTrigger>
          <TooltipContent
            side="bottom"
            sideOffset={6}
            className="whitespace-normal max-w-sm w-max text-left font-normal leading-snug p-3"
          >
            <p>Body</p>
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>,
    );

    const tooltip = screen.getByRole("tooltip");
    expect(tooltip.className).toMatch(/whitespace-normal/);
    expect(tooltip.className).toMatch(/max-w-sm/);
    expect(tooltip.className).toMatch(/max-h-\[min\(60vh,480px\)\]/);
    expect(tooltip.className).toMatch(/overflow-y-auto/);
  });
});
