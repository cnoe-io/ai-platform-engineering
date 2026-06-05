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
  });
});
