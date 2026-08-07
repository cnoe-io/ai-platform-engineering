import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import React from "react";

import { AccessSubjectMultiPicker } from "../access-subject-picker";

describe("AccessSubjectMultiPicker", () => {
  it("explains implicit owner access instead of presenting it as a selectable grant", async () => {
    const user = userEvent.setup();
    const onChange = jest.fn();

    render(
      <AccessSubjectMultiPicker
        teams={[]}
        knownUsers={[
          {
            kind: "user",
            id: "test-user",
            name: "Test User",
            email: "test-user@example.com",
          },
        ]}
        selected={[]}
        implicitSelections={[{ kind: "user", id: "test-user" }]}
        implicitSelectionLabel="Access included through personal ownership"
        onChange={onChange}
        placeholder="Only the personal owner can search — add others"
        ariaLabel="Search access"
      />,
    );

    await user.click(
      screen.getByRole("combobox", { name: "Search access" }),
    );

    const owner = screen.getByRole("option", { name: /Test User/i });
    expect(owner).toBeDisabled();
    expect(owner).toHaveTextContent(
      "Access included through personal ownership",
    );
    expect(owner.closest('[role="listbox"]')).toHaveClass(
      "max-h-64",
      "overflow-y-auto",
    );

    await user.click(owner);
    expect(onChange).not.toHaveBeenCalled();
  });
});
