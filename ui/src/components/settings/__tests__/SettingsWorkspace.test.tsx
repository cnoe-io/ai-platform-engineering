/**
 * @jest-environment jsdom
 */

import { render,screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

jest.mock("next/navigation",() => ({
  useRouter: () => ({ push: jest.fn() }),
}));

jest.mock("@/components/settings/sections/AppearanceSettings",() => ({ AppearanceSettings: () => <div>Appearance content</div> }));
jest.mock("@/components/settings/sections/ChatSettings",() => ({ ChatSettings: () => <div>Chat content</div> }));
jest.mock("@/components/settings/sections/NotificationsSettings",() => ({ NotificationsSettings: () => <div>Notifications content</div> }));
jest.mock("@/components/settings/sections/AccessSettings",() => ({ AccessSettings: () => <div>Access content</div> }));
jest.mock("@/components/settings/sections/DeveloperSettings",() => ({ DeveloperSettings: () => <div>Developer content</div> }));
jest.mock("@/components/settings/sections/PlatformDefaultsSettings",() => ({ PlatformDefaultsSettings: () => <div>Platform defaults content</div> }));
jest.mock("@/components/settings/sections/PlatformAnnouncementsSettings",() => ({ PlatformAnnouncementsSettings: () => <div>Platform announcements content</div> }));

import { SettingsWorkspace } from "../SettingsWorkspace";

describe("SettingsWorkspace",() => {
  it("renders the selected personal section and exposes its current state",() => {
    render(
      <SettingsWorkspace
        activeRouteId="appearance"
        isAdmin={false}
        onRouteChange={jest.fn()}
      />,
    );

    expect(screen.getByRole("heading",{ name: "Appearance" })).toBeInTheDocument();
    expect(screen.getAllByText("Personal",{ exact: true }).length).toBeGreaterThan(0);
    expect(screen.getByText("Appearance content")).toBeInTheDocument();

    const navigation = screen.getByRole("navigation",{ name: "Settings sections" });
    const activeButton = screen.getByRole("button",{ name: "Appearance" });
    expect(navigation).toContainElement(activeButton);
    expect(activeButton).toHaveAttribute("aria-current","page");
    expect(screen.getByRole("button",{ name: "Chat & agents" })).not.toHaveAttribute(
      "aria-current",
    );
  });

  it("shows platform settings only to admins",() => {
    const { rerender } = render(
      <SettingsWorkspace activeRouteId="chat" isAdmin={false} onRouteChange={jest.fn()} />,
    );

    expect(screen.queryByRole("button",{ name: "Defaults" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button",{ name: "Announcements" })).not.toBeInTheDocument();

    rerender(
      <SettingsWorkspace activeRouteId="chat" isAdmin onRouteChange={jest.fn()} />,
    );

    expect(screen.getByRole("button",{ name: "Defaults" })).toBeInTheDocument();
    expect(screen.getByRole("button",{ name: "Announcements" })).toBeInTheDocument();
    expect(screen.queryByRole("button",{ name: "AI Review" })).not.toBeInTheDocument();
  });

  it("selects platform sections without navigating away from the current page",async () => {
    const user = userEvent.setup();
    const onRouteChange = jest.fn();
    render(
      <SettingsWorkspace activeRouteId="defaults" isAdmin onRouteChange={onRouteChange} />,
    );

    expect(screen.getByText("Platform · Admins")).toBeInTheDocument();
    expect(screen.getByText("Platform defaults content")).toBeInTheDocument();

    await user.click(screen.getByRole("button",{ name: "Announcements" }));
    expect(onRouteChange).toHaveBeenCalledWith("announcements");
  });
});
