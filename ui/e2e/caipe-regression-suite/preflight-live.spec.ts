import { caipeTapEnvOrSkip } from "./_env";
import { api, attachEvidence, evidenceScreenshot, expect, expectTuple, installPersona, json, test } from "./_helpers";

test.describe("CAIPE Regression Suite production preflight", () => {
  test("@smoke identities, health, shared team, and OpenFGA membership are ready", async ({ page }, testInfo) => {
    const env = caipeTapEnvOrSkip();
    await installPersona(page, env, "admin");

    const health = await api(page, "/api/health");
    expect([200, 404], JSON.stringify(health.body)).toContain(health.status);
    await expectTuple(page, { user: `user:${env.admin.subject}`, relation: "member", object: `team:${env.teamSlug}` });
    await expectTuple(page, { user: `user:${env.member.subject}`, relation: "member", object: `team:${env.teamSlug}` });

    const modelChecks = [
      { user: `user:${env.admin.subject}`, relation: "creator", object: "mcp_server:caipe-regression-suite-model-check" },
      { user: `organization:${env.orgKey}#admin`, relation: "private_marker", object: "mcp_server:caipe-regression-suite-model-check" },
      { user: `user:${env.admin.subject}`, relation: "creator", object: "secret_ref:caipe-regression-suite-model-check" },
      { user: `organization:${env.orgKey}#member`, relation: "metadata_reader", object: "secret_ref:caipe-regression-suite-model-check" },
    ];
    const modelResults = [];
    for (const tuple of modelChecks) {
      const result = await api(page, "/api/admin/openfga/check", json("POST", { tuple }));
      modelResults.push({ tuple, result });
      expect(
        result.status,
        `Deployed OpenFGA model is incompatible with the application tuple contract: ${JSON.stringify(result.body)}`,
      ).toBe(200);
    }

    const session = await api(page, "/api/auth/session");
    expect(session.status, JSON.stringify(session.body)).toBe(200);
    await attachEvidence(testInfo, "preflight", {
      target: env.baseUrl,
      team: env.teamSlug,
      health,
      session: session.body,
      modelResults,
    });
    await page.goto("/admin?cat=people&tab=teams", { waitUntil: "domcontentloaded" });
    await evidenceScreenshot(page, testInfo, "preflight-team");
  });
});
