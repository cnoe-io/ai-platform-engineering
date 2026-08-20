import { expect, test as base, type Page, type TestInfo } from "@playwright/test";
import { installTestSession } from "../rbac/_helpers";
import type { RbacEnv } from "../rbac/_env";
import type { CaipeTapEnv } from "./_env";

export type TupleKey = { user: string; relation: string; object: string };
export type ApiResult = { status: number; body: unknown };
export type ApiRequestInit = {
  method?: string;
  headers?: Record<string, string>;
  body?: string;
};

export const test = base;
export { expect };

test.afterEach(async ({ page }, testInfo) => {
  if (!page.isClosed()) {
    const image = await page.screenshot({ fullPage: true });
    await testInfo.attach("final-state", { body: image, contentType: "image/png" });
  }
});

export async function installPersona(page: Page, env: CaipeTapEnv, persona: "admin" | "member"): Promise<void> {
  const selected = env[persona];
  const rbacEnv: RbacEnv = {
    baseUrl: env.baseUrl,
    keycloakUrl: env.baseUrl,
    keycloakRealm: "caipe-regression-suite",
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
export async function api(page: Page, path: string, init?: ApiRequestInit): Promise<ApiResult> {
  return page.evaluate(async ({ requestPath, requestInit }) => {
    const response = await fetch(requestPath, requestInit);
    let body: unknown;
    try {
      body = await response.json();
    } catch {
      body = await response.text();
    }
    return { status: response.status, body };
  }, { requestPath: path, requestInit: init });
}

export function json(method: string, body: unknown): ApiRequestInit {
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
