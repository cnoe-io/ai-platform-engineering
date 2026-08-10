import { fireEvent, render, screen } from "@testing-library/react";

import { Popover, PopoverContent, PopoverTrigger } from "./popover";

it("renders portaled content as an interactive layer above dialog overlays", () => {
  render(
    <Popover>
      <PopoverTrigger asChild>
        <button type="button">Open picker</button>
      </PopoverTrigger>
      <PopoverContent>
        <button type="button">Selectable option</button>
      </PopoverContent>
    </Popover>
  );

  fireEvent.click(screen.getByRole("button", { name: "Open picker" }));

  const content = screen.getByRole("button", { name: "Selectable option" }).parentElement;
  expect(content).toHaveClass("pointer-events-auto");
  expect(content).toHaveClass("z-[60]");
});
