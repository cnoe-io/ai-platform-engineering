// assisted-by Codex Codex-sonnet-4-6

import { type Page, type Route } from "@playwright/test";

export const MOCK_RBAC_EMAIL = "non-manager@caipe.local";

export type MockRouteContext = {
  route: Route;
  url: URL;
  path: string;
  method: string;
};

export type MockRouteHandler = (context: MockRouteContext) => boolean | Promise<boolean>;

type SessionOverrides = {
  email?: string;
  name?: string;
  role?: "admin" | "user";
  canViewAdmin?: boolean;
};

type MockedRbacOptions = {
  isAdmin?: boolean;
  session?: SessionOverrides;
  handlers?: MockRouteHandler[];
};

export function mockedRbacEnabled() {
  return (
    process.env.RUN_RBAC_REGRESSION === "1" ||
    process.env.RUN_WORKFLOW_E2E === "1" ||
    process.env.RUN_RBAC_E2E === "1"
  );
}

export function mockSessionBody(options: MockedRbacOptions = {}) {
  const isAdmin = options.isAdmin ?? false;
  const role = options.session?.role ?? (isAdmin ? "admin" : "user");
  const email = options.session?.email ?? MOCK_RBAC_EMAIL;

  return {
    user: {
      name: options.session?.name ?? (isAdmin ? "RBAC Admin" : "Non Manager"),
      email,
    },
    role,
    isAuthorized: true,
    canViewAdmin: options.session?.canViewAdmin ?? isAdmin,
    canAccessDynamicAgents: true,
    accessToken: "playwright-access-token",
    expiresAt: Math.floor(Date.now() / 1000) + 3600,
    expires: new Date(Date.now() + 3600_000).toISOString(),
  };
}

export async function postJson(route: Route) {
  try {
    return route.request().postDataJSON();
  } catch {
    return null;
  }
}

export async function fulfillJson(route: Route, body: unknown, status = 200) {
  await route.fulfill({
    status,
    contentType: "application/json",
    body: JSON.stringify(body),
  });
}

export async function installMockedRbacApp(page: Page, options: MockedRbacOptions = {}) {
  const isAdmin = options.isAdmin ?? false;
  const session = mockSessionBody({ ...options, isAdmin });
  const handlers = options.handlers ?? [];

  await page.route("**/api/**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const method = request.method();
    const path = url.pathname;
    const context = { route, url, path, method };

    for (const handler of handlers) {
      if (await handler(context)) {
        return;
      }
    }

    if (path === "/api/auth/session") {
      await fulfillJson(route, session);
      return;
    }

    if (path === "/api/auth/role") {
      await fulfillJson(route, { role: session.role });
      return;
    }

    if (path === "/api/users/me") {
      await fulfillJson(route, {
        id: session.user.email,
        email: session.user.email,
        name: session.user.name,
        role: session.role,
      });
      return;
    }

    if (path === "/api/admin/platform-config") {
      await fulfillJson(route, { data: { release_notes: { enabled: false } } });
      return;
    }

    if (path === "/api/settings") {
      await fulfillJson(route, { data: { preferences: {} } });
      return;
    }

    if (path === "/api/changelog") {
      await fulfillJson(route, { releases: [] });
      return;
    }

    if (path === "/api/version") {
      await fulfillJson(route, {
        version: "playwright",
        gitCommit: "e2e",
        buildDate: "2026-06-12T16:00:00.000Z",
      });
      return;
    }

    if (path === "/api/dynamic-agents/available" || path === "/api/dynamic-agents") {
      await fulfillJson(route, { data: [] });
      return;
    }

    if (path === "/api/dynamic-agents/teams") {
      await fulfillJson(route, { success: true, data: [] });
      return;
    }

    if (path === "/api/dynamic-agents/health") {
      await fulfillJson(route, { status: "healthy" });
      return;
    }

    if (path.startsWith("/api/a2a/")) {
      await fulfillJson(route, { name: "playwright-supervisor", skills: [] });
      return;
    }

    await fulfillJson(route, { success: true });
  });
}
