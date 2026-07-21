import { expect,test,type Locator,type Page } from "@playwright/test";

import {
  fulfillJson,
  installMockedRbacApp,
  mockedRbacEnabled,
  postJson,
  type MockRouteHandler,
} from "./_mocked-rbac";

const ADMIN_SESSION = {
  email: "settings-admin@caipe.local",
  name: "Settings Admin",
  role: "admin" as const,
  canViewAdmin: true,
};

const USER_SESSION = {
  email: "settings-user@caipe.local",
  name: "Settings User",
  role: "user" as const,
  canViewAdmin: false,
};

const AGENTS = [
  {
    _id: "incident-response",
    id: "incident-response",
    name: "Incident Response",
    description: "Coordinates incident response workflows.",
    enabled: true,
  },
  {
    _id: "knowledge-agent",
    id: "knowledge-agent",
    name: "Knowledge Agent",
    description: "Answers questions from approved knowledge bases.",
    enabled: true,
  },
];

interface SettingsMockState {
  failNextSettingsPreferenceWrite: boolean;
  platformConfig: {
    default_agent_id: string | null;
    release_notes: { enabled: boolean };
    source: "db" | "fallback";
  };
  platformWrites: Array<Record<string,unknown>>;
  preferences: Record<string,unknown>;
  settingsPreferenceWrites: Array<Record<string,unknown>>;
  userPreferences: Record<string,unknown>;
  userPreferenceWrites: Array<Record<string,unknown>>;
}

function createState(): SettingsMockState {
  return {
    failNextSettingsPreferenceWrite: false,
    platformConfig: {
      default_agent_id: null,
      release_notes: { enabled: true },
      source: "fallback",
    },
    platformWrites: [],
    preferences: {
      auto_scroll_enabled: "true",
      debug_mode_enabled: "false",
      font_family: "inter",
      font_size: "medium",
      gradient_theme: "default",
      memory_enabled: "true",
      releaseNotesNotificationsEnabled: true,
      releaseNotesDismissedVersions: ["playwright"],
      show_thinking_enabled: "true",
      show_timestamps_enabled: "false",
      theme: "dark",
    },
    settingsPreferenceWrites: [],
    userPreferences: {
      integrations: { slack: true,webex: true },
      platform_default_agent_id: null,
      slack_default_agent_id: null,
      web_default_agent_id: null,
      webex_default_agent_id: null,
    },
    userPreferenceWrites: [],
  };
}

