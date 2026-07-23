/**
 * @jest-environment jsdom
 */

import { render,screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

jest.mock("@/hooks/use-admin-role",() => ({
  useAdminRole: () => ({ isAdmin: true,loading: false }),
}));

jest.mock("@/components/settings/SettingsWorkspace",() => ({
  SettingsWorkspace: ({
    activeRouteId,
    isAdmin,
    onRouteChange,
  }: {
    activeRouteId: string;
    isAdmin: boolean;
    onRouteChange: (routeId: "announcements") => void;
  }) => (
    <div>
      <span>Active section: {activeRouteId}</span>
      <span>Admin access: {String(isAdmin)}</span>
      <button onClick={() => onRouteChange("announcements")} type="button">
        Show announcements
      </button>
    </div>
  ),
}));

import {
  SettingsDialogProvider,
  useSettingsDialog,
} from "../SettingsDialogProvider";

function SettingsLauncher(): React.ReactElement {
  const { openSettings } = useSettingsDialog();
  return (
    <button onClick={() => openSettings("defaults")} type="button">
      Open settings
    </button>
  );
}

describe("SettingsDialogProvider",() => {
  it("opens the requested section in a dialog and closes back to its caller",async () => {
    const user = userEvent.setup();
    render(
      <SettingsDialogProvider>
        <SettingsLauncher />
      </SettingsDialogProvider>,
    );

    expect(screen.queryByRole("dialog",{ name: "Settings" })).not.toBeInTheDocument();

    await user.click(screen.getByRole("button",{ name: "Open settings" }));

    const dialog = screen.getByRole("dialog",{ name: "Settings" });
    expect(dialog).toBeInTheDocument();
    expect(screen.getByText("Active section: defaults")).toBeInTheDocument();
    expect(screen.getByText("Admin access: true")).toBeInTheDocument();

    await user.click(screen.getByRole("button",{ name: "Show announcements" }));
    expect(screen.getByText("Active section: announcements")).toBeInTheDocument();

    await user.click(screen.getByRole("button",{ name: "Close" }));
    expect(screen.queryByRole("dialog",{ name: "Settings" })).not.toBeInTheDocument();
    expect(screen.getByRole("button",{ name: "Open settings" })).toBeInTheDocument();
  });
});
