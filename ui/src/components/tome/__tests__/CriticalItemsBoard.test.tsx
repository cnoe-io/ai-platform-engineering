import { render, screen } from "@testing-library/react";

import { CriticalItemsBoard } from "../CriticalItemsBoard";

describe("CriticalItemsBoard", () => {
  it("selects all priorities by default", async () => {
    render(<CriticalItemsBoard slug="example-project" />);

    expect(await screen.findByText("No tracked items")).toBeInTheDocument();

    for (const label of ["Critical", "High", "Medium", "Low", "All"]) {
      expect(screen.getByRole("button", { name: label })).toHaveAttribute(
        "aria-pressed",
        "true",
      );
    }
  });
});
