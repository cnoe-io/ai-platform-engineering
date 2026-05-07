import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { SuggestedPromptChips } from "../SuggestedPromptChips";

describe("SuggestedPromptChips", () => {
  const prompts = [
    "Summarize this repo.",
    "Show blocked PRs.",
  ];

  it("hides contextual suggestions and leaves a subtle restore control", async () => {
    const user = userEvent.setup();
    const onSelect = jest.fn();

    render(<SuggestedPromptChips prompts={prompts} onSelect={onSelect} />);

    expect(screen.getByRole("button", { name: prompts[0] })).toBeInTheDocument();

    await user.click(
      screen.getByRole("button", { name: /hide suggested prompts/i }),
    );

    expect(screen.queryByRole("button", { name: prompts[0] })).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /show suggested prompts/i }),
    ).toHaveClass("text-[10px]", "bg-primary/5");
  });

  it("restores hidden suggestions and allows selecting a prompt", async () => {
    const user = userEvent.setup();
    const onSelect = jest.fn();

    render(<SuggestedPromptChips prompts={prompts} onSelect={onSelect} />);

    await user.click(
      screen.getByRole("button", { name: /hide suggested prompts/i }),
    );
    await user.click(
      screen.getByRole("button", { name: /show suggested prompts/i }),
    );
    await user.click(screen.getByRole("button", { name: prompts[1] }));

    expect(onSelect).toHaveBeenCalledWith(prompts[1]);
  });

  it("can start hidden to preserve embedded chat space", async () => {
    const user = userEvent.setup();
    const onSelect = jest.fn();

    render(
      <SuggestedPromptChips
        prompts={prompts}
        onSelect={onSelect}
        initiallyHidden
      />,
    );

    expect(screen.queryByRole("button", { name: prompts[0] })).not.toBeInTheDocument();
    await user.click(
      screen.getByRole("button", { name: /show suggested prompts/i }),
    );
    await user.click(screen.getByRole("button", { name: prompts[0] }));

    expect(onSelect).toHaveBeenCalledWith(prompts[0]);
  });
});
