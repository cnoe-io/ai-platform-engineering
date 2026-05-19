import { act, renderHook, waitFor } from "@testing-library/react";

const mockPush = jest.fn();
const mockUseSession = jest.fn();
const mockUseVersion = jest.fn();
const mockUseAdminRole = jest.fn();

jest.mock("next/navigation", () => ({
  useRouter: () => ({ push: mockPush }),
}));

jest.mock("next-auth/react", () => ({
  useSession: () => mockUseSession(),
}));

jest.mock("../use-version", () => ({
  useVersion: () => mockUseVersion(),
}));

jest.mock("../use-admin-role", () => ({
  useAdminRole: () => mockUseAdminRole(),
}));

import { useReleaseUpgradePrompt } from "../use-release-upgrade-prompt";

function jsonResponse(payload: unknown, ok = true): Response {
  return {
    ok,
    json: async () => payload,
  } as Response;
}

const changelogPayload = {
  releases: [
    {
      version: "0.5.1",
      date: "2026-05-19",
      sections: [{ type: "Features", items: [{ text: "Added migrations", scope: null }] }],
    },
  ],
  scopes: [],
};

describe("useReleaseUpgradePrompt", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    window.sessionStorage.clear();
    mockUseSession.mockReturnValue({
      status: "authenticated",
      data: { user: { email: "admin@example.com" } },
    });
    mockUseVersion.mockReturnValue({
      isLoading: false,
      versionInfo: { version: "0.5.1", packageVersion: "0.5.1", gitCommit: "abc", buildDate: "today" },
    });
    mockUseAdminRole.mockReturnValue({ isAdmin: true, loading: false });
    global.fetch = jest.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
      const href = String(url);
      if (href === "/api/settings") {
        return jsonResponse({
          success: true,
          data: {
            preferences: {
              releaseNotesDismissedVersions: [],
              releaseNotesDismissedAnnouncementIds: [],
            },
          },
        });
      }
      if (href === "/api/changelog") {
        return jsonResponse(changelogPayload);
      }
      if (href === "/api/admin/platform-config") {
        return jsonResponse({
          success: true,
          data: {
            release_notes: {
              enabled: true,
              release_version: "0.5.1",
              announcement_revision: 1,
              announcement_id: "0.5.1:revision-1",
              show_toast: true,
              toast_duration_ms: 8000,
              show_migration_cta: true,
            },
          },
        });
      }
      if (href === "/api/settings/preferences" && init?.method === "PATCH") {
        return jsonResponse({ success: true });
      }
      return jsonResponse({}, false);
    }) as jest.Mock;
  });

  it("shows an admin prompt for an undismissed 0.5.x release", async () => {
    const { result } = renderHook(() => useReleaseUpgradePrompt());

    await waitFor(() => {
      expect(result.current.open).toBe(true);
    });

    expect(result.current.releaseVersion).toBe("0.5.1");
    expect(result.current.release?.sections[0].items[0].text).toBe("Added migrations");
    expect(result.current.isAdmin).toBe(true);
  });

  it("opens the migration assistant and suppresses the prompt for the current session", async () => {
    const { result } = renderHook(() => useReleaseUpgradePrompt());

    await waitFor(() => expect(result.current.open).toBe(true));

    act(() => result.current.openMigrationAssistant());

    expect(mockPush).toHaveBeenCalledWith("/admin?cat=security&tab=migrations");
    expect(window.sessionStorage.getItem("release-notes:0.5.1:revision-1:skip")).toBe("true");
    expect(result.current.open).toBe(false);
  });

  it("stores admin skip until next login only in sessionStorage", async () => {
    const { result } = renderHook(() => useReleaseUpgradePrompt());

    await waitFor(() => expect(result.current.open).toBe(true));

    act(() => result.current.skipUntilNextLogin());

    expect(window.sessionStorage.getItem("release-notes:0.5.1:revision-1:skip")).toBe("true");
    expect(global.fetch).not.toHaveBeenCalledWith("/api/settings/preferences", expect.anything());
    expect(result.current.open).toBe(false);
  });

  it("stores permanent dismissal in user preferences", async () => {
    const { result } = renderHook(() => useReleaseUpgradePrompt());

    await waitFor(() => expect(result.current.open).toBe(true));

    await act(async () => {
      await result.current.dismissPermanently();
    });

    expect(global.fetch).toHaveBeenCalledWith(
      "/api/settings/preferences",
      expect.objectContaining({
        method: "PATCH",
        body: JSON.stringify({
          releaseNotesDismissedVersions: ["0.5.1"],
          releaseNotesDismissedAnnouncementIds: ["0.5.1:revision-1"],
        }),
      }),
    );
    expect(result.current.open).toBe(false);
  });

  it("shows non-admin release notes without admin mode and permanently dismisses", async () => {
    mockUseAdminRole.mockReturnValue({ isAdmin: false, loading: false });
    const { result } = renderHook(() => useReleaseUpgradePrompt());

    await waitFor(() => expect(result.current.open).toBe(true));

    expect(result.current.isAdmin).toBe(false);

    await act(async () => {
      await result.current.dismissPermanently();
    });

    expect(global.fetch).toHaveBeenCalledWith(
      "/api/settings/preferences",
      expect.objectContaining({
        method: "PATCH",
        body: JSON.stringify({
          releaseNotesDismissedVersions: ["0.5.1"],
          releaseNotesDismissedAnnouncementIds: ["0.5.1:revision-1"],
        }),
      }),
    );
  });

  it("uses admin-managed config to show future release notes", async () => {
    mockUseVersion.mockReturnValue({
      isLoading: false,
      versionInfo: { version: "0.6.0", packageVersion: "0.6.0", gitCommit: "abc", buildDate: "today" },
    });
    (global.fetch as jest.Mock).mockImplementation(async (url: RequestInfo | URL) => {
      const href = String(url);
      if (href === "/api/settings") {
        return jsonResponse({
          success: true,
          data: { preferences: { releaseNotesDismissedAnnouncementIds: [] } },
        });
      }
      if (href === "/api/admin/platform-config") {
        return jsonResponse({
          success: true,
          data: {
            release_notes: {
              enabled: true,
              release_version: "0.6.0",
              announcement_revision: 7,
              announcement_id: "0.6.0:revision-7",
              show_toast: false,
              toast_duration_ms: 5000,
              show_migration_cta: false,
            },
          },
        });
      }
      if (href === "/api/changelog") {
        return jsonResponse({
          releases: [
            {
              version: "0.6.0",
              date: "2026-06-01",
              sections: [{ type: "Features", items: [{ text: "Future release", scope: null }] }],
            },
          ],
        });
      }
      return jsonResponse({}, false);
    });

    const { result } = renderHook(() => useReleaseUpgradePrompt());

    await waitFor(() => expect(result.current.open).toBe(true));
    expect(result.current.releaseVersion).toBe("0.6.0");
    expect(result.current.announcementId).toBe("0.6.0:revision-7");
    expect(result.current.showMigrationCta).toBe(false);
  });

  it("uses the deployed version as the default announcement when admins have not configured release notes", async () => {
    mockUseVersion.mockReturnValue({
      isLoading: false,
      versionInfo: { version: "0.6.0", packageVersion: "0.6.0", gitCommit: "abc", buildDate: "today" },
    });
    (global.fetch as jest.Mock).mockImplementation(async (url: RequestInfo | URL) => {
      const href = String(url);
      if (href === "/api/settings") {
        return jsonResponse({
          success: true,
          data: { preferences: { releaseNotesDismissedAnnouncementIds: [] } },
        });
      }
      if (href === "/api/admin/platform-config") {
        return jsonResponse({
          success: true,
          data: {
            release_notes: {
              enabled: true,
              release_version: null,
              announcement_revision: 1,
              announcement_id: "release:revision-1",
              show_toast: false,
              toast_duration_ms: 5000,
              show_migration_cta: true,
            },
          },
        });
      }
      if (href === "/api/changelog") {
        return jsonResponse({
          releases: [
            {
              version: "0.6.0",
              date: "2026-06-01",
              sections: [{ type: "Features", items: [{ text: "Future release", scope: null }] }],
            },
          ],
        });
      }
      return jsonResponse({}, false);
    });

    const { result } = renderHook(() => useReleaseUpgradePrompt());

    await waitFor(() => expect(result.current.open).toBe(true));
    expect(result.current.releaseVersion).toBe("0.6.0");
    expect(result.current.announcementId).toBe("0.6.0:revision-1");
  });

  it("does not expose the migration assistant CTA state to non-admin users", async () => {
    mockUseAdminRole.mockReturnValue({ isAdmin: false, loading: false });

    const { result } = renderHook(() => useReleaseUpgradePrompt());

    await waitFor(() => expect(result.current.open).toBe(true));
    expect(result.current.isAdmin).toBe(false);
    expect(result.current.showMigrationCta).toBe(false);
  });

  it("suppresses only dismissed announcement revisions", async () => {
    (global.fetch as jest.Mock).mockImplementation(async (url: RequestInfo | URL) => {
      const href = String(url);
      if (href === "/api/settings") {
        return jsonResponse({
          success: true,
          data: {
            preferences: {
              releaseNotesDismissedVersions: ["0.5.1"],
              releaseNotesDismissedAnnouncementIds: ["0.5.1:revision-1"],
            },
          },
        });
      }
      if (href === "/api/admin/platform-config") {
        return jsonResponse({
          success: true,
          data: {
            release_notes: {
              enabled: true,
              release_version: "0.5.1",
              announcement_revision: 2,
              announcement_id: "0.5.1:revision-2",
              show_toast: false,
              toast_duration_ms: 5000,
              show_migration_cta: true,
            },
          },
        });
      }
      if (href === "/api/changelog") return jsonResponse(changelogPayload);
      return jsonResponse({}, false);
    });

    const { result } = renderHook(() => useReleaseUpgradePrompt());

    await waitFor(() => expect(result.current.open).toBe(true));
    expect(result.current.announcementId).toBe("0.5.1:revision-2");
  });

  it("does not show for unauthenticated users or dismissed releases", async () => {
    (global.fetch as jest.Mock).mockImplementation(async (url: RequestInfo | URL) => {
      const href = String(url);
      if (href === "/api/settings") {
        return jsonResponse({ success: true, data: { preferences: {} } });
      }
      if (href === "/api/admin/platform-config") {
        return jsonResponse({ success: true, data: {} });
      }
      if (href === "/api/changelog") return jsonResponse(changelogPayload);
      return jsonResponse({}, false);
    });
    mockUseVersion.mockReturnValue({
      isLoading: false,
      versionInfo: { version: "0.5.1", packageVersion: "0.5.1", gitCommit: "abc", buildDate: "today" },
    });
    mockUseSession.mockReturnValue({ status: "unauthenticated", data: null });
    const unauthenticated = renderHook(() => useReleaseUpgradePrompt());
    await waitFor(() => expect(unauthenticated.result.current.isLoading).toBe(false));
    expect(unauthenticated.result.current.open).toBe(false);

    mockUseSession.mockReturnValue({
      status: "authenticated",
      data: { user: { email: "admin@example.com" } },
    });
    (global.fetch as jest.Mock).mockImplementation(async (url: RequestInfo | URL) => {
      if (String(url) === "/api/settings") {
        return jsonResponse({
          success: true,
          data: { preferences: { releaseNotesDismissedVersions: ["0.5.1"] } },
        });
      }
      if (String(url) === "/api/admin/platform-config") {
        return jsonResponse({
          success: true,
          data: {
            release_notes: {
              enabled: true,
              release_version: null,
              announcement_revision: 1,
              announcement_id: "release:revision-1",
              show_toast: false,
              toast_duration_ms: 5000,
              show_migration_cta: true,
            },
          },
        });
      }
      if (String(url) === "/api/changelog") return jsonResponse(changelogPayload);
      return jsonResponse({}, false);
    });
    const dismissed = renderHook(() => useReleaseUpgradePrompt());
    await waitFor(() => expect(dismissed.result.current.isLoading).toBe(false));
    expect(dismissed.result.current.open).toBe(false);
  });
});
