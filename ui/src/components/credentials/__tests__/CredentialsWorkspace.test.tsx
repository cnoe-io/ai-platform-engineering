import { render,screen,waitFor } from "@testing-library/react";

import { CredentialsWorkspace } from "../CredentialsWorkspace";

const mockPush = jest.fn();
const mockReplace = jest.fn();

jest.mock("next/navigation",() => ({
  useRouter: () => ({ push: mockPush,replace: mockReplace }),
}));

jest.mock("../SecretsManager",() => ({
  SecretsManager: () => <div>Saved Secrets content</div>,
}));

jest.mock("../ProviderConnections",() => ({
  ProviderConnections: () => <div>Connected Apps content</div>,
}));

describe("CredentialsWorkspace",() => {
  beforeEach(() => {
    jest.clearAllMocks();
    window.history.replaceState(null,"","/credentials/connections");
  });

  it("renders Connections as a canonical routed workspace section",() => {
    render(<CredentialsWorkspace activeSection="connections" />);

    expect(screen.getByRole("heading",{ name: "Credentials" })).toBeInTheDocument();
    expect(screen.getByText("Manage connected apps and saved secrets.")).toBeInTheDocument();
    expect(screen.getByText("Connected Apps content")).toBeInTheDocument();
    expect(screen.queryByText("Saved Secrets content")).not.toBeInTheDocument();

    const activeLink = screen.getByRole("link",{ name: /Connected apps/ });
    expect(activeLink).toHaveAttribute("href","/credentials/connections");
    expect(activeLink).toHaveAttribute("aria-current","page");
    expect(screen.getByRole("link",{ name: /Saved secrets/ })).toHaveAttribute(
      "href",
      "/credentials/secrets",
    );
  });

  it("renders only the selected Secrets section",() => {
    render(<CredentialsWorkspace activeSection="secrets" />);

    expect(screen.getByText("Saved Secrets content")).toBeInTheDocument();
    expect(screen.queryByText("Connected Apps content")).not.toBeInTheDocument();
    expect(screen.getByRole("link",{ name: /Saved secrets/ })).toHaveAttribute(
      "aria-current",
      "page",
    );
  });

  it("returns OAuth completion events to Connected apps",async () => {
    render(<CredentialsWorkspace activeSection="secrets" />);

    window.dispatchEvent(new MessageEvent("message",{
      data: { type: "caipe.oauth.connection" },
      origin: window.location.origin,
    }));

    await waitFor(() => expect(mockReplace).toHaveBeenCalledWith("/credentials/connections"));
  });

});
