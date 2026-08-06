import { expect, test } from "@playwright/test";

import {
  fulfillJson,
  installMockedRbacApp,
  mockedRbacEnabled,
  postJson,
  type MockRouteHandler,
} from "./_mocked-rbac";

const SLUG = "example-area";
const OLD_REPOSITORY = "example/old-repository";
const RENAMED_REPOSITORY = "example/renamed-repository";
const RENAMED_REPOSITORY_URL = `https://github.com/${RENAMED_REPOSITORY}`;
const BHAG_NAME = "Example Strategic Goal";
const OLD_AREA_NAME = "Example Governance Area";
const RENAMED_AREA_TITLE = "Example Cognition Engines Area";

const HUMAN_CHARTER = [
  "---",
  "title: Charter",
  "kind: stable",
  "---",
  "",
  "# Human-authored charter",
  "",
  "Keep this exact content.",
].join("\n");

function pagesData(repository: string) {
  const repositorySlug = repository.split("/").at(-1)!;
  const repositoryTitle =
    repositorySlug === "old-repository"
      ? "Old Repository"
      : "Renamed Repository";
  const overviewPath = `repos/${repositorySlug}/overview.md`;

  return {
    slug: SLUG,
    tree: [
      {
        path: "charter.md",
        title: "Charter",
        kind: "stable",
        children: [],
      },
      {
        path: "repos",
        title: "Repos",
        kind: "folder",
        children: [
          {
            path: `repos/${repositorySlug}`,
            title: repositoryTitle,
            kind: "folder",
            children: [
              {
                path: overviewPath,
                title: "Overview",
                kind: "dynamic",
                children: [],
              },
            ],
          },
        ],
      },
    ],
    pages: {
      "charter.md": HUMAN_CHARTER,
      [overviewPath]: [
        "---",
        `title: ${repositoryTitle}`,
        "kind: dynamic",
        "---",
        "",
        `# ${repositoryTitle}`,
      ].join("\n"),
    },
    canEdit: true,
    canManageSteward: false,
  };
}

