import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

// assisted-by Codex Codex-sonnet-4-6

import { AdminCredentialManagementPanel } from "../AdminCredentialManagementPanel";

const replace = jest.fn();
let searchParams = new URLSearchParams();

jest.mock("next/navigation", () => ({
  usePathname: () => "/admin",
  useRouter: () => ({ replace }),
  useSearchParams: () => searchParams,
}));

jest.mock("../OAuthConnectorAdminPanel", () => ({
  OAuthConnectorAdminPanel: () => <div>Connected Apps content</div>,
}));

jest.mock("../AdminSecretsManager", () => ({
  AdminSecretsManager: () => <div>Secrets content</div>,
}));

describe("AdminCredentialManagementPanel", () => {
  beforeEach(() => {
    replace.mockClear();
    searchParams = new URLSearchParams("tab=credentials");
  });

  it("uses deep-linked admin credential tabs", async () => {
    const user = userEvent.setup();
    render(<AdminCredentialManagementPanel />);

    expect(screen.queryByRole("tab", { name: /credential audit/i })).not.toBeInTheDocument();
    expect(screen.getByText("Secrets content")).toBeInTheDocument();
    await user.click(screen.getByRole("tab", { name: /connected apps/i }));

    expect(replace).toHaveBeenCalledWith(
      "/admin?tab=credentials&credentialsTab=oauth-providers",
      { scroll: false },
    );
  });

  it("opens the deep-linked global secrets tab", () => {
    searchParams = new URLSearchParams("tab=credentials&credentialsTab=secrets");

    render(<AdminCredentialManagementPanel />);

    expect(screen.getByText("Secrets content")).toBeInTheDocument();
  });

  it("falls back to secrets for legacy credential audit deep links", () => {
    searchParams = new URLSearchParams("tab=credentials&credentialsTab=audit");

    render(<AdminCredentialManagementPanel />);

    expect(screen.getByText("Secrets content")).toBeInTheDocument();
    expect(screen.queryByRole("tab", { name: /credential audit/i })).not.toBeInTheDocument();
  });
});
