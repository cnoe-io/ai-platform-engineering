import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { SecretValueDialog } from "../SecretValueDialog";

describe("SecretValueDialog", () => {
  it("submits a secret value without rendering it after submit", async () => {
    const user = userEvent.setup();
    const onSubmit = jest.fn(async () => undefined);
    render(<SecretValueDialog submitLabel="Rotate" onSubmit={onSubmit} />);

    await user.type(screen.getByLabelText(/secret value/i), "new-secret-value");
    await user.click(screen.getByRole("button", { name: /rotate/i }));

    expect(onSubmit).toHaveBeenCalledWith("new-secret-value");
    expect(screen.queryByText("new-secret-value")).not.toBeInTheDocument();
  });
});
