import { SPEAKERS_COLLECTIVE_MANIFEST } from "../../../../apps/agentic-apps/speakers-collective/manifest.mjs";

import { resolveAgenticAppHttpPolicyAction } from "../policy-routing";

describe("Agentic App HTTP policy routing", () => {
  it.each([
    ["POST", "/api/proposals", "proposal:create", "write", ["speakers-collective:propose"]],
    ["POST", "/api/refresh", "refresh:start", "write", ["speakers-collective:refresh"]],
    ["POST", "/api/proposals/proposal-1/review", "proposal:review", "approve", ["speakers-collective:approve"]],
    ["POST", "/api/publications", "publication:create", "manage", ["speakers-collective:publish"]],
    ["POST", "/api/versions/version-1/rollback", "version:rollback", "manage", ["speakers-collective:publish"]],
  ])("maps %s %s to the least-privilege action", (method, path, action, casAction, scopes) => {
    expect(resolveAgenticAppHttpPolicyAction(SPEAKERS_COLLECTIVE_MANIFEST, method, path)).toMatchObject({
      action,
      casAction,
      requiredScopes: scopes,
    });
  });

  it("fails closed for undeclared writes", () => {
    expect(resolveAgenticAppHttpPolicyAction(
      SPEAKERS_COLLECTIVE_MANIFEST,
      "POST",
      "/api/not-declared",
    )).toBeUndefined();
  });

  it("retains method-only routing for read requests", () => {
    expect(resolveAgenticAppHttpPolicyAction(
      SPEAKERS_COLLECTIVE_MANIFEST,
      "GET",
      "/assets/app.js",
    )?.action).toBe("proxy:GET");
  });
});