async function installSettingsCenterMocks(
  page: Page,
  state: SettingsMockState,
  isAdmin = false,
): Promise<void> {
  const handler: MockRouteHandler = async ({ method,path,route }) => {
    if (path === "/api/settings/preferences" && method === "PATCH") {
      const body = (await postJson(route)) as Record<string,unknown>;
      state.settingsPreferenceWrites.push(body);
      if (state.failNextSettingsPreferenceWrite) {
        state.failNextSettingsPreferenceWrite = false;
        await fulfillJson(route,{ success: false,error: "Preference service unavailable" },503);
        return true;
      }
      Object.assign(state.preferences,body);
      await fulfillJson(route,{
        success: true,
        data: { preferences: state.preferences },
      });
      return true;
    }

    if (path === "/api/settings" && method === "GET") {
      await fulfillJson(route,{
        success: true,
        data: {
          defaults: {},
          notifications: {},
          preferences: state.preferences,
        },
      });
      return true;
    }

    if (path === "/api/user/accessible-agents" && method === "GET") {
      await fulfillJson(route,{
        success: true,
        data: {
          agents: AGENTS.map(({ description,id,name }) => ({ description,id,name })),
          page: 1,
          page_size: 100,
          total: AGENTS.length,
        },
      });
      return true;
    }

    if (path === "/api/user/preferences" && method === "GET") {
      await fulfillJson(route,{ success: true,data: state.userPreferences });
      return true;
    }

    if (path === "/api/user/preferences" && method === "PUT") {
      const body = (await postJson(route)) as Record<string,unknown>;
      state.userPreferenceWrites.push(body);
      Object.assign(state.userPreferences,body);
      await fulfillJson(route,{ success: true,data: body });
      return true;
    }

    if (path === "/api/dynamic-agents/available" && method === "GET") {
      await fulfillJson(route,{ success: true,data: AGENTS });
      return true;
    }

    if (path === "/api/admin/platform-config" && method === "GET") {
      await fulfillJson(route,{ success: true,data: state.platformConfig });
      return true;
    }

    if (path === "/api/admin/platform-config" && method === "PATCH") {
      const body = (await postJson(route)) as Record<string,unknown>;
      state.platformWrites.push(body);
      if (Object.prototype.hasOwnProperty.call(body,"default_agent_id")) {
        state.platformConfig.default_agent_id = body.default_agent_id as string | null;
        state.platformConfig.source = "db";
      }
      const releaseNotes = body.release_notes as { enabled?: unknown } | undefined;
      if (typeof releaseNotes?.enabled === "boolean") {
        state.platformConfig.release_notes.enabled = releaseNotes.enabled;
      }
      await fulfillJson(route,{ success: true,data: state.platformConfig });
      return true;
    }

    if (path === "/api/auth/my-roles" && method === "GET") {
      await fulfillJson(route,{
        email: isAdmin ? ADMIN_SESSION.email : USER_SESSION.email,
        idp_source: "playwright",
        name: isAdmin ? ADMIN_SESSION.name : USER_SESSION.name,
        per_agent_roles: [],
        per_kb_roles: [],
        realm_roles: isAdmin ? ["admin"] : ["user"],
        role: isAdmin ? "admin" : "user",
        slack_linked: true,
        teams: [],
      });
      return true;
    }

    return false;
  };

  await installMockedRbacApp(page,{
    handlers: [handler],
    isAdmin,
    session: isAdmin ? ADMIN_SESSION : USER_SESSION,
  });
}

async function switchThumbIsInsideTrack(toggle: Locator): Promise<boolean> {
  const track = await toggle.locator("span").first().boundingBox();
  const thumb = await toggle.locator("span").nth(1).boundingBox();
  if (!track || !thumb) return false;

  const tolerance = 0.5;
  return thumb.x >= track.x - tolerance
    && thumb.x + thumb.width <= track.x + track.width + tolerance
    && thumb.y >= track.y - tolerance
    && thumb.y + thumb.height <= track.y + track.height + tolerance;
}

async function openSettings(
  page: Page,
  section?: "Appearance" | "Chat & agents" | "Notifications" | "Defaults" | "Announcements",
): Promise<Locator> {
  const settingsTrigger = page.getByRole("button",{
    exact: true,
    name: "Appearance settings",
  });

  // DOMContentLoaded can fire while React is still hydrating the server-rendered
  // header. Waiting for the persisted theme label proves SettingsPanel's client
  // effect has completed, so Playwright does not chase a trigger being replaced
  // during hydration.
  await expect(settingsTrigger).toContainText("Dark");
  await settingsTrigger.click();
  const dialog = page.getByRole("dialog",{ name: "Settings" });
  await expect(dialog).toBeVisible();
  const requestedSection = section ?? "Chat & agents";
  if (requestedSection !== "Appearance") {
    const routeId = {
      "Announcements": "announcements",
      "Chat & agents": "chat",
      "Defaults": "defaults",
      "Notifications": "notifications",
    }[requestedSection];
    const navigationButton = dialog.getByRole("button",{
      exact: true,
      name: requestedSection,
    });
    if (await navigationButton.isVisible()) {
      await navigationButton.click();
    } else {
      await dialog.getByLabel("Settings section",{ exact: true }).selectOption(routeId);
    }
  }
  return dialog;
}

