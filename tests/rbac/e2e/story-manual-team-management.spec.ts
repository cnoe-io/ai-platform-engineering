import { request as playwrightRequest } from "@playwright/test";

import { test, expect } from "./identity-group-rebac-fixture";
import { getPersonaToken } from "../fixtures/keycloak";

test.describe("@rbac Manual team membership management", () => {
  test("scoped team admins can manage only their delegated team", async ({
    persona,
    apiContext,
    baseURL,
  }) => {
    test.skip(persona !== "alice_admin", "Alice provisions the delegated-team scenario");

    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const managedSlug = `manual-us2-${suffix}`;
    const unrelatedSlug = `manual-us2-other-${suffix}`;

    const createManaged = await apiContext.post("/api/admin/teams", {
      data: { name: `Manual US2 ${suffix}`, slug: managedSlug },
    });
    expect(createManaged.status()).toBe(201);
    const managedBody = await createManaged.json();
    const managedTeamId = managedBody.data?.team_id;
    expect(managedTeamId).toBeTruthy();

    const delegateBob = await apiContext.post(`/api/admin/teams/${managedTeamId}/members`, {
      data: { user_id: "bob@example.com", role: "admin" },
    });
    expect(delegateBob.status()).toBe(201);

    const createUnrelated = await apiContext.post("/api/admin/teams", {
      data: { name: `Manual US2 Other ${suffix}`, slug: unrelatedSlug },
    });
    expect(createUnrelated.status()).toBe(201);
    const unrelatedBody = await createUnrelated.json();
    const unrelatedTeamId = unrelatedBody.data?.team_id;
    expect(unrelatedTeamId).toBeTruthy();

    const bob = await getPersonaToken("bob_chat_user");
    const bobContext = await playwrightRequest.newContext({
      baseURL,
      extraHTTPHeaders: {
        Authorization: `Bearer ${bob.accessToken}`,
        "Content-Type": "application/json",
      },
    });

    try {
      const addCarol = await bobContext.post(`/api/admin/teams/${managedTeamId}/members`, {
        data: { user_id: "carol@example.com", role: "member" },
      });
      expect(addCarol.status()).toBe(201);

      const addEveElsewhere = await bobContext.post(
        `/api/admin/teams/${unrelatedTeamId}/members`,
        { data: { user_id: "eve@example.com", role: "member" } }
      );
      expect(addEveElsewhere.status()).toBe(403);
    } finally {
      await bobContext.dispose();
    }
  });
});
