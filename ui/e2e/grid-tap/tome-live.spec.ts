import type { Page, TestInfo } from "@playwright/test";

import { gridTapEnvOrSkip } from "./_env";
import {
  api,
  apiResponse,
  attachEvidence,
  bestEffortCleanupTome,
  callTomeMcp,
  createTomeGist,
  createTomeProject,
  dataRecord,
  evidenceScreenshot,
  expect,
  expectTuple,
  installPersona,
  json,
  test,
  writeTomePage,
  type TomeProjectFixture,
} from "./_helpers";

const PAGE_PATH = "grid-tap/verification.md";
const YOUTUBE_ID = "M7lc1UVf-VE";
const VIDCAST_ID = "de4fc0eb-7146-4044-86a3-60c3cbd976a3";

function encodedPagePath(pagePath: string): string {
  return pagePath.split("/").map(encodeURIComponent).join("/");
}

function mcpText(body: unknown): string {
  if (!body || typeof body !== "object") return "";
  const result = (body as { result?: { content?: Array<{ text?: unknown }> } }).result;
  return (result?.content ?? [])
    .map((entry) => typeof entry.text === "string" ? entry.text : "")
    .join("\n");
}

function mcpIsError(body: unknown): boolean {
  if (!body || typeof body !== "object") return false;
  return Boolean((body as { result?: { isError?: unknown } }).result?.isError);
}

async function prepareTomeUi(page: Page): Promise<void> {
  const release = process.env.GRID_TAP_RELEASE?.trim() || "";
  const head = process.env.GRID_TAP_RELEASE_HEAD_REF?.trim() || "";
  await page.addInitScript(({ releaseVersion, releaseHead }) => {
    window.localStorage.setItem("tome.onboarding.seen", "1");
    if (releaseVersion) {
      window.sessionStorage.setItem(`release-notes:${releaseVersion}:skip`, "true");
      if (releaseHead) {
        window.sessionStorage.setItem(`release-notes:${releaseVersion}:${releaseHead}:skip`, "true");
      }
    }
  }, { releaseVersion: release, releaseHead: head });
}

async function attachTomeAuthorization(
  page: Page,
  testInfo: TestInfo,
  fixture: TomeProjectFixture,
): Promise<void> {
  const params = new URLSearchParams({ object: fixture.object, limit: "100" });
  const tuples = await api(page, `/api/admin/openfga/tuples?${params}`);
  expect(tuples.status, JSON.stringify(tuples.body)).toBe(200);
  await attachEvidence(testInfo, "tome-openfga", { fixture, tuples });
}

function seededMarkdown(marker: string): string {
  return [
    "---",
    "title: GRID TAP Verification",
    "kind: stable",
    "---",
    "",
    "# GRID TAP Verification",
    "",
    marker,
  ].join("\n");
}

function embedMarkdown(marker: string): string {
  return [
    "---",
    "title: GRID TAP Embeds",
    "kind: stable",
    "---",
    "",
    `# ${marker}`,
    "",
    "```youtube",
    `url: https://youtu.be/${YOUTUBE_ID}`,
    "  title: GRID TAP YouTube",
    "```",
    "",
    "```vidcast",
    `url: https://app.vidcast.io/share/embed/${VIDCAST_ID}`,
    "  title: GRID TAP Vidcast",
    "```",
    "",
    "```arxiv",
    "url: https://arxiv.org/abs/1706.03762",
    "  title: Attention Is All You Need",
    "```",
  ].join("\n");
}

function parseSseComplete(text: string): Record<string, unknown> | null {
  for (const frame of text.split("\n\n")) {
    const lines = frame.split("\n");
    if (!lines.some((line) => line.trim() === "event: complete")) continue;
    const data = lines
      .filter((line) => line.startsWith("data:"))
      .map((line) => line.slice(5).trim())
      .join("\n");
    const value = JSON.parse(data) as unknown;
    if (value && typeof value === "object" && !Array.isArray(value)) {
      return value as Record<string, unknown>;
    }
  }
  return null;
}