test.describe("mocked Settings dialog browser regression",() => {
  test.beforeEach(() => {
    test.skip(
      !mockedRbacEnabled(),
      "Set RUN_RBAC_REGRESSION=1 to run the mocked Settings dialog regression.",
    );
  });

  test("opens in context at Chat & agents and returns to the same page",async ({ page }) => {
    const state = createState();
    await installSettingsCenterMocks(page,state);
    await page.goto("/",{ waitUntil: "domcontentloaded" });

    const dialog = await openSettings(page);

    await expect(page).toHaveURL(/\/$/);
    await expect(dialog.getByRole("heading",{ name: "Settings" })).toBeVisible();
    await expect(dialog.getByRole("heading",{ level: 2,name: "Chat & agents" })).toBeVisible();
    await expect(
      dialog.getByRole("region",{ name: "Chat & agents" }).getByText("Personal",{ exact: true }),
    ).toBeVisible();
    await expect(dialog.getByRole("button",{ name: "Chat & agents" })).toHaveAttribute(
      "aria-current",
      "page",
    );

    await dialog.getByRole("button",{ name: "Close" }).click();
    await expect(dialog).toBeHidden();
    await expect(page).toHaveURL(/\/$/);
    await expect(page.getByRole("link",{ name: "Home",exact: true })).toHaveAttribute(
      "aria-current",
      "page",
    );
  });

  test("keeps settings switch thumbs inside their tracks in both states",async ({ page }) => {
    const state = createState();
    await installSettingsCenterMocks(page,state);
    await page.goto("/",{ waitUntil: "domcontentloaded" });
    const dialog = await openSettings(page,"Notifications");

    const toggle = dialog.getByRole("switch",{ name: "Notify me about new releases" });
    await expect(toggle).toHaveAttribute("aria-checked","true");
    await expect.poll(() => switchThumbIsInsideTrack(toggle)).toBe(true);

    await toggle.click();
    await expect(toggle).toHaveAttribute("aria-checked","false");
    await expect.poll(() => switchThumbIsInsideTrack(toggle)).toBe(true);
  });

  test("shows preference explanations on hover without a dead documentation link",async ({ page }) => {
    const state = createState();
    await installSettingsCenterMocks(page,state);
    await page.goto("/",{ waitUntil: "domcontentloaded" });
    const dialog = await openSettings(page);

    await dialog.getByRole("button",{ name: "More about Cross-Thread Memory" }).hover();

    await expect(page.getByRole("tooltip")).toContainText(
      "the assistant extracts and recalls facts about you",
    );
    await expect(page.locator('a[href="/docs/features/cross-thread-memory"]')).toHaveCount(0);
  });

  test("rolls back a failed personal autosave, retries it, and reloads the saved value",async ({ page }) => {
    const state = createState();
    state.failNextSettingsPreferenceWrite = true;
    await installSettingsCenterMocks(page,state);
    await page.goto("/",{ waitUntil: "domcontentloaded" });
    let dialog = await openSettings(page,"Notifications");

    let toggle = dialog.getByRole("switch",{ name: "Notify me about new releases" });
    await toggle.click();

    await expect(dialog.getByRole("alert")).toContainText("Preference service unavailable");
    await expect(toggle).toHaveAttribute("aria-checked","true");
    await expect.poll(() => state.settingsPreferenceWrites).toEqual([
      { releaseNotesNotificationsEnabled: false },
    ]);

    await dialog.getByRole("button",{ name: "Retry" }).click();
    await expect(toggle).toHaveAttribute("aria-checked","false");
    await expect(dialog.getByText("Saved",{ exact: true })).toBeVisible();

    await page.reload({ waitUntil: "domcontentloaded" });
    dialog = await openSettings(page,"Notifications");
    toggle = dialog.getByRole("switch",{ name: "Notify me about new releases" });
    await expect(toggle).toHaveAttribute("aria-checked","false");
  });

  test("auto-saves each personal default-agent surface independently",async ({ page }) => {
    const state = createState();
    await installSettingsCenterMocks(page,state);
    await page.goto("/",{ waitUntil: "domcontentloaded" });
    const dialog = await openSettings(page);

    await dialog.getByRole("button",{ name: "Web default agent" }).click();
    await page.getByRole("option",{ name: "Incident Response" }).click();

    await expect.poll(() => state.userPreferenceWrites).toEqual([
      { web_default_agent_id: "incident-response" },
    ]);
    await expect(dialog.getByRole("button",{ name: "Web default agent" })).toContainText("Incident Response");
    await expect(dialog.getByRole("button",{ name: "Slack default agent" })).toContainText("Use platform default");
    await expect(dialog.getByRole("button",{ name: /^save$/i })).toHaveCount(0);
  });

  test("hides platform settings from non-admin users",async ({ page }) => {
    const state = createState();
    await installSettingsCenterMocks(page,state);
    await page.goto("/",{ waitUntil: "domcontentloaded" });
    const dialog = await openSettings(page);

    await expect(dialog.getByRole("button",{ name: "Defaults",exact: true })).toHaveCount(0);
    await expect(dialog.getByRole("button",{ name: "Announcements",exact: true })).toHaveCount(0);
    await expect(dialog.getByRole("button",{ name: "AI Review",exact: true })).toHaveCount(0);
  });

  test("requires consequence confirmation before changing a platform default",async ({ page }) => {
    const state = createState();
    await installSettingsCenterMocks(page,state,true);
    await page.goto("/",{ waitUntil: "domcontentloaded" });
    const settingsDialog = await openSettings(page,"Defaults");

    await expect(settingsDialog.getByText("Platform · Admins")).toBeVisible();
    await settingsDialog.getByRole("button",{ name: "Platform default agent for new chats" }).click();
    await page.getByRole("option",{ name: "Incident Response" }).click();

    const confirmation = page.getByRole("dialog",{
      name: "Make “Incident Response” the platform default?",
    });
    await expect(confirmation).toBeVisible();
    expect(state.platformWrites).toEqual([]);

    await confirmation.getByRole("button",{ name: "Make it the default" }).click();
    await expect(confirmation).toBeHidden();
    await expect.poll(() => state.platformWrites).toEqual([{
      acknowledge_public_access: true,
      default_agent_id: "incident-response",
    }]);
    await expect(settingsDialog.getByText("Saved",{ exact: true })).toBeVisible();
  });

  test("auto-saves platform announcements inside Settings",async ({ page }) => {
    const state = createState();
    await installSettingsCenterMocks(page,state,true);
    await page.goto("/",{ waitUntil: "domcontentloaded" });
    const dialog = await openSettings(page,"Announcements");

    const toggle = dialog.getByRole("switch",{
      name: "Enable release announcements for the platform",
    });
    await toggle.click();

    await expect.poll(() => state.platformWrites).toEqual([
      { release_notes: { enabled: false } },
    ]);
    await expect(toggle).toHaveAttribute("aria-checked","false");
    await expect(dialog.getByText("Saved",{ exact: true })).toBeVisible();
    await expect(page).toHaveURL(/\/$/);
  });

  test("uses the compact section chooser on a mobile viewport",async ({ page }) => {
    const state = createState();
    await page.setViewportSize({ height: 844,width: 390 });
    await installSettingsCenterMocks(page,state,true);
    await page.goto("/",{ waitUntil: "domcontentloaded" });
    const dialog = await openSettings(page);

    const sectionPicker = dialog.getByLabel("Settings section",{ exact: true });
    await expect(sectionPicker).toBeVisible();
    await sectionPicker.selectOption("notifications");
    await expect(dialog.getByRole("heading",{ level: 2,name: "Notifications" })).toBeVisible();
    await expect(page).toHaveURL(/\/$/);
  });

  test("opens Appearance from the header and can reopen at Chat & agents",async ({ page }) => {
    const state = createState();
    await installSettingsCenterMocks(page,state,true);
    await page.goto("/",{ waitUntil: "domcontentloaded" });

    let dialog = await openSettings(page,"Appearance");
    await expect(dialog.getByRole("heading",{ level: 2,name: "Appearance" })).toBeVisible();
    await dialog.getByRole("button",{ name: "Close" }).click();
    await expect(dialog).toBeHidden();

    dialog = await openSettings(page);
    await expect(dialog.getByRole("heading",{ level: 2,name: "Chat & agents" })).toBeVisible();
    await expect(page).toHaveURL(/\/$/);
  });
});
