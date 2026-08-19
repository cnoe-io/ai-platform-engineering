/**
 * @jest-environment jsdom
 */

import { act,waitFor } from "@testing-library/react";

const getSettingsMock = jest.fn();
const updatePreferencesMock = jest.fn();

jest.mock("@/lib/api-client",() => ({
  apiClient: {
    getSettings: (...args: unknown[]) => getSettingsMock(...args),
    updatePreferences: (...args: unknown[]) => updatePreferencesMock(...args),
  },
}));

let mockStorageMode = "mongodb";
jest.mock("@/lib/storage-config",() => ({
  getStorageMode: () => mockStorageMode,
}));

import { HOME_WIDGET_DEFINITIONS,useHomeWidgetsStore } from "@/store/home-widgets-store";

describe("home widgets store",() => {
  beforeEach(() => {
    localStorage.clear();
    jest.clearAllMocks();
    mockStorageMode = "mongodb";
    useHomeWidgetsStore.setState({
      widgets: [],
      experience: "new",
      initialized: false,
      touched: false,
    });
  });

  it("starts with no widgets enabled",() => {
    expect(useHomeWidgetsStore.getState().widgets).toEqual([]);
    expect(useHomeWidgetsStore.getState().isEnabled("recentChats")).toBe(false);
  });

  it("addWidget enables a widget and persists it to localStorage immediately",() => {
    act(() => useHomeWidgetsStore.getState().addWidget("recentChats"));

    expect(useHomeWidgetsStore.getState().widgets).toEqual(["recentChats"]);
    expect(JSON.parse(localStorage.getItem("caipe-home-widgets") || "[]")).toEqual(["recentChats"]);
  });

  it("addWidget is idempotent for an already-enabled widget",() => {
    act(() => useHomeWidgetsStore.getState().addWidget("recentChats"));
    act(() => useHomeWidgetsStore.getState().addWidget("recentChats"));

    expect(useHomeWidgetsStore.getState().widgets).toEqual(["recentChats"]);
  });

  it("removeWidget disables a widget",() => {
    act(() => useHomeWidgetsStore.getState().addWidget("recentChats"));
    act(() => useHomeWidgetsStore.getState().removeWidget("recentChats"));

    expect(useHomeWidgetsStore.getState().widgets).toEqual([]);
    expect(JSON.parse(localStorage.getItem("caipe-home-widgets") || "[]")).toEqual([]);
  });

  it("fires a best-effort sync to the server on add/remove",() => {
    updatePreferencesMock.mockResolvedValue({});
    act(() => useHomeWidgetsStore.getState().addWidget("shortcuts"));

    expect(updatePreferencesMock).toHaveBeenCalledWith({ home_widgets: ["shortcuts"] });
  });

  it("reorderWidgets updates the order and persists it",() => {
    act(() => useHomeWidgetsStore.getState().addWidget("recentChats"));
    act(() => useHomeWidgetsStore.getState().addWidget("shortcuts"));

    act(() => useHomeWidgetsStore.getState().reorderWidgets(["shortcuts","recentChats"]));

    expect(useHomeWidgetsStore.getState().widgets).toEqual(["shortcuts","recentChats"]);
    expect(JSON.parse(localStorage.getItem("caipe-home-widgets") || "[]")).toEqual(["shortcuts","recentChats"]);
  });

  it("reorderWidgets ignores an order that isn't a permutation of the current widgets",() => {
    act(() => useHomeWidgetsStore.getState().addWidget("recentChats"));
    act(() => useHomeWidgetsStore.getState().addWidget("shortcuts"));

    act(() => useHomeWidgetsStore.getState().reorderWidgets(["shortcuts","recentChats","insights"]));

    expect(useHomeWidgetsStore.getState().widgets).toEqual(["recentChats","shortcuts"]);
  });

  it("availableToAdd excludes already-enabled widgets",() => {
    act(() => useHomeWidgetsStore.getState().addWidget("recentChats"));

    const available = useHomeWidgetsStore.getState().availableToAdd();
    expect(available.some((w) => w.id === "recentChats")).toBe(false);
    expect(available.some((w) => w.id === "shortcuts")).toBe(true);
  });

  it("availableToAdd excludes Mongo-only widgets in localStorage mode",() => {
    mockStorageMode = "localStorage";
    const available = useHomeWidgetsStore.getState().availableToAdd();
    const mongoOnlyIds = HOME_WIDGET_DEFINITIONS.filter((w) => w.requiresMongo).map((w) => w.id);

    expect(mongoOnlyIds.length).toBeGreaterThan(0);
    for (const id of mongoOnlyIds) {
      expect(available.some((w) => w.id === id)).toBe(false);
    }
  });

  it("initialize hydrates from localStorage first, then merges untouched server state",async () => {
    localStorage.setItem("caipe-home-widgets", JSON.stringify(["shortcuts"]));
    getSettingsMock.mockResolvedValue({
      preferences: { home_widgets: ["shortcuts", "recentChats"] },
    });

    act(() => useHomeWidgetsStore.getState().initialize());

    // Local value is applied synchronously, before the server round-trip resolves.
    expect(useHomeWidgetsStore.getState().widgets).toEqual(["shortcuts"]);

    await waitFor(() => {
      expect(useHomeWidgetsStore.getState().widgets).toEqual(["shortcuts", "recentChats"]);
    });
  });

  it("filters the retired welcome banner widget from saved preferences",async () => {
    localStorage.setItem("caipe-home-widgets", JSON.stringify(["welcomeBanner", "shortcuts"]));
    getSettingsMock.mockResolvedValue({
      preferences: { home_widgets: ["welcomeBanner", "recentChats"] },
    });

    act(() => useHomeWidgetsStore.getState().initialize());

    expect(useHomeWidgetsStore.getState().widgets).toEqual(["shortcuts"]);
    await waitFor(() => {
      expect(useHomeWidgetsStore.getState().widgets).toEqual(["recentChats"]);
    });
  });

  it("does not let late hydration overwrite a newer interaction",async () => {
    let resolveSettings!: (value: unknown) => void;
    getSettingsMock.mockReturnValue(new Promise((resolve) => {
      resolveSettings = resolve;
    }));

    act(() => useHomeWidgetsStore.getState().initialize());
    act(() => useHomeWidgetsStore.getState().addWidget("recentChats"));
    await act(async () => {
      resolveSettings({ preferences: { home_widgets: ["shortcuts"] } });
      await Promise.resolve();
    });

    expect(getSettingsMock).toHaveBeenCalledTimes(1);
    expect(useHomeWidgetsStore.getState().widgets).toEqual(["recentChats"]);
  });

  describe("experience toggle",() => {
    it("defaults to the new experience",() => {
      expect(useHomeWidgetsStore.getState().experience).toBe("new");
    });

    it("setExperience switches to classic and persists it to localStorage",() => {
      act(() => useHomeWidgetsStore.getState().setExperience("classic"));

      expect(useHomeWidgetsStore.getState().experience).toBe("classic");
      expect(localStorage.getItem("caipe-home-experience")).toBe("classic");
    });

    it("setExperience fires a best-effort sync to the server",() => {
      updatePreferencesMock.mockResolvedValue({});
      act(() => useHomeWidgetsStore.getState().setExperience("classic"));

      expect(updatePreferencesMock).toHaveBeenCalledWith({ home_experience: "classic" });
    });

    it("initialize hydrates the experience from localStorage first",() => {
      localStorage.setItem("caipe-home-experience", "classic");
      getSettingsMock.mockReturnValue(new Promise(() => {}));

      act(() => useHomeWidgetsStore.getState().initialize());

      expect(useHomeWidgetsStore.getState().experience).toBe("classic");
    });

    it("initialize merges an untouched server experience choice",async () => {
      getSettingsMock.mockResolvedValue({ preferences: { home_experience: "classic" } });

      act(() => useHomeWidgetsStore.getState().initialize());

      await waitFor(() => {
        expect(useHomeWidgetsStore.getState().experience).toBe("classic");
      });
      expect(localStorage.getItem("caipe-home-experience")).toBe("classic");
    });
  });
});
