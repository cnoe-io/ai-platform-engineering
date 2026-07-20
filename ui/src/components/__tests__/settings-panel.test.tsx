/**
 * @jest-environment jsdom
 */

import { act,fireEvent,render,screen,waitFor } from "@testing-library/react";

const mockGetSettings = jest.fn();
const mockSetTheme = jest.fn();
const mockOpenSettings = jest.fn();
let mockTheme = "dark";
let mockConfig: Record<string,string> = {};

jest.mock("next-themes",() => ({
  useTheme: () => ({ theme: mockTheme,setTheme: mockSetTheme }),
}));

jest.mock("@/lib/api-client",() => ({
  apiClient: { getSettings: (...args: unknown[]) => mockGetSettings(...args) },
}));

jest.mock("@/components/settings/SettingsDialogProvider",() => ({
  useSettingsDialog: () => ({ openSettings: mockOpenSettings }),
}));

jest.mock("@/lib/config",() => ({
  getConfig: (key: string) => mockConfig[key],
}));

import { SettingsPanel } from "../settings-panel";

describe("SettingsPanel",() => {
  beforeEach(() => {
    jest.clearAllMocks();
    localStorage.clear();
    document.body.removeAttribute("data-font-size");
    document.body.removeAttribute("data-font-family");
    document.documentElement.removeAttribute("data-gradient-theme");
    mockTheme = "dark";
    mockConfig = {
      defaultFontSize: "medium",
      defaultFontFamily: "inter",
      defaultTheme: "dark",
      defaultGradientTheme: "default",
    };
    mockGetSettings.mockResolvedValue({
      preferences: {
        font_size: "medium",
        font_family: "inter",
        gradient_theme: "default",
        theme: "dark",
      },
    });
  });

  it("opens the shared Settings dialog directly to Appearance",async () => {
    await act(async () => {
      render(<SettingsPanel />);
    });

    const button = screen.getByRole("button",{ name: "Appearance settings" });
    expect(button).toHaveTextContent("Dark");

    fireEvent.click(button);
    expect(mockOpenSettings).toHaveBeenCalledWith("appearance");
  });

  it("hydrates cached appearance immediately",async () => {
    localStorage.setItem("caipe-font-size","large");
    localStorage.setItem("caipe-font-family","ibm-plex");
    localStorage.setItem("caipe-gradient-theme","ocean");
    mockGetSettings.mockRejectedValue(new Error("offline"));

    await act(async () => {
      render(<SettingsPanel />);
    });

    expect(document.body).toHaveAttribute("data-font-size","large");
    expect(document.body).toHaveAttribute("data-font-family","ibm-plex");
    expect(document.documentElement).toHaveAttribute("data-gradient-theme","ocean");
  });

  it("overrides the device cache with account preferences",async () => {
    localStorage.setItem("caipe-font-size","small");
    mockGetSettings.mockResolvedValue({
      preferences: {
        font_size: "x-large",
        font_family: "source-sans",
        gradient_theme: "sunset",
        theme: "nord",
      },
    });

    render(<SettingsPanel />);

    await waitFor(() => {
      expect(document.body).toHaveAttribute("data-font-size","x-large");
      expect(document.body).toHaveAttribute("data-font-family","source-sans");
      expect(document.documentElement).toHaveAttribute("data-gradient-theme","sunset");
      expect(mockSetTheme).toHaveBeenCalledWith("nord");
    });
  });
});
