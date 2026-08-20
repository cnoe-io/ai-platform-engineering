import { expect, test as base, type Page, type TestInfo } from "@playwright/test";
import { installTestSession } from "../rbac/_helpers";
import type { RbacEnv } from "../rbac/_env";
import type { GridTapEnv } from "./_env";
import { recordResource } from "./_manifest";

export type TupleKey = { user: string; relation: string; object: string };
export type ApiResult = { status: number; body: unknown };
export type BrowserRequestInit = { method?: string; headers?: Record<string, string>; body?: string };

export type TomeProjectFixture = {
  id: string;
  slug: string;
  object: string;
  stewardSubject: string;
};

export const test = base;
export { expect };

test.afterEach(async ({ page }, testInfo) => {
  if (!page.isClosed()) {
    const image = await page.screenshot({ fullPage: true });
    await testInfo.attach("final-state", { body: image, contentType: "image/png" });
  }
});

export async function installPersona(page: Page, env: GridTapEnv, persona: "admin" | "member"): Promise<void> {
  const selected = env[persona];
  const rbacEnv: RbacEnv = {
    baseUrl: env.baseUrl,
    keycloakUrl: env.baseUrl,
    keycloakRealm: "grid-tap",
    user: { email: env.admin.email, password: "unused", sub: env.admin.subject },
  };
  await page.context().clearCookies();
  await installTestSession(page, rbacEnv, {
    email: selected.email,
    subject: selected.subject,
    role: persona === "admin" ? "admin" : "user",
    canViewAdmin: true,
  });
  await page.goto("/", { waitUntil: "domcontentloaded" });
}

export async function api(page: Page, path: string, init?: BrowserRequestInit): Promise<ApiResult> {
  return page.evaluate(async ({ requestPath, requestInit }) => {
    const response = await fetch(requestPath, requestInit);
    const raw = await response.text();
    let body: unknown;
    try {
      body = JSON.parse(raw) as unknown;
    } catch {
      body = raw;
    }
    return { status: response.status, body };
  }, { requestPath: path, requestInit: init });
}

export function json(method: string, body: unknown): BrowserRequestInit {
  return { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) };
}

export function dataRecord(result: ApiResult): Record<string, unknown> {
  const body = typeof result.body === "object" && result.body !== null ? result.body as Record<string, unknown> : {};
  return typeof body.data === "object" && body.data !== null ? body.data as Record<string, unknown> : body;
}

export function idFrom(result: ApiResult, keys: string[]): string {
  const data = dataRecord(result);
  for (const key of keys) {
    if (typeof data[key] === "string" && data[key]) return data[key] as string;
  }
  throw new Error(`Could not extract resource id: ${JSON.stringify(result.body)}`);
}

export async function expectTuple(page: Page, tuple: TupleKey, present = true): Promise<void> {
  await expect.poll(async () => {
    const params = new URLSearchParams({ ...tuple, limit: "25" });
    const result = await api(page, `/api/admin/openfga/tuples?${params}`);
    expect(result.status, JSON.stringify(result.body)).toBe(200);
    const data = dataRecord(result);
    const tuples = Array.isArray(data.tuples) ? data.tuples as Array<{ key?: TupleKey }> : [];
    return tuples.some((item) => item.key?.user === tuple.user && item.key.relation === tuple.relation && item.key.object === tuple.object);
  }, { timeout: 20_000, intervals: [250, 500, 1_000, 2_000] }).toBe(present);
}

export async function expectDecision(
  page: Page,
  input: { subject: string; type: string; id: string; action: string },
  expected: "ALLOW" | "DENY",
): Promise<void> {
  await expect.poll(async () => {
    const result = await api(page, "/api/authz/v1/decisions", json("POST", {
      subject: { type: "user", id: input.subject },
      resource: { type: input.type, id: input.id },
      action: input.action,
    }));
    expect(result.status, JSON.stringify(result.body)).toBe(200);
    return dataRecord(result).decision;
  }, { timeout: 20_000, intervals: [250, 500, 1_000, 2_000] }).toBe(expected);
}

export async function evidenceScreenshot(page: Page, testInfo: TestInfo, name: string): Promise<void> {
  const image = await page.screenshot({ fullPage: true });
  await testInfo.attach(name, { body: image, contentType: "image/png" });
}

export async function attachEvidence(testInfo: TestInfo, name: string, value: unknown): Promise<void> {
  await testInfo.attach(name, { body: Buffer.from(JSON.stringify(value, null, 2)), contentType: "application/json" });
}

export async function bestEffortDelete(page: Page, paths: string[]): Promise<void> {
  for (const path of paths.reverse()) {
    await api(page, path, { method: "DELETE" }).catch(() => undefined);
  }
}

export async function writeTuples(
  page: Page,
  body: { writes?: TupleKey[]; deletes?: TupleKey[] },
): Promise<ApiResult> {
  return api(page, "/api/admin/openfga/tuples", json("POST", body));
}

