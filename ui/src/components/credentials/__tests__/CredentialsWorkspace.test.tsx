import { render, screen } from "@testing-library/react";

// assisted-by claude code claude-sonnet-4-6

import { CredentialsWorkspace } from "../CredentialsWorkspace";

jest.mock("../SecretsManager", () => ({
  SecretsManager: () => <div>Saved Secrets content</div>,
}));

jest.mock("../ProviderConnections", () => ({
  ProviderConnections: () => <div>Connected Apps content</div>,
}));

describe("CredentialsWorkspace", () => {
  it("renders secrets and connections in a single pane", () => {
    render(<CredentialsWorkspace />);

    expect(screen.getByText("Saved Secrets content")).toBeInTheDocument();
    expect(screen.getByText("Connected Apps content")).toBeInTheDocument();
    expect(screen.queryByRole("tab")).toBeNull();
  });

  it("renders the Credentials heading", () => {
    render(<CredentialsWorkspace />);

    expect(screen.getByRole("heading", { name: /credentials/i })).toBeInTheDocument();
  });
});
