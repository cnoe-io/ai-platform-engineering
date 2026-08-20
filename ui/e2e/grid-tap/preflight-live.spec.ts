import { gridTapEnvOrSkip } from "./_env";
import { api, attachEvidence, evidenceScreenshot, expect, expectTuple, installPersona, json, test } from "./_helpers";

test.describe("GRID TAP production preflight", () => {
  test("@smoke identities, health, shared team, and OpenFGA membership are ready", async ({ page }, testInfo) => {
    const env = gridTapEnvOrSkip();
    await installPersona(page, env, "admin");

    const health = await api(page, "/api/health");
    expect([200, 404], JSON.stringify(health.body)).toContain(health.status);
    await expectTuple(page, { user: `user:${env.admin.subject}`, relation: "member", object: `team:${env.teamSlug}` });
    await expectTuple(page, { user: `user:${env.member.subject}`, relation: "member", object: `team:${env.teamSlug}` });

    const modelChecks = [
      // Probe only writable base relations in the current contract. Derived
      // capabilities are validated through CAS in the visibility tests, and
      // the retired mcp_server#private_marker relation must not be required.
      { user: `user:${env.admin.subject}`, relation: "owner", object: "mcp_server:grid-tap-model-check" },
      { user: `team:${env.teamSlug}#member`, relation: "invoker", object: "mcp_server:grid-tap-model-check" },
      { user: `user:${env.admin.subject}`, relation: "owner", object: "secret_ref:grid-tap-model-check" },
      { user: `organization:${env.orgKey}#member`, relation: "metadata_reader", object: "secret_ref:grid-tap-model-check" },
      { user: `team:${env.teamSlug}#member`, relation: "reader", object: "document:grid-tap-model-check" },
      { user: `user:${env.admin.subject}`, relation: "writer", object: "document:grid-tap-model-check" },
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
    const tomeProjects = await api(page, "/api/projects?type=all&q=grid-tap-preflight-no-match");
    expect(tomeProjects.status, JSON.stringify(tomeProjects.body)).toBe(200);
    const tomeMcp = await api(page, "/api/tome/mcp", json("POST", {
      jsonrpc: "2.0",
      id: "grid-tap-preflight",
      method: "ping",
    }));
    expect(tomeMcp.status, JSON.stringify(tomeMcp.body)).toBe(200);
    await attachEvidence(testInfo, "preflight", {
      target: env.baseUrl,
      team: env.teamSlug,
      health,
      session: session.body,
      modelResults,
      tomeProjects,
      tomeMcp,
    });
    await page.goto("/admin?cat=people&tab=teams", { waitUntil: "domcontentloaded" });
    await evidenceScreenshot(page, testInfo, "preflight-team");
  });
});
