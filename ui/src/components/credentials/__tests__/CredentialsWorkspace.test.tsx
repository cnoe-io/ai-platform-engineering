import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { CredentialsWorkspace } from "../CredentialsWorkspace";

const replace = jest.fn();
let searchParams = new URLSearchParams();

jest.mock("next/navigation", () => ({
  usePathname: () => "/credentials",
  useRouter: () => ({ replace }),
  useSearchParams: () => searchParams,
}));

jest.mock("../SecretsManager", () => ({
  SecretsManager: () => <div>My Secrets content</div>,
}));

jest.mock("../ProviderConnections", () => ({
  ProviderConnections: () => <div>My Connections content</div>,
}));

jest.mock("../CredentialAuditPanel", () => ({
  CredentialAuditPanel: () => <div>Credential Audit content</div>,
}));

describe("CredentialsWorkspace", () => {
  beforeEach(() => {
    replace.mockClear();
    searchParams = new URLSearchParams();
  });

  it("separates user secrets and connections into tabs", async () => {
    const user = userEvent.setup();
    render(<CredentialsWorkspace />);

    const tabs = screen.getAllByRole("tab");
    expect(tabs.map((tab) => tab.textContent)).toEqual(["My Connections", "My Secrets"]);
    expect(screen.getByText("My Connections content")).toBeInTheDocument();

    await user.click(screen.getByRole("tab", { name: /my secrets/i }));
    expect(replace).toHaveBeenCalledWith("/credentials?tab=secrets", { scroll: false });
    expect(screen.getByText("My Secrets content")).toBeInTheDocument();
  });

  it("opens the deep-linked secrets tab", () => {
    searchParams = new URLSearchParams("tab=secrets");

    render(<CredentialsWorkspace />);

    expect(screen.getByText("My Secrets content")).toBeInTheDocument();
    expect(screen.queryByText("Credential Audit content")).not.toBeInTheDocument();
  });
});
