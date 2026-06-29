import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

// assisted-by claude code claude-sonnet-4-6
// assisted-by Codex Codex-sonnet-4-6

import { CredentialsWorkspace } from "../CredentialsWorkspace";

jest.mock("../SecretsManager", () => ({
  SecretsManager: () => <div>Saved Secrets content</div>,
}));

jest.mock("../ProviderConnections", () => ({
  ProviderConnections: () => <div>Connected Apps content</div>,
}));

describe("CredentialsWorkspace", () => {
  beforeEach(() => {
    window.history.replaceState(null, "", "/credentials");
  });

  it("defaults to the Connections tab and normalizes the hash", async () => {
    render(<CredentialsWorkspace />);

    expect(screen.getByText("Connected Apps content")).toBeInTheDocument();
    expect(screen.queryByText("Saved Secrets content")).not.toBeInTheDocument();

    await waitFor(() => expect(window.location.hash).toBe("#connections"));
    expect(screen.getByRole("tab", { name: "Connections" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
  });

  it("opens the Secrets tab from the URL hash", async () => {
    window.history.replaceState(null, "", "/credentials#secrets");

    render(<CredentialsWorkspace />);

    await waitFor(() => {
      expect(screen.getByRole("tab", { name: "Secrets" })).toHaveAttribute(
        "aria-selected",
        "true",
      );
    });
    expect(screen.getByText("Saved Secrets content")).toBeInTheDocument();
    expect(screen.queryByText("Connected Apps content")).not.toBeInTheDocument();
  });

  it("updates the URL hash when users switch tabs", async () => {
    const user = userEvent.setup();
    render(<CredentialsWorkspace />);

    await waitFor(() => expect(window.location.hash).toBe("#connections"));

    await user.click(screen.getByRole("tab", { name: "Secrets" }));

    await waitFor(() => expect(window.location.hash).toBe("#secrets"));
    expect(screen.getByText("Saved Secrets content")).toBeInTheDocument();

    await user.click(screen.getByRole("tab", { name: "Connections" }));

    await waitFor(() => expect(window.location.hash).toBe("#connections"));
    expect(screen.getByText("Connected Apps content")).toBeInTheDocument();
  });

  it("renders the Credentials heading", () => {
    render(<CredentialsWorkspace />);

    expect(screen.getByRole("heading", { name: /credentials/i })).toBeInTheDocument();
  });
});
