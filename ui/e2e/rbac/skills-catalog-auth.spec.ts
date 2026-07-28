/**
 * Regression: skills catalog API returned 0 skills for non-browser callers.
 *
 * Root cause: both the X-Caipe-Catalog-Key path and the local skills JWT path
 * in getAuthFromBearerOrSession returned a session without `sub`, causing
 * filterSkillsByOpenFga to short-circuit to [] for every request.
 *
 * These tests run against a live stack and require:
 *   RUN_RBAC_E2E=1            — standard RBAC e2e gate
 *   CAIPE_CATALOG_API_KEY     — catalog API key (same one caipe-skills.py uses)
 *   NEXTAUTH_SECRET           — to mint a test session cookie for the JWT test
 *
 * @see ui/src/app/api/skills/route.ts — filterSkillsByOpenFga
 * @see ui/src/lib/api-middleware.ts   — getAuthFromBearerOrSession
 */

import { test, expect } from "@playwright/test";
import { rbacEnvOrSkip } from "./_env";
import { installTestSession } from "./_helpers";

test.describe("Skills catalog API — auth subject regression", () => {
  // ---------------------------------------------------------------------------
  // Catalog API key path  (X-Caipe-Catalog-Key)
  // ---------------------------------------------------------------------------

  test("catalog API key returns non-zero skills including hub skills", async ({
    request,
  }) => {
    const env = rbacEnvOrSkip();

    const apiKey = process.env.CAIPE_CATALOG_API_KEY;
    test.skip(!apiKey, "CAIPE_CATALOG_API_KEY not set — skipping catalog key regression.");

    const resp = await request.get(`${env.baseUrl}/api/skills`, {
      headers: { "X-Caipe-Catalog-Key": apiKey! },
    });

    expect(resp.ok()).toBe(true);
    const body = (await resp.json()) as {
      skills: Array<{ id: string; source: string }>;
      meta: { total: number; sources_loaded: string[] };
    };

    // Before the fix this was always 0.
    expect(body.meta.total).toBeGreaterThan(0);

    // Hub skills require the isCatalogKey bypass to fire.  If the subject
    // string comparison was wrong ("catalog-key-user@local" vs the actual
    // "user:catalog-key-user@local" the route passes), hub skills would be
    // filtered out by OpenFGA and only default filesystem skills would appear.
    const sources = new Set(body.skills.map((s) => s.source));
    expect(sources.has("hub")).toBe(true);
    expect(sources.has("default")).toBe(true);
  });

  test("catalog API key does not expose private agent_skills (no visibility field)", async ({
    request,
  }) => {
    // The catalog key bypass only returns default + hub + *global* agent_skills.
    // Private / team-scoped agent_skills must not appear in a machine-caller
    // response even if the key is accepted.
    const env = rbacEnvOrSkip();

    const apiKey = process.env.CAIPE_CATALOG_API_KEY;
    test.skip(!apiKey, "CAIPE_CATALOG_API_KEY not set — skipping catalog key regression.");

    const resp = await request.get(`${env.baseUrl}/api/skills?source=agent_skills`, {
      headers: { "X-Caipe-Catalog-Key": apiKey! },
    });

    expect(resp.ok()).toBe(true);
    const body = (await resp.json()) as {
      skills: Array<{ source: string; visibility?: string }>;
    };

    // Every agent_skill returned must be explicitly visibility:global.
    for (const skill of body.skills) {
      expect(skill.visibility ?? "global").toBe("global");
    }
  });

  // ---------------------------------------------------------------------------
  // Local skills JWT path  (Authorization: Bearer <HS256>)
  // ---------------------------------------------------------------------------

  test("local skills JWT returns non-zero skills", async ({ page }) => {
    const env = rbacEnvOrSkip();

    test.skip(
      !process.env.NEXTAUTH_SECRET,
      "NEXTAUTH_SECRET not set — cannot mint test session for /api/skills/token.",
    );

    // Mint a session cookie so /api/skills/token accepts the request.
    await installTestSession(page, env, {
      email: env.user.email,
      subject: env.user.sub ?? env.user.email,
      role: "admin",
    });

    // Exchange the session for a local skills JWT.
    const tokenResp = await page.request.post(`${env.baseUrl}/api/skills/token`);
    expect(tokenResp.ok()).toBe(true);
    const { token } = (await tokenResp.json()) as { token: string };
    expect(typeof token).toBe("string");

    // Call /api/skills with ONLY the Bearer token — no session cookie — so
    // the request goes through the local skills JWT path, not the NextAuth path.
    const skillsResp = await page.request.get(`${env.baseUrl}/api/skills`, {
      headers: { Authorization: `Bearer ${token}` },
      ignoreHTTPSErrors: true,
    });

    expect(skillsResp.ok()).toBe(true);
    const body = (await skillsResp.json()) as {
      skills: Array<{ id: string; source: string }>;
      meta: { total: number };
    };

    // Before the fix this was always 0 because session.sub was not set for
    // local skills JWTs, causing filterSkillsByOpenFga to return [].
    expect(body.meta.total).toBeGreaterThan(0);

    // Default skills pass through without OpenFGA for any authenticated user.
    const sources = new Set(body.skills.map((s) => s.source));
    expect(sources.has("default")).toBe(true);
  });

  // ---------------------------------------------------------------------------
  // Unauthenticated  (regression guard — must stay 401)
  // ---------------------------------------------------------------------------

  test("unauthenticated request returns 401", async ({ request }) => {
    const env = rbacEnvOrSkip();

    const resp = await request.get(`${env.baseUrl}/api/skills`);
    expect(resp.status()).toBe(401);
  });
});
