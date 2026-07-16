/**
 * @jest-environment jsdom
 */

import { render,screen,waitFor } from "@testing-library/react";

let pathname = "/settings/chat";
let adminState = { isAdmin: false,loading: false };
const replace = jest.fn();

jest.mock("next/navigation",() => ({
  usePathname: () => pathname,
  useRouter: () => ({ push: jest.fn(),replace }),
}));

jest.mock("@/hooks/use-admin-role",() => ({
  useAdminRole: () => adminState,
}));

jest.mock("@/components/settings/sections/AppearanceSettings",() => ({ AppearanceSettings: () => <div>Appearance content</div> }));
jest.mock("@/components/settings/sections/ChatSettings",() => ({ ChatSettings: () => <div>Chat content</div> }));
jest.mock("@/components/settings/sections/NotificationsSettings",() => ({ NotificationsSettings: () => <div>Notifications content</div> }));
jest.mock("@/components/settings/sections/AccessSettings",() => ({ AccessSettings: () => <div>Access content</div> }));
jest.mock("@/components/settings/sections/DeveloperSettings",() => ({ DeveloperSettings: () => <div>Developer content</div> }));
jest.mock("@/components/settings/sections/PlatformDefaultsSettings",() => ({ PlatformDefaultsSettings: () => <div>Platform defaults content</div> }));
jest.mock("@/components/settings/sections/PlatformAccessSettings",() => ({ PlatformAccessSettings: () => <div>Platform access content</div> }));
jest.mock("@/components/settings/sections/PlatformAnnouncementsSettings",() => ({ PlatformAnnouncementsSettings: () => <div>Platform announcements content</div> }));
jest.mock("@/components/admin/settings/ReviewConfigsTab",() => ({ ReviewConfigsTab: () => <div>AI review content</div> }));

import { SettingsWorkspace } from "../SettingsWorkspace";

describe("SettingsWorkspace",() => {
  beforeEach(() => {
    jest.clearAllMocks();
    pathname = "/settings/chat";
    adminState = { isAdmin: false,loading: false };
  });

  it("renders a deep-linked personal section with Personal scope",() => {
    pathname = "/settings/appearance";
    render(<SettingsWorkspace />);

    expect(screen.getByRole("heading",{ name: "Settings" })).toBeInTheDocument();
    expect(screen.getByText("Manage your experience.")).toBeInTheDocument();
    expect(screen.getByRole("heading",{ name: "Appearance" })).toBeInTheDocument();
    expect(screen.getAllByText("Personal").length).toBeGreaterThan(0);
    expect(screen.getByText("Appearance content")).toBeInTheDocument();
    expect(screen.queryByText("Platform defaults content")).not.toBeInTheDocument();
  });

  it("hides all platform navigation from a non-admin",() => {
    render(<SettingsWorkspace />);

    expect(screen.queryByRole("link",{ name: "Defaults" })).not.toBeInTheDocument();
    expect(screen.queryByRole("link",{ name: "Access before sign-in" })).not.toBeInTheDocument();
  });

  it("redirects a non-admin away from a direct platform URL",async () => {
    pathname = "/settings/platform/defaults";
    render(<SettingsWorkspace />);

    await waitFor(() => expect(replace).toHaveBeenCalledWith("/settings/chat"));
    expect(screen.queryByText("Platform defaults content")).not.toBeInTheDocument();
  });

  it("renders admin-only platform routes with explicit Platform scope",() => {
    pathname = "/settings/platform/defaults";
    adminState = { isAdmin: true,loading: false };
    render(<SettingsWorkspace />);

    expect(screen.getByText("Platform · Admins")).toBeInTheDocument();
    expect(screen.getByText("Platform defaults content")).toBeInTheDocument();
    expect(screen.getByRole("link",{ name: "Announcements" })).toBeInTheDocument();
  });

  it("redirects an unknown settings path to the default personal section",async () => {
    pathname = "/settings/not-a-real-section";
    render(<SettingsWorkspace />);

    await waitFor(() => expect(replace).toHaveBeenCalledWith("/settings/chat"));
  });
});
