import { render } from "@testing-library/react";

import { AgentAvatar } from "../AgentAvatar";

describe("AgentAvatar", () => {
  it("derives a stable fallback theme from the agent id", () => {
    const { container,rerender } = render(
      <AgentAvatar agent={{ _id: "agent-alpha" }} />,
    );

    expect(container.firstElementChild).toHaveAttribute("data-agent-theme", "sunset");

    rerender(<AgentAvatar agent={{ _id: "agent-beta" }} />);
    expect(container.firstElementChild).toHaveAttribute("data-agent-theme", "default");
  });

  it("keeps an explicitly selected theme instead of deriving one", () => {
    const { container } = render(
      <AgentAvatar
        agent={{
          _id: "agent-alpha",
          ui: { gradient_theme: "ocean" },
        }}
      />,
    );

    expect(container.firstElementChild).toHaveAttribute("data-agent-theme", "ocean");
  });
});
