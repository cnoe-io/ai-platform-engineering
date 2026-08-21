import { expect, test } from "@playwright/test";

import {
  fulfillJson,
  installMockedRbacApp,
  mockedRbacEnabled,
  postJson,
  type MockRouteHandler,
} from "./_mocked-rbac";

const SLUG = "example-project";
const PAGE_PATH = "charter.md";
const GIST_ID = "example-gist";
const TINY_PNG_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";

type MediaState = {
  markdown: string;
  writes: Array<{ markdown: string; message: string }>;
};

function pageMarkdown(body: string): string {
  return ["---", "title: Charter", "kind: stable", "---", "", body].join("\n");
}

function mediaHandler(state: MediaState): MockRouteHandler {
  return async ({ route, path, method, url }) => {
    if (path === "/api/users/me" && method === "GET") {
      await fulfillJson(route, {
        success: true,
        data: {
          id: "example-steward-subject",
          email: "steward@example.test",
          name: "Example Steward",
          role: "user",
        },
      });
      return true;
    }
    if (path === `/api/tome/projects/${SLUG}/pages` && method === "GET") {
      await fulfillJson(route, {
        success: true,
        data: {
          slug: SLUG,
          tree: [{ path: PAGE_PATH, title: "Charter", kind: "stable", children: [] }],
          pages: { [PAGE_PATH]: state.markdown },
          canEdit: true,
          canManageSteward: false,
        },
      });
      return true;
    }
    if (path === `/api/tome/projects/${SLUG}/pages/${PAGE_PATH}` && method === "PUT") {
      const payload = (await postJson(route)) as {
        markdown?: string;
        message?: string;
      } | null;
      if (!payload?.markdown || !payload.message) {
        await fulfillJson(route, { success: false, error: "Invalid page write" }, 400);
        return true;
      }
      state.markdown = payload.markdown;
      state.writes.push({ markdown: payload.markdown, message: payload.message });
      await fulfillJson(route, { success: true, data: { path: PAGE_PATH } });
      return true;
    }
    if (path === `/api/tome/projects/${SLUG}/gists/${GIST_ID}` && method === "GET") {
      await fulfillJson(route, {
        success: true,
        data: {
          gist: {
            id: GIST_ID,
            title: "Example architecture gist",
            body: state.markdown,
            author: "test-user",
            created_at: "2026-08-21T12:00:00.000Z",
            tags: ["architecture"],
          },
        },
      });
      return true;
    }
    if (path === `/api/projects/${SLUG}` && method === "GET") {
      await fulfillJson(route, {
        success: true,
        data: {
          project: {
            _id: "example-project-id",
            type: "project",
            slug: SLUG,
            name: "Example Project",
            title: "Example Project",
            description: "Neutral editor media fixture.",
            status: "active",
            team_id: "example-team-id",
            team_slug: "example-team",
            team_name: "Example Team",
            owner_id: "owner@example.test",
            member_ids: [],
            tags: [],
            sources: { repos: [], confluence_url: "", webex_rooms: [] },
          },
          permissions: { can_read: true, can_edit: true, can_manage_steward: false },
        },
      });
      return true;
    }
    if (path === "/api/projects" && method === "GET" && url.searchParams.has("type")) {
      await fulfillJson(route, { success: true, data: { projects: [] } });
      return true;
    }
    if (path === `/api/tome/projects/${SLUG}/edges` && method === "GET") {
      await fulfillJson(route, {
        success: true,
        data: { outgoing: [], incoming: [], titles: {} },
      });
      return true;
    }
    if (path === `/api/tome/projects/${SLUG}/ingests` && method === "GET") {
      await fulfillJson(route, { success: true, data: { runs: [] } });
      return true;
    }
    return false;
  };
}