export async function createTomeProject(
  page: Page,
  env: GridTapEnv,
  label: string,
): Promise<TomeProjectFixture> {
  const name = `${env.prefix}-${label}`.slice(0, 120);
  const result = await api(page, "/api/projects", json("POST", {
    name,
    type: "project",
    description: `Disposable GRID TAP TOME fixture ${env.runId}.`,
    team_id: env.teamSlug,
    domain: "example",
    tags: ["grid-tap", env.runId],
    data_steward: { type: "user", email: env.admin.email },
  }));
  expect(result.status, JSON.stringify(result.body)).toBe(201);
  const data = dataRecord(result);
  const project = typeof data.project === "object" && data.project !== null
    ? data.project as Record<string, unknown>
    : data;
  const id = String(project._id ?? "");
  const slug = String(project.slug ?? "");
  const steward = typeof project.data_steward === "object" && project.data_steward !== null
    ? project.data_steward as Record<string, unknown>
    : {};
  const stewardSubject = String(steward.id ?? env.admin.subject);
  expect(id).not.toBe("");
  expect(slug).toContain(env.prefix.slice(0, Math.min(env.prefix.length, 40)));
  const fixture = { id, slug, object: `document:tome/project/${id}`, stewardSubject };
  await recordResource({ kind: "tome_project", id, slug, object: fixture.object });
  return fixture;
}

export async function writeTomePage(
  page: Page,
  fixture: TomeProjectFixture,
  pagePath: string,
  markdown: string,
): Promise<void> {
  const encodedPath = pagePath.split("/").map(encodeURIComponent).join("/");
  const result = await api(
    page,
    `/api/tome/projects/${encodeURIComponent(fixture.slug)}/pages/${encodedPath}`,
    json("PUT", { markdown, message: `GRID TAP ${pagePath}` }),
  );
  expect(result.status, JSON.stringify(result.body)).toBe(200);
  await recordResource({
    kind: "tome_page",
    id: `${fixture.slug}/${pagePath}`,
    slug: fixture.slug,
    path: pagePath,
  });
}

export async function createTomeGist(
  page: Page,
  fixture: TomeProjectFixture,
  input: { title: string; body: string; tags?: string[] },
): Promise<string> {
  const result = await api(
    page,
    `/api/tome/projects/${encodeURIComponent(fixture.slug)}/gists`,
    json("POST", input),
  );
  expect(result.status, JSON.stringify(result.body)).toBe(201);
  const data = dataRecord(result);
  const gist = typeof data.gist === "object" && data.gist !== null
    ? data.gist as Record<string, unknown>
    : {};
  const id = String(gist.id ?? gist._id ?? "");
  expect(id).not.toBe("");
  await recordResource({ kind: "tome_gist", id, slug: fixture.slug });
  return id;
}

export async function callTomeMcp(
  page: Page,
  name: string,
  args: Record<string, unknown>,
): Promise<ApiResult> {
  return api(page, "/api/tome/mcp", json("POST", {
    jsonrpc: "2.0",
    id: `${name}-${Date.now()}`,
    method: "tools/call",
    params: { name, arguments: args },
  }));
}

export async function apiResponse(
  page: Page,
  path: string,
  init?: BrowserRequestInit,
): Promise<{ status: number; headers: Record<string, string>; text: string; bytes: number[] }> {
  return page.evaluate(async ({ requestPath, requestInit }) => {
    const response = await fetch(requestPath, requestInit);
    const buffer = new Uint8Array(await response.arrayBuffer());
    return {
      status: response.status,
      headers: Object.fromEntries(response.headers.entries()),
      text: new TextDecoder().decode(buffer),
      bytes: Array.from(buffer.slice(0, 8)),
    };
  }, { requestPath: path, requestInit: init });
}

export async function bestEffortCleanupTome(
  page: Page,
  fixture: TomeProjectFixture,
  children: { pages?: string[]; gists?: string[] } = {},
): Promise<void> {
  const listedGists = await api(
    page,
    `/api/tome/projects/${encodeURIComponent(fixture.slug)}/gists`,
  ).catch(() => ({ status: 0, body: null }));
  const gistData = dataRecord(listedGists);
  const discoveredGists = Array.isArray(gistData.gists)
    ? (gistData.gists as Array<Record<string, unknown>>)
      .map((gist) => String(gist.id ?? gist._id ?? ""))
      .filter(Boolean)
    : [];
  const gistIds = [...new Set([...(children.gists ?? []), ...discoveredGists])];
  for (const gist of gistIds.reverse()) {
    await api(
      page,
      `/api/tome/projects/${encodeURIComponent(fixture.slug)}/gists/${encodeURIComponent(gist)}`,
      { method: "DELETE" },
    ).catch(() => undefined);
  }
  const listedPages = await api(
    page,
    `/api/tome/projects/${encodeURIComponent(fixture.slug)}/pages`,
  ).catch(() => ({ status: 0, body: null }));
  const pageData = dataRecord(listedPages);
  const discoveredPages = pageData.pages && typeof pageData.pages === "object"
    ? Object.keys(pageData.pages as Record<string, unknown>)
    : [];
  const pagePaths = [...new Set([...(children.pages ?? []), ...discoveredPages])];
  for (const pagePath of pagePaths.reverse()) {
    const encodedPath = pagePath.split("/").map(encodeURIComponent).join("/");
    await api(
      page,
      `/api/tome/projects/${encodeURIComponent(fixture.slug)}/pages/${encodedPath}`,
      { method: "DELETE" },
    ).catch(() => undefined);
  }
  await api(page, `/api/projects/${encodeURIComponent(fixture.slug)}`, {
    method: "DELETE",
  }).catch(() => undefined);
}