test.describe("Tome source reconciliation (mocked)", () => {
  test.beforeEach(async ({ page }) => {
    test.skip(
      !mockedRbacEnabled(),
      "Set RUN_RBAC_REGRESSION=1 to run the mocked Tome browser regression.",
    );
    await page.addInitScript(() => {
      window.localStorage.setItem("tome.onboarding.seen", "1");
    });
  });

  test("re-ingesting a renamed repository preserves stable pages and removes its old subtree", async ({
    page,
  }) => {
    let reconciled = false;
    let synthesisPayload: unknown = null;

    const handler: MockRouteHandler = async ({ route, path, method, url }) => {
      if (path === "/api/projects/onboarding-config" && method === "GET") {
        await fulfillJson(route, {
          success: true,
          data: {
            config: { steps: [{ provider: "source", source: "github" }] },
          },
        });
        return true;
      }
      if (path === "/api/projects/source-options" && method === "GET") {
        await fulfillJson(route, {
          success: true,
          data: {
            connected: true,
            connectedTo: "example-user",
            manageUrl: "/credentials",
            options: [
              {
                value: RENAMED_REPOSITORY_URL,
                label: RENAMED_REPOSITORY,
                github_repo: {
                  id: 42,
                  node_id: "repository-node-42",
                  full_name: RENAMED_REPOSITORY,
                  html_url: RENAMED_REPOSITORY_URL,
                  default_branch: "trunk",
                },
              },
            ],
          },
        });
        return true;
      }
      if (path === `/api/projects/${SLUG}` && method === "GET") {
        await fulfillJson(route, {
          success: true,
          data: {
            project: {
              _id: "example-area-id",
              type: "area",
              slug: SLUG,
              name: OLD_AREA_NAME,
              title: RENAMED_AREA_TITLE,
              description: "Neutral repository rename fixture.",
              status: "active",
              team_id: "example-team-id",
              team_slug: "example-team",
              team_name: "Example Team",
              owner_id: "owner@example.test",
              member_ids: [],
              data_steward: {
                type: "user",
                id: "example-steward-subject",
                name: "Example Steward",
                email: "steward@example.test",
              },
              labels: { initiatives: [BHAG_NAME] },
              tags: [],
              sources: {
                repos: [RENAMED_REPOSITORY_URL],
                github_repos: [
                  {
                    id: 42,
                    node_id: "repository-node-42",
                    full_name: RENAMED_REPOSITORY,
                    html_url: RENAMED_REPOSITORY_URL,
                    default_branch: "trunk",
                  },
                ],
                confluence_url: "",
                webex_rooms: [],
              },
            },
            permissions: {
              can_read: true,
              can_edit: true,
              can_manage_steward: false,
            },
          },
        });
        return true;
      }
      if (path === "/api/projects" && method === "GET") {
        const common = {
          description: "Neutral hierarchy rename fixture.",
          status: "active",
          team_id: "example-team-id",
          team_slug: "example-team",
          team_name: "Example Team",
          owner_id: "owner@example.test",
          member_ids: [],
          data_steward: {
            type: "user",
            id: "example-steward-subject",
            name: "Example Steward",
            email: "steward@example.test",
          },
          tags: [],
          sources: {},
          page_count: 1,
          last_ingested_at: "2026-08-06T12:00:00.000Z",
          active_ingests: [],
        };
        const type = url.searchParams.get("type");
        const projects =
          type === "bhag"
            ? [
                {
                  ...common,
                  _id: "example-bhag-id",
                  type: "bhag",
                  slug: "example-strategic-goal",
                  name: BHAG_NAME,
                  title: BHAG_NAME,
                  labels: {},
                },
              ]
            : type === "area"
              ? [
                  {
                    ...common,
                    _id: "example-area-id",
                    type: "area",
                    slug: SLUG,
                    name: OLD_AREA_NAME,
                    title: RENAMED_AREA_TITLE,
                    labels: { initiatives: [BHAG_NAME] },
                  },
                ]
              : [
                  {
                    ...common,
                    _id: "example-child-project-id",
                    type: "project",
                    slug: "example-child-project",
                    name: "Example Child Project",
                    title: "Example Child Project",
                    labels: {
                      initiatives: [BHAG_NAME],
                      areas: [OLD_AREA_NAME],
                    },
                  },
                ];
        await fulfillJson(route, { success: true, data: { projects } });
        return true;
      }
      if (path === `/api/tome/projects/${SLUG}/pages` && method === "GET") {
        await fulfillJson(route, {
          success: true,
          data: pagesData(reconciled ? RENAMED_REPOSITORY : OLD_REPOSITORY),
        });
        return true;
      }
      if (path === `/api/tome/projects/${SLUG}/edges` && method === "GET") {
        await fulfillJson(route, {
          success: true,
          data: { outgoing: [], incoming: [], titles: {} },
        });
        return true;
      }
      if (
        path === `/api/tome/projects/${SLUG}/preflight` &&
        method === "POST"
      ) {
        await fulfillJson(route, {
          success: true,
          data: {
            can_ingest: true,
            sources: [
              {
                provider: "github",
                accessible: [RENAMED_REPOSITORY],
                inaccessible: [],
                no_token: false,
              },
            ],
          },
        });
        return true;
      }
      if (path === `/api/tome/projects/${SLUG}/ingests` && method === "GET") {
        await fulfillJson(route, {
          success: true,
          data: {
            runs: reconciled
              ? [
                  {
                    id: "rename-reconciliation-run",
                    status: "succeeded",
                    greenfield: false,
                    started_at: "2026-08-06T12:00:00.000Z",
                    finished_at: "2026-08-06T12:00:01.000Z",
                    error: null,
                    report_id: "rename-reconciliation-report",
                  },
                ]
              : [],
          },
        });
        return true;
      }
      if (
        path ===
          `/api/tome/projects/${SLUG}/ingests/rename-reconciliation-run` &&
        method === "GET"
      ) {
        await fulfillJson(route, {
          success: true,
          data: {
            id: "rename-reconciliation-run",
            status: "succeeded",
            greenfield: false,
            started_at: "2026-08-06T12:00:00.000Z",
            finished_at: "2026-08-06T12:00:01.000Z",
            error: null,
            report_id: "rename-reconciliation-report",
            log: "Reconciled renamed repository source.",
          },
        });
        return true;
      }
      if (
        path === `/api/tome/projects/${SLUG}/synthesize` &&
        method === "POST"
      ) {
        synthesisPayload = await postJson(route);
        reconciled = true;
        await fulfillJson(
          route,
          { success: true, data: { runId: "rename-reconciliation-run" } },
          202,
        );
        return true;
      }
      return false;
    };

    await installMockedRbacApp(page, {
      session: { email: "steward@example.test", name: "Example Steward" },
      handlers: [handler],
    });

    await page.goto("/projects", { waitUntil: "domcontentloaded" });
    await expect(
      page.getByText(RENAMED_AREA_TITLE, { exact: true }),
    ).toBeVisible();
    await expect(page.getByText(OLD_AREA_NAME, { exact: true })).toHaveCount(0);
    await expect(
      page.getByRole("link", {
        name: `Open ${RENAMED_AREA_TITLE} wiki`,
        exact: true,
      }),
    ).toBeVisible();

    await page.goto(`/projects/${SLUG}/tome/settings`, {
      waitUntil: "domcontentloaded",
    });
    await page.getByRole("tab", { name: "Sources" }).click();
    await expect(
      page.getByText(RENAMED_REPOSITORY, { exact: true }),
    ).toBeVisible();

    await page
      .getByRole("tabpanel", { name: "Sources" })
      .getByRole("button", { name: "Ingest & synthesize", exact: true })
      .click();
    await page.waitForURL(`**/projects/${SLUG}/tome/ingest`);
    await expect(
      page.getByRole("heading", { name: "Ingest sources & synthesize Area" }),
    ).toBeVisible();

    const response = page.waitForResponse(
      (candidate) =>
        candidate.request().method() === "POST" &&
        new URL(candidate.url()).pathname ===
          `/api/tome/projects/${SLUG}/synthesize`,
    );
    await page
      .getByRole("main")
      .getByRole("button", { name: "Ingest & synthesize", exact: true })
      .click();
    expect((await response).status()).toBe(202);
    expect(synthesisPayload).toEqual({ seedStablePages: false });

    await page.goto(`/projects/${SLUG}/tome/wiki/charter.md`, {
      waitUntil: "domcontentloaded",
    });
    await expect(
      page.getByRole("heading", { name: "Human-authored charter" }),
    ).toBeVisible();
    await expect(
      page.getByText("Keep this exact content.", { exact: true }),
    ).toBeVisible();

    await page.getByRole("button", { name: /^Repos/ }).click();
    await expect(
      page.getByRole("button", { name: /^Renamed Repository/ }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: /^Old Repository/ }),
    ).toHaveCount(0);
  });
});