test.describe("GRID TAP TOME live release regression", () => {
  test("TOME-01 editor lifecycle, fullscreen, MCP convergence, and RBAC remain coherent", async ({ page }, testInfo) => {
    const env = gridTapEnvOrSkip();
    let fixture: TomeProjectFixture | undefined;
    await prepareTomeUi(page);
    await installPersona(page, env, "admin");
    const initialMarker = `${env.prefix}-initial`;
    const savedMarker = `${env.prefix}-saved`;
    const mcpMarker = `${env.prefix}-mcp`;

    try {
      fixture = await createTomeProject(page, env, "editor");
      await expectTuple(page, {
        user: `team:${env.teamSlug}#member`,
        relation: "reader",
        object: fixture.object,
      });
      await expectTuple(page, {
        user: `user:${fixture.stewardSubject}`,
        relation: "writer",
        object: fixture.object,
      });
      await writeTomePage(page, fixture, PAGE_PATH, seededMarkdown(initialMarker));
      await page.goto(
        `/projects/${encodeURIComponent(fixture.slug)}/tome/wiki/${encodedPagePath(PAGE_PATH)}`,
        { waitUntil: "domcontentloaded" },
      );
      await expect(page.getByText(initialMarker, { exact: true })).toBeVisible();

      const fullscreen = page.getByRole("button", { name: "Toggle full screen" });
      await expect(fullscreen).toBeVisible();
      await fullscreen.click();
      await expect.poll(() => page.evaluate(() => document.fullscreenElement !== null)).toBe(true);
      await fullscreen.click();
      await expect.poll(() => page.evaluate(() => document.fullscreenElement === null)).toBe(true);

      await page.getByRole("button", { name: "Edit", exact: true }).click();
      await page.getByRole("button", { name: "Raw", exact: true }).click();
      await page.getByLabel("Raw markdown editor").fill(`# Unsaved\n\n${env.prefix}-cancelled`);
      await page.getByRole("button", { name: "Cancel", exact: true }).click();
      await expect(page.getByText(initialMarker, { exact: true })).toBeVisible();

      await page.getByRole("button", { name: "Edit", exact: true }).click();
      await page.getByRole("button", { name: "Raw", exact: true }).click();
      await page.getByLabel("Raw markdown editor").fill(`# Saved\n\n${savedMarker}`);
      await page.getByRole("button", { name: "Preview", exact: true }).click();
      await expect(page.getByText(savedMarker, { exact: true })).toBeVisible();
      await page.getByRole("button", { name: "Edit", exact: true }).click();
      await page.getByRole("button", { name: "Save", exact: true }).click();

      const pageApi = `/api/tome/projects/${encodeURIComponent(fixture.slug)}/pages/${encodedPagePath(PAGE_PATH)}`;
      await expect.poll(async () => JSON.stringify((await api(page, pageApi)).body)).toContain(savedMarker);

      const mcpRead = await callTomeMcp(page, "tome_get_page", {
        project_slug: fixture.slug,
        page_path: PAGE_PATH,
      });
      expect(mcpRead.status, JSON.stringify(mcpRead.body)).toBe(200);
      expect(mcpText(mcpRead.body)).toContain(savedMarker);
      const mcpWrite = await callTomeMcp(page, "tome_edit_page", {
        project_slug: fixture.slug,
        page_path: PAGE_PATH,
        old_string: savedMarker,
        new_string: mcpMarker,
        message: "GRID TAP UI/MCP convergence",
      });
      expect(mcpWrite.status, JSON.stringify(mcpWrite.body)).toBe(200);
      expect(mcpIsError(mcpWrite.body), JSON.stringify(mcpWrite.body)).toBe(false);
      await page.reload({ waitUntil: "domcontentloaded" });
      await expect(page.getByText(mcpMarker, { exact: true })).toBeVisible();

      await installPersona(page, env, "member");
      const memberRead = await api(page, pageApi);
      expect(memberRead.status, JSON.stringify(memberRead.body)).toBe(200);
      const memberWrite = await api(page, pageApi, json("PUT", {
        markdown: seededMarkdown(`${env.prefix}-unauthorized`),
      }));
      expect(memberWrite.status, JSON.stringify(memberWrite.body)).toBe(403);
      const memberMcpWrite = await callTomeMcp(page, "tome_edit_page", {
        project_slug: fixture.slug,
        page_path: PAGE_PATH,
        markdown: seededMarkdown(`${env.prefix}-unauthorized-mcp`),
      });
      expect(memberMcpWrite.status, JSON.stringify(memberMcpWrite.body)).toBe(200);
      expect(mcpIsError(memberMcpWrite.body), JSON.stringify(memberMcpWrite.body)).toBe(true);
      await page.goto(
        `/projects/${encodeURIComponent(fixture.slug)}/tome/wiki/${encodedPagePath(PAGE_PATH)}`,
        { waitUntil: "domcontentloaded" },
      );
      await expect(page.getByRole("button", { name: "Edit", exact: true })).toBeDisabled();

      await installPersona(page, env, "admin");
      await attachTomeAuthorization(page, testInfo, fixture);
      await attachEvidence(testInfo, "tome-editor-contract", {
        project: fixture,
        pagePath: PAGE_PATH,
        markers: { initialMarker, savedMarker, mcpMarker },
        memberWrite,
        memberMcpWrite,
      });
      await evidenceScreenshot(page, testInfo, "TOME-01-editor-mcp-rbac");
    } finally {
      if (fixture) {
        await installPersona(page, env, "admin").catch(() => undefined);
        await bestEffortCleanupTome(page, fixture, { pages: [PAGE_PATH] });
      }
    }
  });

  test("TOME-02 real ingest, status, and agent retrieval preserve a unique marker", async ({ page }, testInfo) => {
    test.setTimeout(12 * 60_000);
    const env = gridTapEnvOrSkip();
    let fixture: TomeProjectFixture | undefined;
    let runId = "";
    const marker = `${env.prefix}-ingest-marker`;
    await prepareTomeUi(page);
    await installPersona(page, env, "admin");

    try {
      fixture = await createTomeProject(page, env, "ingest");
      const inaccessibleSource = "https://github.com/example/grid-tap-missing-source";
      const attachSource = await api(
        page,
        `/api/projects/${encodeURIComponent(fixture.slug)}`,
        json("PATCH", { sources: { repos: [inaccessibleSource] } }),
      );
      expect(attachSource.status, JSON.stringify(attachSource.body)).toBe(200);
      const blockedPreflight = await api(
        page,
        `/api/tome/projects/${encodeURIComponent(fixture.slug)}/preflight`,
        { method: "POST" },
      );
      expect(blockedPreflight.status, JSON.stringify(blockedPreflight.body)).toBe(200);
      expect(dataRecord(blockedPreflight).can_ingest, JSON.stringify(blockedPreflight.body)).toBe(false);
      expect(JSON.stringify(dataRecord(blockedPreflight).sources)).toContain("github");
      expect(String(dataRecord(blockedPreflight).credentials_url ?? "")).toContain("/credentials");
      const clearSource = await api(
        page,
        `/api/projects/${encodeURIComponent(fixture.slug)}`,
        json("PATCH", { sources: { repos: [] } }),
      );
      expect(clearSource.status, JSON.stringify(clearSource.body)).toBe(200);
      const preflight = await api(
        page,
        `/api/tome/projects/${encodeURIComponent(fixture.slug)}/preflight`,
        { method: "POST" },
      );
      expect(preflight.status, JSON.stringify(preflight.body)).toBe(200);
      expect(dataRecord(preflight).can_ingest, JSON.stringify(preflight.body)).toBe(true);

      const started = await api(
        page,
        `/api/tome/projects/${encodeURIComponent(fixture.slug)}/reingest`,
        json("POST", {
          seed: `Create a minimal verification wiki. Include this exact token verbatim on a stable page: ${marker}`,
          mode: "full",
          seedStablePages: true,
          skipReview: true,
        }),
      );
      expect(started.status, JSON.stringify(started.body)).toBe(200);
      runId = String(dataRecord(started).runId ?? "");
      expect(runId).not.toBe("");

      let terminal: Record<string, unknown> = {};
      await expect.poll(async () => {
        const result = await api(
          page,
          `/api/tome/projects/${encodeURIComponent(fixture!.slug)}/ingests/${encodeURIComponent(runId)}`,
        );
        expect(result.status, JSON.stringify(result.body)).toBe(200);
        terminal = dataRecord(result);
        return terminal.status;
      }, {
        timeout: 9 * 60_000,
        intervals: [2_000, 5_000, 10_000],
      }).toBe("succeeded");

      const pages = await api(
        page,
        `/api/tome/projects/${encodeURIComponent(fixture.slug)}/pages`,
      );
      expect(pages.status, JSON.stringify(pages.body)).toBe(200);
      expect(JSON.stringify(dataRecord(pages).pages)).toContain(marker);

      const logViaMcp = await callTomeMcp(page, "tome_get_ingest_log", {
        project_slug: fixture.slug,
        run_id: runId,
      });
      expect(logViaMcp.status, JSON.stringify(logViaMcp.body)).toBe(200);
      expect(mcpText(logViaMcp.body)).toContain("succeeded");
      const answer = await callTomeMcp(page, "tome_ask", {
        project_slug: fixture.slug,
        question: `Return the exact verification token from this wiki. It begins with ${env.prefix}.`,
      });
      expect(answer.status, JSON.stringify(answer.body)).toBe(200);
      expect(mcpIsError(answer.body), JSON.stringify(answer.body)).toBe(false);
      expect(mcpText(answer.body)).toContain(marker);

      await page.goto(`/projects/${encodeURIComponent(fixture.slug)}/tome/ingest`, {
        waitUntil: "domcontentloaded",
      });
      await attachEvidence(testInfo, "tome-ingest", {
        project: fixture,
        runId,
        marker,
        blockedPreflight: blockedPreflight.body,
        preflight: preflight.body,
        terminal,
        retrieval: answer.body,
      });
      await evidenceScreenshot(page, testInfo, "TOME-02-ingest-retrieval");
    } finally {
      if (fixture) {
        if (runId) {
          await api(
            page,
            `/api/tome/projects/${encodeURIComponent(fixture.slug)}/ingests/${encodeURIComponent(runId)}`,
            { method: "DELETE" },
          ).catch(() => undefined);
        }
        await bestEffortCleanupTome(page, fixture);
      }
    }
  });

  test("TOME-03 embeds render in wiki and gist, unsafe HTML is rejected, and edit-only removal persists", async ({ page }, testInfo) => {
    const env = gridTapEnvOrSkip();
    let fixture: TomeProjectFixture | undefined;
    let gistId = "";
    const marker = `${env.prefix}-embeds`;
    const markdown = embedMarkdown(marker);
    await prepareTomeUi(page);
    await installPersona(page, env, "admin");

    try {
      fixture = await createTomeProject(page, env, "embeds");
      const pageApi = `/api/tome/projects/${encodeURIComponent(fixture.slug)}/pages/${encodedPagePath(PAGE_PATH)}`;
      const blockedUnsafe = await api(page, pageApi, json("PUT", {
        markdown: `${markdown}\n\n<script>window.__gridTapTomeXss = true</script>`,
        message: "GRID TAP unsafe markup rejection",
      }));
      expect(blockedUnsafe.status, JSON.stringify(blockedUnsafe.body)).toBe(403);
      await writeTomePage(page, fixture, PAGE_PATH, markdown);
      gistId = await createTomeGist(page, fixture, {
        title: `${env.prefix} embed gist`,
        body: markdown,
        tags: ["grid-tap", "embed"],
      });

      await page.goto(
        `/projects/${encodeURIComponent(fixture.slug)}/tome/wiki/${encodedPagePath(PAGE_PATH)}`,
        { waitUntil: "domcontentloaded" },
      );
      await expect(page.locator(`iframe[src*="youtube-nocookie.com/embed/${YOUTUBE_ID}"]`)).toBeVisible();
      await expect(page.locator(`iframe[src*="app.vidcast.io/share/embed/${VIDCAST_ID}"]`)).toBeVisible();
      await expect(page.locator('iframe[src*="arxiv.org/pdf/1706.03762"]')).toBeVisible();
      await expect(page.getByRole("button", { name: "Remove YouTube embed" })).toHaveCount(0);

      await page.getByRole("button", { name: "Edit", exact: true }).click();
      const removeYouTube = page.getByRole("button", { name: "Remove YouTube embed" });
      await expect(removeYouTube).toBeVisible();
      await removeYouTube.click();
      await page.getByRole("button", { name: "Save", exact: true }).click();
      await expect.poll(async () => JSON.stringify((await api(page, pageApi)).body)).not.toContain("```youtube");

      await page.goto(
        `/projects/${encodeURIComponent(fixture.slug)}/tome/gists/${encodeURIComponent(gistId)}`,
        { waitUntil: "domcontentloaded" },
      );
      await expect(page.locator(`iframe[src*="youtube-nocookie.com/embed/${YOUTUBE_ID}"]`)).toBeVisible();
      await expect(page.locator(`iframe[src*="app.vidcast.io/share/embed/${VIDCAST_ID}"]`)).toBeVisible();
      await expect(page.locator('iframe[src*="arxiv.org/pdf/1706.03762"]')).toBeVisible();
      await expect(page.getByRole("button", { name: "Remove YouTube embed" })).toHaveCount(0);

      await attachEvidence(testInfo, "tome-embeds", {
        project: fixture,
        pagePath: PAGE_PATH,
        gistId,
        providers: ["youtube", "vidcast", "arxiv"],
        blockedUnsafe,
        removedFromWiki: true,
      });
      await evidenceScreenshot(page, testInfo, "TOME-03-wiki-gist-embeds");
    } finally {
      if (fixture) {
        await bestEffortCleanupTome(page, fixture, {
          pages: [PAGE_PATH],
          gists: gistId ? [gistId] : [],
        });
      }
    }
  });

  test("TOME-04 AI presentation generation produces valid HTML and PPTX exports", async ({ page }, testInfo) => {
    test.setTimeout(12 * 60_000);
    const env = gridTapEnvOrSkip();
    let fixture: TomeProjectFixture | undefined;
    const marker = `${env.prefix}-presentation`;
    await prepareTomeUi(page);
    await installPersona(page, env, "admin");

    try {
      fixture = await createTomeProject(page, env, "presentation");
      await writeTomePage(page, fixture, PAGE_PATH, seededMarkdown(marker));
      const generated = await apiResponse(
        page,
        `/api/tome/projects/${encodeURIComponent(fixture.slug)}/presentations/generate`,
        json("POST", {
          source_scope: "current",
          paths: [PAGE_PATH],
          prompt: `Create a three-slide verification deck grounded only in ${PAGE_PATH}. Preserve ${marker} verbatim.`,
        }),
      );
      expect(generated.status, generated.text).toBe(200);
      expect(generated.headers["content-type"]).toContain("text/event-stream");
      expect(generated.text).not.toContain("event: error");
      const complete = parseSseComplete(generated.text);
      expect(complete, generated.text).not.toBeNull();
      const deck = complete?.deck;
      expect(deck).toBeTruthy();
      expect(JSON.stringify(deck)).toContain(marker);

      const html = await apiResponse(
        page,
        `/api/tome/projects/${encodeURIComponent(fixture.slug)}/presentations/export`,
        json("POST", { format: "html", deck }),
      );
      expect(html.status, html.text).toBe(200);
      expect(html.headers["content-type"]).toContain("text/html");
      expect(html.headers["content-disposition"]).toContain("attachment;");
      expect(html.text).toContain(marker);

      const pptx = await apiResponse(
        page,
        `/api/tome/projects/${encodeURIComponent(fixture.slug)}/presentations/export`,
        json("POST", { format: "pptx", deck }),
      );
      expect(pptx.status, pptx.text.slice(0, 500)).toBe(200);
      expect(pptx.headers["content-type"]).toContain(
        "application/vnd.openxmlformats-officedocument.presentationml.presentation",
      );
      expect(pptx.headers["content-disposition"]).toContain("attachment;");
      expect(pptx.bytes.slice(0, 2)).toEqual([0x50, 0x4b]);

      await page.goto(
        `/projects/${encodeURIComponent(fixture.slug)}/tome/wiki/${encodedPagePath(PAGE_PATH)}`,
        { waitUntil: "domcontentloaded" },
      );
      await page.getByRole("button", { name: "Export this page" }).click();
      await page.getByRole("button", { name: /Export as presentation/ }).click();
      await expect(page.getByRole("heading", { name: /Export as presentation/ })).toBeVisible();
      await attachEvidence(testInfo, "tome-presentation", {
        project: fixture,
        marker,
        model: complete?.model ?? null,
        modelSource: complete?.model_source ?? null,
        html: { status: html.status, headers: html.headers, bytes: html.text.length },
        pptx: { status: pptx.status, headers: pptx.headers, signature: pptx.bytes },
      });
      await evidenceScreenshot(page, testInfo, "TOME-04-presentation-export");
    } finally {
      if (fixture) await bestEffortCleanupTome(page, fixture, { pages: [PAGE_PATH] });
    }
  });
});
