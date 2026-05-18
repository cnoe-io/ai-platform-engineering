import { ApiError } from "@/lib/api-error";

import {
  filterResourcesByPermission,
  openFgaRelationForResourceAction,
  requireResourcePermission,
} from "../resource-authz";

describe("resource-authz", () => {
  it("maps UI resource actions to OpenFGA check relations", () => {
    expect(openFgaRelationForResourceAction("list")).toBe("can_discover");
    expect(openFgaRelationForResourceAction("discover")).toBe("can_discover");
    expect(openFgaRelationForResourceAction("read")).toBe("can_read");
    expect(openFgaRelationForResourceAction("use")).toBe("can_use");
    expect(openFgaRelationForResourceAction("write")).toBe("can_write");
    expect(openFgaRelationForResourceAction("admin")).toBe("can_manage");
    expect(openFgaRelationForResourceAction("manage")).toBe("can_manage");
    expect(openFgaRelationForResourceAction("share")).toBe("can_share");
    expect(openFgaRelationForResourceAction("delete")).toBe("can_delete");
    expect(openFgaRelationForResourceAction("ingest")).toBe("can_ingest");
    expect(openFgaRelationForResourceAction("call")).toBe("can_call");
    expect(openFgaRelationForResourceAction("invoke")).toBe("can_invoke");
    expect(openFgaRelationForResourceAction("audit")).toBe("can_audit");
  });

  it("requires a stable subject and fails closed when missing", async () => {
    await expect(
      requireResourcePermission(
        {},
        { type: "skill", id: "incident-triage", action: "read" },
        { check: async () => ({ allowed: true }) }
      )
    ).rejects.toMatchObject({
      statusCode: 401,
      code: "NO_SUBJECT",
    });
  });

  it("checks the expected OpenFGA tuple and denies on false", async () => {
    const checked: string[] = [];

    await expect(
      requireResourcePermission(
        { sub: "alice-sub", user: { email: "alice@example.test" } },
        { type: "conversation", id: "c1", action: "share" },
        {
          check: async (tuple) => {
            checked.push(`${tuple.user} ${tuple.relation} ${tuple.object}`);
            return { allowed: false };
          },
        }
      )
    ).rejects.toBeInstanceOf(ApiError);

    expect(checked).toEqual(["user:alice-sub can_share conversation:c1"]);
  });

  it("allows when OpenFGA returns true", async () => {
    await expect(
      requireResourcePermission(
        { sub: " alice-sub " },
        { type: "system_config", id: "platform_settings", action: "admin" },
        {
          check: async (tuple) => {
            expect(tuple).toEqual({
              user: "user:alice-sub",
              relation: "can_manage",
              object: "system_config:platform_settings",
            });
            return { allowed: true };
          },
        },
      ),
    ).resolves.toBeUndefined();
  });

  it("bypasses object checks for admins only when explicitly allowed", async () => {
    const check = jest.fn(async () => ({ allowed: false }));

    await expect(
      requireResourcePermission(
        { sub: "admin-sub", role: "admin" },
        { type: "admin_surface", id: "skill-scan-all", action: "admin" },
        { allowAdminBypass: true, check },
      ),
    ).resolves.toBeUndefined();

    expect(check).not.toHaveBeenCalled();
  });

  it("filters resources by permission without leaking denied objects", async () => {
    const resources = [{ id: "a1" }, { id: "a2" }];

    const visible = await filterResourcesByPermission(
      { sub: "alice-sub" },
      resources,
      {
        type: "agent",
        action: "use",
        id: (resource) => resource.id,
      },
      {
        check: async (tuple) => ({ allowed: tuple.object === "agent:a2" }),
      }
    );

    expect(visible).toEqual([{ id: "a2" }]);
  });

  it("returns an empty resource list when the subject is missing", async () => {
    const visible = await filterResourcesByPermission(
      {},
      [{ id: "secret" }],
      {
        type: "knowledge_base",
        action: "read",
        id: (resource) => resource.id,
      },
      { check: async () => ({ allowed: true }) },
    );

    expect(visible).toEqual([]);
  });

  it("drops resources whose OpenFGA check errors", async () => {
    const visible = await filterResourcesByPermission(
      { sub: "alice-sub" },
      [{ id: "ok" }, { id: "error" }],
      {
        type: "skill",
        action: "read",
        id: (resource) => resource.id,
      },
      {
        check: async (tuple) => {
          if (tuple.object === "skill:error") {
            throw new Error("pdp unavailable for one object");
          }
          return { allowed: true };
        },
      },
    );

    expect(visible).toEqual([{ id: "ok" }]);
  });
});
