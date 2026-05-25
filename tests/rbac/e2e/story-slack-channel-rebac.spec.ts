import { test, expect } from "./identity-group-rebac-fixture";

test.describe("@rbac Slack channel ReBAC", () => {
  test("admins can grant a channel multiple resources and check access", async ({ persona, apiContext }) => {
    test.skip(persona !== "alice_admin", "Alice owns Slack channel ReBAC smoke coverage");

    const workspaceId = "TUS6SMOKE";
    const channelId = "CUS6SMOKE";
    const resourceId = `slack-agent-${Date.now()}`;

    const put = await apiContext.put(
      `/api/admin/slack/channels/${workspaceId}/${channelId}/resources`,
      {
        data: {
          grants: [{ resource: { type: "agent", id: resourceId }, actions: ["use"] }],
        },
      }
    );
    expect(put.status()).toBe(200);
    expect((await put.json()).data?.grants?.length).toBeGreaterThan(0);

    const resources = await apiContext.get(
      `/api/admin/slack/channels/${workspaceId}/${channelId}/resources`
    );
    expect(resources.status()).toBe(200);
    expect((await resources.json()).data?.grants?.[0]?.resource?.id).toBe(resourceId);

    const check = await apiContext.post(
      `/api/admin/slack/channels/${workspaceId}/${channelId}/access-check`,
      {
        data: {
          user_subject: "team:platform-engineering#member",
          resource: { type: "agent", id: resourceId },
          action: "use",
        },
      }
    );
    expect(check.status()).toBe(200);
  });
});
