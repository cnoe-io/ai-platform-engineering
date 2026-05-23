import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { AdminCredentialManagementPanel } from "../AdminCredentialManagementPanel";

const replace = jest.fn();
let searchParams = new URLSearchParams();

jest.mock("next/navigation", () => ({
  usePathname: () => "/admin",
  useRouter: () => ({ replace }),
  useSearchParams: () => searchParams,
}));

jest.mock("../OAuthConnectorAdminPanel", () => ({
  OAuthConnectorAdminPanel: () => <div>OAuth Providers content</div>,
}));

jest.mock("../AdminSecretsManager", () => ({
  AdminSecretsManager: () => <div>Global Secrets content</div>,
}));

jest.mock("../CredentialAuditPanel", () => ({
  CredentialAuditPanel: ({ endpoint }: { endpoint?: string }) => (
    <div>Credential Audit content from {endpoint}</div>
  ),
}));

describe("AdminCredentialManagementPanel", () => {
  beforeEach(() => {
    replace.mockClear();
    searchParams = new URLSearchParams("tab=credentials");
  });

  it("uses deep-linked admin credential tabs", async () => {
    const user = userEvent.setup();
    render(<AdminCredentialManagementPanel />);

    expect(screen.getByText("OAuth Providers content")).toBeInTheDocument();
    await user.click(screen.getByRole("tab", { name: /global secrets/i }));

    expect(replace).toHaveBeenCalledWith(
      "/admin?tab=credentials&credentialsTab=secrets",
      { scroll: false },
    );
  });

  it("opens the deep-linked global secrets tab", () => {
    searchParams = new URLSearchParams("tab=credentials&credentialsTab=secrets");

    render(<AdminCredentialManagementPanel />);

    expect(screen.getByText("Global Secrets content")).toBeInTheDocument();
  });

  it("opens the deep-linked credential audit tab", () => {
    searchParams = new URLSearchParams("tab=credentials&credentialsTab=audit");

    render(<AdminCredentialManagementPanel />);

    expect(
      screen.getByText("Credential Audit content from /api/admin/credentials/audit"),
    ).toBeInTheDocument();
  });
});
