import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

// assisted-by Codex Codex-sonnet-4-6

import { CredentialsWorkspace } from "../CredentialsWorkspace";

const replace = jest.fn();
let searchParams = new URLSearchParams();

jest.mock("next/navigation", () => ({
  usePathname: () => "/credentials",
  useRouter: () => ({ replace }),
  useSearchParams: () => searchParams,
}));

jest.mock("../SecretsManager", () => ({
  SecretsManager: () => <div>Saved Secrets content</div>,
}));

jest.mock("../ProviderConnections", () => ({
  ProviderConnections: () => <div>Connected Apps content</div>,
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
    expect(tabs.map((tab) => tab.textContent)).toEqual(["Saved Secrets", "Connected Apps"]);
    expect(screen.getByText("Saved Secrets content")).toBeInTheDocument();

    await user.click(screen.getByRole("tab", { name: /connected apps/i }));
    expect(replace).toHaveBeenCalledWith("/credentials?tab=connections", { scroll: false });
    expect(screen.getByText("Connected Apps content")).toBeInTheDocument();
  });

  it("opens the deep-linked secrets tab", () => {
    searchParams = new URLSearchParams("tab=secrets");

    render(<CredentialsWorkspace />);

    expect(screen.getByText("Saved Secrets content")).toBeInTheDocument();
  });

  it("returns to Connected Apps after a successful OAuth relink", () => {
    render(<CredentialsWorkspace />);

    expect(screen.getByText("Saved Secrets content")).toBeInTheDocument();

    act(() => {
      window.dispatchEvent(
        new MessageEvent("message", {
          origin: window.location.origin,
          data: { type: "caipe.oauth.connection", status: "success", provider: "atlassian" },
        }),
      );
    });

    expect(replace).toHaveBeenCalledWith("/credentials?tab=connections", { scroll: false });
    expect(screen.getByText("Connected Apps content")).toBeInTheDocument();
  });

  it("ignores failed or cross-origin OAuth completion events", () => {
    render(<CredentialsWorkspace />);

    act(() => {
      window.dispatchEvent(
        new MessageEvent("message", {
          origin: window.location.origin,
          data: { type: "caipe.oauth.connection", status: "error", provider: "atlassian" },
        }),
      );
      window.dispatchEvent(
        new MessageEvent("message", {
          origin: "https://auth.atlassian.com",
          data: { type: "caipe.oauth.connection", status: "success", provider: "atlassian" },
        }),
      );
      window.dispatchEvent(
        new MessageEvent("message", {
          origin: window.location.origin,
          data: { type: "something.else", status: "success" },
        }),
      );
    });

    expect(replace).not.toHaveBeenCalled();
    expect(screen.getByText("Saved Secrets content")).toBeInTheDocument();
  });
});
