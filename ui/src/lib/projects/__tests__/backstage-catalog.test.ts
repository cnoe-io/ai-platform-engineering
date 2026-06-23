import { buildDefaultComponents, buildProjectCatalog, catalogToYaml } from "@/lib/projects/backstage-catalog";

describe("backstage-catalog", () => {
  it("builds System catalog matching Outshift backstage shape", () => {
    const catalog = buildProjectCatalog({
      name: "PyramID",
      description: "Agntcy Identity Project",
      teamSlug: "outshift-ioa-identity-team",
      domain: "outshift_ventures",
      tags: ["identity"],
      ostinatoId: "209a263b-696b-4cf3-8072-949aecb75b9b",
    });

    expect(catalog.apiVersion).toBe("backstage.io/v1alpha1");
    expect(catalog.kind).toBe("System");
    expect(catalog.metadata.name).toBe("pyramid");
    expect(catalog.spec.owner).toBe("group:outshift-ioa-identity-team");
    expect(catalog.spec.outshift?.rbac?.tools?.map((t) => t.name)).toEqual([
      "backstage",
      "github",
      "vault",
    ]);

    const yaml = catalogToYaml(catalog);
    expect(yaml).toContain("kind: System");
    expect(yaml).toContain("outshift_ventures");
  });

  it("generates default components for a project", () => {
    const components = buildDefaultComponents("pyramid", "outshift-ioa-identity-team", "PyramID");
    expect(components).toHaveLength(2);
    expect(components[0].spec.system).toBe("pyramid");
  });
});
