/** @jest-environment jsdom */

import userEvent from "@testing-library/user-event";
import { render,screen,waitFor } from "@testing-library/react";

jest.mock("@/components/settings/ReleaseNotesPreview",() => ({
  ReleaseNotesPreview: () => <div>Release notes preview</div>,
}));

import { NotificationsSettings } from "@/components/settings/sections/NotificationsSettings";

beforeEach(() => {
  jest.clearAllMocks();
});

it("loads and saves the personal platform health notification preference",async () => {
  const refreshListener = jest.fn();
  window.addEventListener("in-app-notifications:refresh",refreshListener);
  const fetchMock = jest.spyOn(global,"fetch")
    .mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        success: true,
        data: {
          preferences: { releaseNotesNotificationsEnabled: true },
          notifications: { platform_health: false },
        },
      }),
    } as Response)
    .mockResolvedValueOnce({
      ok: true,
      json: async () => ({ success: true }),
    } as Response);

  render(<NotificationsSettings />);

  const toggle = await screen.findByRole("switch",{
    name: "Notify me about platform health",
  });
  expect(toggle).toHaveAttribute("aria-checked","false");

  await userEvent.click(toggle);

  await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(
    "/api/settings/notifications",
    expect.objectContaining({
      method: "PATCH",
      body: JSON.stringify({ platform_health: true }),
    }),
  ));
  await waitFor(() => expect(refreshListener).toHaveBeenCalled());
  window.removeEventListener("in-app-notifications:refresh",refreshListener);
});
