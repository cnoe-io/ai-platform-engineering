/**
 * @jest-environment jsdom
 */

// assisted-by Codex Codex-sonnet-4-6

import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { MultiSelect } from "../multi-select";

describe("MultiSelect", () => {
  it("focuses and filters options from the search input", async () => {
    const user = userEvent.setup();
    const onChange = jest.fn();

    render(
      <MultiSelect
        options={[
          "argocd: all tools",
          "github: all tools",
          "jira: all tools",
        ]}
        selected={[]}
        onChange={onChange}
        placeholder="Add tools..."
      />,
    );

    await user.click(screen.getByRole("button", { name: /add tools/i }));
    const search = screen.getByPlaceholderText("Search...");

    await waitFor(() => expect(search).toHaveFocus());
    await user.type(search, "jira");

    expect(screen.getByRole("button", { name: /jira: all tools/i })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /argocd: all tools/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /github: all tools/i })).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /jira: all tools/i }));
    expect(onChange).toHaveBeenCalledWith(["jira: all tools"]);
  });
});
