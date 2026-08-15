// assisted-by Codex Codex-sonnet-4-6

import { expect, test } from "@playwright/test";

import {
  fulfillJson,
  installMockedRbacApp,
  mockedRbacEnabled,
  postJson,
} from "./_mocked-rbac";

const adminSession = {
  email: "admin@example.test",
  name: "Example Admin",
  role: "admin" as const,
  canViewAdmin: true,
};

type ReleaseNotesConfig = {
  enabled: boolean;
  repository_url: string | null;
  previous_commit: string | null;
  latest_commit: string | null;
};

test.describe("mocked admin settings browser regression", () => {
  test.beforeEach(() => {
    test.skip(
      !mockedRbacEnabled(),
      "Set RUN_RBAC_REGRESSION=1 to run the mocked RBAC browser regression.",
    );
  });

  test("defaults bare admin route to Settings General", async ({ page }) => {
    await installMockedRbacApp(page, {
      isAdmin: true,
      session: adminSession,
    });

    await page.goto("/admin", { waitUntil: "domcontentloaded" });

    await expect(page).toHaveURL(/\/admin\?cat=settings&tab=settings$/);
    await expect(page.getByRole("button", { name: "Settings", exact: true })).toHaveAttribute("aria-pressed", "true");
    await expect(page.getByRole("tab", { name: "General" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    await expect(page.getByRole("tab", { name: "Default Agent" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Manage Unlinked Access" })).toBeVisible();
  });

  test("does not expose the removed Knowledge Bases settings tab", async ({ page }) => {
    await installMockedRbacApp(page, {
      isAdmin: true,
      session: adminSession,
    });

    await page.goto("/admin?cat=settings&tab=rag-access", {
      waitUntil: "domcontentloaded",
    });

    await expect(page).toHaveURL(/\/admin\?cat=settings&tab=settings$/);
    await expect(page.getByRole("button", { name: "Settings", exact: true })).toHaveAttribute("aria-pressed", "true");
    await expect(page.getByRole("tab", { name: "General" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    await expect(page.getByRole("tab", { name: "Knowledge Bases" })).toHaveCount(0);
    await expect(page.getByText("RAG Team Access")).toHaveCount(0);
  });

  test("explains Unlinked Access on the settings card and modal", async ({ page }) => {
    await installMockedRbacApp(page, {
      isAdmin: true,
      session: adminSession,
    });

    await page.goto("/admin?cat=settings&tab=settings", {
      waitUntil: "domcontentloaded",
    });

    await expect(page.getByText(/Set the starting access for people who message/)).toBeVisible();
    await expect(page.getByText(/before they have signed in to the web UI/)).toBeVisible();
    await expect(
      page.getByText(/available to every unlinked caller and bot/),
    ).toBeVisible();

    await page.getByRole("button", { name: "Manage Unlinked Access" }).click();

    const dialog = page.getByRole("dialog", { name: "Unlinked Access" });
    await expect(dialog).toBeVisible();
    await expect(
      dialog.getByText(/Set the starting access for people who message/),
    ).toBeVisible();
    await expect(dialog.getByText(/available to every unlinked caller and bot/)).toBeVisible();
  });

  test("persists an admin commit range and renders its diff after reload", async ({ page }) => {
    let releaseNotesConfig: ReleaseNotesConfig = {
      enabled: false,
      repository_url: null,
      previous_commit: null,
      latest_commit: null,
    };
    let savedPayload: ReleaseNotesConfig | null = null;
    let compareRequest: URL | null = null;

    await installMockedRbacApp(page, {
      isAdmin: true,
      session: adminSession,
      handlers: [async ({ route, url, path, method }) => {
        if (path === "/api/admin/platform-config" && method === "GET") {
          await fulfillJson(route, {
            success: true,
            data: { release_notes: releaseNotesConfig },
          });
          return true;
        }

        if (path === "/api/admin/platform-config" && method === "PATCH") {
          const body = await postJson(route) as { release_notes?: ReleaseNotesConfig } | null;
          if (!body?.release_notes) {
            await fulfillJson(route, { success: false }, 400);
            return true;
          }
          releaseNotesConfig = { ...body.release_notes };
          savedPayload = releaseNotesConfig;
          await fulfillJson(route, {
            success: true,
            data: { release_notes: releaseNotesConfig },
          });
          return true;
        }

        if (path === "/api/settings") {
          await fulfillJson(route, {
            success: true,
            data: {
              preferences: {
                releaseNotesNotificationsEnabled: true,
                releaseNotesDismissedVersions: [],
              },
            },
          });
          return true;
        }

        if (path === "/api/changelog") {
          await fulfillJson(route, { releases: [] });
          return true;
        }

        if (path === "/api/version") {
          await fulfillJson(route, {
            version: "playwright",
            packageVersion: "playwright",
            gitCommit: "e2e",
            buildDate: "2026-08-15T00:00:00.000Z",
          });
          return true;
        }

        if (path === "/api/release-notes") {
          compareRequest = url;
          await fulfillJson(route, {
            requestedVersion: "playwright",
            matchedVersion: "playwright",
            title: "Changes 1111111 → 2222222",
            date: "2026-08-15",
            body: "> Changes from `1111111` through `2222222`.\n\n## What's New\n\n- **ui**: Configured browser regression\n\n[Compare all changes](https://github.com/example/repository/compare/1111111...2222222)",
            source: "github-compare",
            changelogUrl: "https://github.com/example/repository/compare/1111111...2222222",
          });
          return true;
        }

        return false;
      }],
    });

    await page.goto("/admin?cat=settings&tab=settings", {
      waitUntil: "domcontentloaded",
    });

    await page.getByLabel("Enable release notes notification").check();
    await page.getByLabel("Repository URL").fill("https://github.com/example/repository");
    await page.getByLabel("Previous upgraded commit").fill("1111111");
    await page.getByLabel("Latest commit").fill("2222222");
    await page.getByRole("button", { name: "Save release notes settings" }).click();

    await expect.poll(() => savedPayload).toEqual({
      enabled: true,
      repository_url: "https://github.com/example/repository",
      previous_commit: "1111111",
      latest_commit: "2222222",
    });

    await page.reload({ waitUntil: "domcontentloaded" });

    await expect(page.getByLabel("Repository URL")).toHaveValue(
      "https://github.com/example/repository",
    );
    await expect(page.getByLabel("Previous upgraded commit")).toHaveValue("1111111");
    await expect(page.getByLabel("Latest commit")).toHaveValue("2222222");

    const dialog = page.getByRole("dialog", { name: "What's new in playwright" });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByText("Configured browser regression")).toBeVisible();
    await expect(dialog.getByRole("link", { name: "Compare all changes" })).toHaveAttribute(
      "href",
      "https://github.com/example/repository/compare/1111111...2222222",
    );
    await expect.poll(() => compareRequest?.searchParams.get("compare") ?? null).toBe("platform");
  });

  test("keeps the deployed-version release notes behavior when no range is configured", async ({
    page,
  }) => {
    let releaseNotesRequests = 0;

    await installMockedRbacApp(page, {
      isAdmin: true,
      session: adminSession,
      handlers: [async ({ route, path }) => {
        if (path === "/api/changelog") {
          await fulfillJson(route, {
            releases: [{
              version: "playwright",
              date: "2026-08-15",
              sections: [{
                type: "Highlights",
                items: [{ text: "Legacy curated release note", scope: null }],
              }],
            }],
          });
          return true;
        }

        if (path === "/api/release-notes") {
          releaseNotesRequests += 1;
          await fulfillJson(route, { matchedVersion: null, body: null });
          return true;
        }

        return false;
      }],
    });

    await page.goto("/admin?cat=settings&tab=settings", {
      waitUntil: "domcontentloaded",
    });

    await expect(page.getByLabel("Repository URL")).toHaveValue("");
    await expect(page.getByLabel("Previous upgraded commit")).toHaveValue("");
    await expect(page.getByLabel("Latest commit")).toHaveValue("");
    await page.getByRole("button", { name: "Show release notes popup" }).click();

    const dialog = page.getByRole("dialog", { name: "What's new in playwright" });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByText("Legacy curated release note")).toBeVisible();
    expect(releaseNotesRequests).toBe(0);
  });
});
