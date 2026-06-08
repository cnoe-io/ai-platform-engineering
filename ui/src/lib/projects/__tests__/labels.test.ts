// assisted-by claude code claude-opus-4-8

import {
  cleanLabelList,
  computeFacets,
  normLabel,
  projectMatchesLabels,
  sanitizeLabels,
} from "@/lib/projects/labels";
import type { ProjectDocument } from "@/types/projects";

function proj(over: Partial<ProjectDocument>): ProjectDocument {
  return {
    slug: "p",
    name: "P",
    title: "P",
    description: "",
    team_id: "t",
    team_slug: "t",
    team_name: "T",
    owner_id: "o",
    member_ids: [],
    domain: "",
    tags: [],
    status: "active",
    catalog: {} as ProjectDocument["catalog"],
    components: [],
    onboarding: {},
    integrations: {},
    created_at: new Date(0),
    updated_at: new Date(0),
    ...over,
  };
}

describe("labels", () => {
  it("normalizes case + whitespace", () => {
    expect(normLabel("  Agentic   2026 ")).toBe("agentic 2026");
  });

  it("cleans + dedups a list case-insensitively, keeping first spelling", () => {
    expect(cleanLabelList(["Platform", "platform ", "", 5, "AI"])).toEqual([
      "Platform",
      "AI",
    ]);
  });

  it("sanitizeLabels applies domain fallback + cleans", () => {
    expect(sanitizeLabels({ initiatives: ["X", "x"], swimlanes: [" Now "] }, "Platform")).toEqual(
      { domain: "Platform", initiatives: ["X"], swimlanes: ["Now"] },
    );
  });

  it("computeFacets groups by normalized key with counts", () => {
    const facets = computeFacets([
      proj({ labels: { domain: "Platform", initiatives: ["Agentic"], swimlanes: ["Now"] } }),
      proj({ labels: { domain: "platform", initiatives: ["agentic", "GenAI"] } }),
      proj({ domain: "Data" }), // falls back to top-level domain
    ]);
    expect(facets.total).toBe(3);
    expect(facets.domains).toEqual([
      { value: "Platform", count: 2 },
      { value: "Data", count: 1 },
    ]);
    expect(facets.initiatives.find((f) => f.value === "Agentic")?.count).toBe(2);
    expect(facets.swimlanes).toEqual([{ value: "Now", count: 1 }]);
  });

  describe("projectMatchesLabels (AND across dims, OR within)", () => {
    const p = proj({ labels: { domain: "Platform", initiatives: ["Agentic"], swimlanes: ["Now", "Q3"] } });
    it("matches with no filter", () => {
      expect(projectMatchesLabels(p, {})).toBe(true);
    });
    it("matches domain case-insensitively", () => {
      expect(projectMatchesLabels(p, { domains: ["platform"] })).toBe(true);
    });
    it("OR within a dimension", () => {
      expect(projectMatchesLabels(p, { swimlanes: ["q3", "later"] })).toBe(true);
    });
    it("AND across dimensions fails if one misses", () => {
      expect(projectMatchesLabels(p, { domains: ["Platform"], initiatives: ["Other"] })).toBe(false);
    });
    it("falls back to top-level domain", () => {
      expect(projectMatchesLabels(proj({ domain: "Data" }), { domains: ["data"] })).toBe(true);
    });
  });
});
