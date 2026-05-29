import { test, expect } from "./identity-group-rebac-fixture";

test.describe("@rbac ReBAC graph and access checker", () => {
  test("admins can query graph scopes and explain access decisions", async ({ persona, apiContext }) => {
    test.skip(persona !== "alice_admin", "Alice owns graph/access-check smoke coverage");

    const relationship = {
      subject: { type: "team", id: "platform-engineering", relation: "member" },
      action: "use",
      resource: { type: "agent", id: `graph-access-${Date.now()}` },
    };

    const create = await apiContext.post("/api/admin/rebac/change-sets", {
      data: { name: "Graph access smoke", writes: [relationship], deletes: [] },
    });
    expect(create.status()).toBe(201);
    const changeSetId = (await create.json()).data?.change_set?.id;

    expect((await apiContext.post(`/api/admin/rebac/change-sets/${changeSetId}/validate`)).status()).toBe(200);
    expect((await apiContext.post(`/api/admin/rebac/change-sets/${changeSetId}/apply`)).status()).toBe(200);

    const graph = await apiContext.get(
      `/api/admin/rebac/graph?resource_type=agent&resource_id=${relationship.resource.id}`
    );
    expect(graph.status()).toBe(200);
    expect((await graph.json()).data?.edges?.length).toBeGreaterThan(0);

    const check = await apiContext.post("/api/admin/rebac/check", { data: { relationship } });
    expect(check.status()).toBe(200);
    const checkBody = await check.json();
    expect(checkBody.data?.allowed).toBe(true);
    expect(checkBody.data?.explanation?.reason).toBe("relationship_allowed");
  });
});