test.describe("Tome editor media (mocked)", () => {
  test.beforeEach(async ({ page }) => {
    test.skip(
      !mockedRbacEnabled(),
      "Set RUN_RBAC_REGRESSION=1 to run the mocked RBAC browser regression.",
    );
    await page.addInitScript(() => {
      window.localStorage.setItem("tome.onboarding.seen", "1");
    });
  });

  test("renders Mermaid fenced code as an SVG preview", async ({ page }) => {
    const state: MediaState = {
      markdown: pageMarkdown(
        ["# Example flow", "", "```mermaid", "flowchart LR", "  Start --> Finish", "```"].join(
          "\n",
        ),
      ),
      writes: [],
    };
    await installMockedRbacApp(page, {
      session: { email: "steward@example.test", name: "Example Steward" },
      handlers: [mediaHandler(state)],
    });

    await page.goto(`/projects/${SLUG}/tome/wiki/${PAGE_PATH}`, {
      waitUntil: "domcontentloaded",
    });

    const preview = page.locator(".milkdown-code-block .preview svg");
    await expect(preview).toBeVisible();
    await expect(preview).toHaveAttribute("aria-roledescription", "flowchart-v2");
    await expect(page.locator(".tome-mermaid-error")).toHaveCount(0);

    const inlineBox = await preview.boundingBox();
    await page.getByRole("button", { name: "Expand Mermaid diagram" }).click();

    const lightbox = page.getByRole("dialog", { name: "Mermaid diagram" });
    const expandedSvg = lightbox.locator(".tome-mermaid-lightbox-canvas svg");
    await expect(lightbox).toBeVisible();
    await expect(expandedSvg).toBeVisible();
    await expect
      .poll(async () => (await expandedSvg.boundingBox())?.width ?? 0)
      .toBeGreaterThan(inlineBox?.width ?? 0);

    const zoomReset = lightbox.getByRole("button", { name: "Reset Mermaid zoom" });
    const expandedWidth = (await expandedSvg.boundingBox())?.width ?? 0;
    await expect(zoomReset).toHaveText("100%");

    await lightbox.getByRole("button", { name: "Zoom out Mermaid diagram" }).click();
    await expect(zoomReset).toHaveText("75%");
    await expect
      .poll(async () => (await expandedSvg.boundingBox())?.width ?? 0)
      .toBeLessThan(expandedWidth);

    await lightbox.getByRole("button", { name: "Zoom in Mermaid diagram" }).click();
    await expect(zoomReset).toHaveText("100%");

    await page.keyboard.press("Escape");
    await expect(lightbox).toBeHidden();
  });

  test("renders Mermaid fenced code in a gist read view", async ({ page }) => {
    const state: MediaState = {
      markdown: [
        "# Example architecture",
        "",
        "```mermaid",
        "flowchart LR",
        "  Browser --> Grid",
        "  Grid --> App",
        "```",
      ].join("\n"),
      writes: [],
    };
    await installMockedRbacApp(page, {
      session: { email: "steward@example.test", name: "Example Steward" },
      handlers: [mediaHandler(state)],
    });

    await page.goto(`/projects/${SLUG}/tome/gists/${GIST_ID}`, {
      waitUntil: "domcontentloaded",
    });

    await expect(page.getByRole("heading", { name: "Example architecture gist" })).toBeVisible();
    const preview = page.locator(".milkdown-code-block .preview svg");
    await expect(preview).toBeVisible();
    await expect(preview).toHaveAttribute("aria-roledescription", "flowchart-v2");
    await expect(page.locator(".tome-mermaid-error")).toHaveCount(0);
    await expect(page.getByText("plain text", { exact: true })).toHaveCount(0);

    await page.getByRole("button", { name: "Expand Mermaid diagram" }).click();
    await expect(page.getByRole("dialog", { name: "Mermaid diagram" })).toBeVisible();
  });

  test("persists a pasted image through the page save and reload flow", async ({ page }) => {
    const state: MediaState = {
      markdown: pageMarkdown("# Example charter\n\nPlace supporting evidence below."),
      writes: [],
    };
    await installMockedRbacApp(page, {
      session: { email: "steward@example.test", name: "Example Steward" },
      handlers: [mediaHandler(state)],
    });

    await page.goto(`/projects/${SLUG}/tome/wiki/${PAGE_PATH}`, {
      waitUntil: "domcontentloaded",
    });
    await page.getByRole("button", { name: "Edit", exact: true }).click();

    const editor = page.locator(".milkdown .ProseMirror[contenteditable='true']");
    await expect(editor).toBeVisible();
    await editor.click();
    await editor.evaluate((element, pngBase64) => {
      const bytes = Uint8Array.from(atob(pngBase64), (character) =>
        character.charCodeAt(0),
      );
      const file = new File([bytes], "example.png", { type: "image/png" });
      const clipboardData = new DataTransfer();
      clipboardData.items.add(file);
      element.dispatchEvent(
        new ClipboardEvent("paste", {
          bubbles: true,
          cancelable: true,
          clipboardData,
        }),
      );
    }, TINY_PNG_BASE64);

    const embeddedImage = page.locator(".milkdown img[src^='data:image/png;base64,']");
    await expect(embeddedImage).toBeVisible();
    await page.getByRole("button", { name: "Save", exact: true }).click();

    await expect.poll(() => state.writes.length).toBe(1);
    expect(state.writes[0].message).toBe(`edit ${PAGE_PATH}`);
    expect(state.writes[0].markdown).toContain("data:image/png;base64,");
    expect(state.writes[0].markdown).not.toContain("blob:");

    await page.reload({ waitUntil: "domcontentloaded" });
    await expect(page.locator(".milkdown img[src^='data:image/png;base64,']")).toBeVisible();
  });
});
