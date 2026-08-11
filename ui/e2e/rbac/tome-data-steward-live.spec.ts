import { randomUUID } from "node:crypto";

import { expect, test, type Page } from "@playwright/test";

import { rbacEnvOrSkip, type RbacEnv } from "./_env";
import { installTestSession } from "./_helpers";

/**
 * Opt-in live boundary test. It uses an existing bootstrap admin only to add a
 * temporary team membership for a synthetic viewer, then removes that tuple in
 * `finally`. Set TOME_RBAC_E2E_SLUG to a shared Tome entity before running
 * `npm run test:e2e:rbac-live-tome`.
 */
type ApiResult<T = unknown> = {
  status: number;
  body: T;
};

type ProjectResponse = {
  data?: {
    project?: {
      slug?: string;
      team_slug?: string;
      type?: "project" | "area" | "bhag";
    };
  };
};

type PagesResponse = {
  data?: {
    canEdit?: boolean;
    canManageSteward?: boolean;
  };
};

type ErrorResponse = {
  error?: string;
  code?: string;
};

type TupleKey = {
  user: string;
  relation: string;
  object: string;
};

async function fetchJson<T = unknown>(
  page: Page,
  path: string,
  init?: RequestInit,
): Promise<ApiResult<T>> {
  return page.evaluate(
    async ({ requestPath, requestInit }) => {
      const response = await fetch(requestPath, requestInit);
      let body: unknown = null;
      try {
        body = await response.json();
      } catch {
        body = await response.text();
      }
      return { status: response.status, body };
    },
    { requestPath: path, requestInit: init },
  ) as Promise<ApiResult<T>>;
}

async function installSession(
  page: Page,
  env: RbacEnv,
  input: { email: string; subject: string; role: "admin" | "user" },
): Promise<void> {
  await page.context().clearCookies();
  await installTestSession(page, env, {
    ...input,
    canViewAdmin: input.role === "admin",
  });
  await page.goto("/", { waitUntil: "domcontentloaded" });
}

async function writeTuples(
  page: Page,
  body: { writes?: TupleKey[]; deletes?: TupleKey[] },
): Promise<ApiResult> {
  return fetchJson(page, "/api/admin/openfga/tuples", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

async function suppressReleaseDialog(page: Page): Promise<void> {
  await page.route("**/api/admin/platform-config", async (route) => {
    if (route.request().method() !== "GET") {
      await route.continue();
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        success: true,
        data: { release_notes: { enabled: false } },
      }),
    });
  });
}

async function dismissTomeOnboarding(page: Page): Promise<void> {
  const dialog = page.getByRole("dialog").filter({
    has: page.getByRole("img", { name: "TOME" }),
  });
  if (await dialog.waitFor({ state: "visible", timeout: 3_000 }).then(
    () => true,
    () => false,
  )) {
    await dialog.getByRole("button", { name: "Close" }).click();
    await expect(dialog).toBeHidden();
  }
}

test.describe("Tome data-steward RBAC (live OpenFGA)", () => {
  test("team reader can view but cannot ingest or edit pages", async ({ page }) => {
    const env = rbacEnvOrSkip({ requireUserSub: true });
    const slug = process.env.TOME_RBAC_E2E_SLUG?.trim();
    test.skip(!slug, "TOME_RBAC_E2E_SLUG must identify a shared live Tome entity.");

    const suffix = `${Date.now()}-${randomUUID().slice(0, 8)}`;
    const viewerSubject = `e2e-tome-viewer-${suffix}`;
    const viewerEmail = `tome-viewer-${suffix}@example.test`;

    await suppressReleaseDialog(page);
    await installSession(page, env, {
      email: env.user.email,
      subject: env.user.sub!,
      role: "admin",
    });

    const projectResult = await fetchJson<ProjectResponse>(
      page,
      `/api/projects/${encodeURIComponent(slug!)}`,
    );
    expect(projectResult.status, JSON.stringify(projectResult.body)).toBe(200);

    const project = projectResult.body.data?.project;
    const teamSlug = project?.team_slug;
    expect(teamSlug, JSON.stringify(projectResult.body)).toBeTruthy();

    const readerMembership: TupleKey = {
      user: `user:${viewerSubject}`,
      relation: "member",
      object: `team:${teamSlug}`,
    };

    try {
      const grant = await writeTuples(page, { writes: [readerMembership] });
      expect(grant.status, JSON.stringify(grant.body)).toBe(200);

      await installSession(page, env, {
        email: viewerEmail,
        subject: viewerSubject,
        role: "user",
      });

      const pages = await fetchJson<PagesResponse>(
        page,
        `/api/tome/projects/${encodeURIComponent(slug!)}/pages`,
      );
      expect(pages.status, JSON.stringify(pages.body)).toBe(200);
      expect(pages.body.data?.canEdit).toBe(false);
      expect(pages.body.data?.canManageSteward).toBe(false);

      const deniedWrite = await fetchJson<ErrorResponse>(
        page,
        `/api/tome/projects/${encodeURIComponent(slug!)}/pages/e2e-authorization-probe`,
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          // Deliberately invalid: if authorization regresses, validation returns 400
          // without writing a page. Correct behavior rejects it earlier with 403.
          body: JSON.stringify({}),
        },
      );
      expect(deniedWrite.status, JSON.stringify(deniedWrite.body)).toBe(403);
      expect(deniedWrite.body.code).toBe("DATA_STEWARD_REQUIRED");

      await page.goto(
        `/projects/${encodeURIComponent(slug!)}/tome/ingest`,
        { waitUntil: "domcontentloaded" },
      );
      await dismissTomeOnboarding(page);
      const runLabel = project?.type === "project" ? "Run ingest" : "Ingest & synthesize";
      const runButton = page.getByRole("main").getByRole("button", {
        name: runLabel,
        exact: true,
      });
      await expect(runButton).toBeDisabled();
      await runButton.locator("..").hover();
      await expect(page.getByText("Project view only access", { exact: true })).toBeVisible();

      await page.goto(
        `/projects/${encodeURIComponent(slug!)}/tome/settings`,
        { waitUntil: "domcontentloaded" },
      );
      await expect(page.getByText("Read only.", { exact: false })).toBeVisible();
      const saveButton = page.getByRole("button", { name: "Save changes" });
      await expect(saveButton).toBeDisabled();
      await saveButton.locator("..").hover();
      await expect(page.getByText("Project view only access", { exact: true })).toBeVisible();
      await expect(page.getByRole("button", { name: "Import pages" })).toHaveCount(0);
      await expect(page.getByRole("button", { name: "New page" })).toHaveCount(0);
    } finally {
      await installSession(page, env, {
        email: env.user.email,
        subject: env.user.sub!,
        role: "admin",
      });
      const cleanup = await writeTuples(page, { deletes: [readerMembership] });
      expect(cleanup.status, JSON.stringify(cleanup.body)).toBe(200);
    }
  });
});
