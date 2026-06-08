import { detectBackstageConflicts } from "@/lib/projects/backstage-sync";
import type { BackstageSystemSummary } from "@/lib/projects/backstage-client";
import type { ProjectDocument } from "@/types/projects";

describe("backstage-sync", () => {
  const summary: BackstageSystemSummary = {
    entityRef: "system:default/demo",
    slug: "demo",
    title: "Backstage Title",
    description: "Backstage description",
    domain: "platform",
    owner: "group:team-a",
    tags: ["caipe"],
    catalog: {
      apiVersion: "backstage.io/v1alpha1",
      kind: "System",
      metadata: {
        name: "demo",
        title: "Backstage Title",
        description: "Backstage description",
        annotations: {},
        tags: [],
      },
      spec: { owner: "group:team-a", domain: "platform", type: "service" },
    },
    components: [],
  };

  const local = {
    slug: "demo",
    title: "Local Title",
    description: "Local description",
    domain: "platform",
    catalog: { spec: { owner: "group:team-b" } },
  } as ProjectDocument;

  it("detects differing fields", () => {
    const conflicts = detectBackstageConflicts(local, summary);
    expect(conflicts.map((c) => c.field).sort()).toEqual(
      ["description", "owner", "title"].sort(),
    );
  });
});
