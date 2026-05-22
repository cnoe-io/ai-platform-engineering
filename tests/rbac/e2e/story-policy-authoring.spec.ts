import { test, expect } from "./identity-group-rebac-fixture";

test.describe("@rbac ReBAC policy authoring", () => {
  test("admins can stage, validate, apply, and inspect a ReBAC policy change set", async ({
    persona,
    apiContext,
  }) => {
    test.skip(persona !== "alice_admin", "Alice owns policy-authoring smoke coverage");

    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const relationship = {
      subject: { type: "team", id: "platform-engineering", relation: "member" },
      action: "use",
      resource: { type: "agent", id: `policy-authoring-${suffix}` },
    };

    const create = await apiContext.post("/api/admin/rebac/change-sets", {
      data: {
        name: `Policy authoring ${suffix}`,
        writes: [relationship],
        deletes: [],
      },
    });
    expect(create.status()).toBe(201);
    const createBody = await create.json();
    const changeSetId = createBody.data?.change_set?.id;
    expect(changeSetId).toBeTruthy();

    const validate = await apiContext.post(`/api/admin/rebac/change-sets/${changeSetId}/validate`);
    expect(validate.status()).toBe(200);
    const validateBody = await validate.json();
    expect(validateBody.data?.validation?.valid).toBe(true);

    const apply = await apiContext.post(`/api/admin/rebac/change-sets/${changeSetId}/apply`);
    expect(apply.status()).toBe(200);
    const applyBody = await apply.json();
    expect(applyBody.data?.change_set?.status).toBe("applied");

    const relationships = await apiContext.get(
      `/api/admin/rebac/resources/agent/${relationship.resource.id}/relationships`
    );
    expect(relationships.status()).toBe(200);
  });
});
