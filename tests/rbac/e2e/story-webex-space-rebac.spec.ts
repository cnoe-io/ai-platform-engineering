import { test, expect } from "./identity-group-rebac-fixture";

test.describe("@rbac Webex space ReBAC", () => {
  test("admins can grant a space an agent and check access", async ({ persona, apiContext }) => {
    test.skip(persona !== "alice_admin", "Alice owns Webex space ReBAC smoke coverage");

    const workspaceId = "CAIPE";
    const spaceId = `webex-space-${Date.now()}`;
    const resourceId = `webex-agent-${Date.now()}`;

    const put = await apiContext.put(
      `/api/admin/webex/spaces/${workspaceId}/${spaceId}/resources`,
      {
        data: {
          grants: [{ resource: { type: "agent", id: resourceId }, actions: ["use"] }],
        },
      }
    );
    expect(put.status()).toBe(200);
    expect((await put.json()).data?.grants?.length).toBeGreaterThan(0);

    const resources = await apiContext.get(
      `/api/admin/webex/spaces/${workspaceId}/${spaceId}/resources`
    );
    expect(resources.status()).toBe(200);
    expect((await resources.json()).data?.grants?.[0]?.resource?.id).toBe(resourceId);

    const check = await apiContext.post(
      `/api/integrations/webex/spaces/${workspaceId}/${spaceId}/access-check`,
      {
        data: {
          resource: { type: "agent", id: resourceId },
          action: "use",
        },
      }
    );
    expect(check.status()).toBe(200);
    const checkBody = await check.json();
    // Space-grant-only model: allowed and space_allowed must be true; no user_allowed field.
    expect(checkBody.data?.allowed).toBe(true);
    expect(checkBody.data?.space_allowed).toBe(true);
    expect(checkBody.data?.user_allowed).toBeUndefined();
    expect(checkBody.data?.reason).toBe("allowed");
  });

  test("access-check returns denied before any grant is written", async ({ persona, apiContext }) => {
    test.skip(persona !== "alice_admin", "Alice owns Webex space ReBAC smoke coverage");

    const workspaceId = "CAIPE";
    // Unique IDs — no grant will exist for these.
    const spaceId = `webex-nogrant-${Date.now()}`;
    const resourceId = `webex-agent-nogrant-${Date.now()}`;

    const check = await apiContext.post(
      `/api/integrations/webex/spaces/${workspaceId}/${spaceId}/access-check`,
      {
        data: {
          resource: { type: "agent", id: resourceId },
          action: "use",
        },
      }
    );
    expect(check.status()).toBe(200);
    const body = await check.json();
    expect(body.data?.allowed).toBe(false);
    expect(body.data?.space_allowed).toBe(false);
    expect(body.data?.reason).toBe("missing_space_grant");
  });

  test("admin access-check route is removed", async ({ persona, apiContext }) => {
    test.skip(persona !== "alice_admin", "Alice owns Webex space ReBAC smoke coverage");

    // /api/admin/webex/spaces/.../access-check was deleted in this PR;
    // the runtime route at /api/integrations/... is the only check endpoint.
    const workspaceId = "CAIPE";
    const spaceId = `webex-space-${Date.now()}`;

    const check = await apiContext.post(
      `/api/admin/webex/spaces/${workspaceId}/${spaceId}/access-check`,
      {
        data: {
          resource: { type: "agent", id: "some-agent" },
          action: "use",
        },
      }
    );
    expect(check.status()).toBe(404);
  });
});
