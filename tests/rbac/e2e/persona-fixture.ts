/**
 * Playwright persona fixture — spec 102 task T056.
 *
 * Wraps `tests/rbac/fixtures/keycloak.ts` so each spec can do:
 *
 *   import { test, expect } from "./persona-fixture";
 *   test("alice can list users", async ({ apiContext, persona }) => {
 *     const r = await apiContext.get("/api/admin/users");
 *     expect(r.status()).toBe(200);
 *   });
 *
 * The `persona` is auto-resolved from the project metadata
 * (`projects[i].metadata.persona` in `playwright.config.ts`). The
 * `apiContext` is a `request` context scoped to the e2e UI URL with the
 * persona's bearer token pre-set on every outbound request.
 */

import { test as base, expect, request as playwrightRequest } from "@playwright/test";
import type { APIRequestContext } from "@playwright/test";

import {
  PERSONAS,
  type PersonaName,
  type PersonaToken,
  getPersonaToken,
} from "../fixtures/keycloak";

interface PersonaFixtures {
  persona: PersonaName;
  personaToken: PersonaToken;
  apiContext: APIRequestContext;
}

export const test = base.extend<PersonaFixtures>({
  persona: async ({}, use, testInfo) => {
    const meta = testInfo.project.metadata as { persona?: PersonaName } | undefined;
    const name = meta?.persona;
    if (!name || !PERSONAS.includes(name)) {
      throw new Error(
        `playwright project '${testInfo.project.name}' is missing metadata.persona; ` +
          `set it in tests/rbac/e2e/playwright.config.ts`
      );
    }
    await use(name);
  },
  personaToken: async ({ persona }, use) => {
    const token = await getPersonaToken(persona);
    await use(token);
  },
  apiContext: async ({ personaToken, baseURL }, use) => {
    const ctx = await playwrightRequest.newContext({
      baseURL,
      extraHTTPHeaders: {
        Authorization: `Bearer ${personaToken.accessToken}`,
        "Content-Type": "application/json",
      },
    });
    await use(ctx);
    await ctx.dispose();
  },
});

export { expect };
