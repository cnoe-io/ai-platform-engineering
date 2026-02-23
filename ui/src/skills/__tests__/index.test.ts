/**
 * Unit tests for the Skills Template Client.
 *
 * Tests cover:
 * - fetchSkillTemplates: Async template loading from API
 * - invalidateTemplateCache: Cache invalidation
 * - getSkillTemplate: Template lookup by ID (requires populated cache)
 * - getAllTemplateTags: Tag aggregation (requires populated cache)
 * - getTemplatesByCategory: Category-based filtering (requires populated cache)
 *
 * @jest-environment node
 */

import {
  fetchSkillTemplates,
  invalidateTemplateCache,
  getSkillTemplate,
  getAllTemplateTags,
  getTemplatesByCategory,
} from "../index";
import type { SkillTemplate } from "../index";

const MOCK_TEMPLATES: SkillTemplate[] = [
  {
    id: "review-specific-pr",
    name: "review-specific-pr",
    description: "Perform a comprehensive code review",
    title: "Review a Specific PR",
    category: "Development",
    icon: "GitPullRequest",
    tags: ["GitHub", "Code Review", "PR Analysis"],
    content: "---\nname: review-specific-pr\ndescription: Perform a comprehensive code review\n---\n\n# Review a Specific PR\n",
  },
  {
    id: "check-deployment-status",
    name: "check-deployment-status",
    description: "Check the deployment status of ArgoCD apps",
    title: "Check Deployment Status",
    category: "DevOps",
    icon: "Rocket",
    tags: ["ArgoCD", "Kubernetes", "Deployment"],
    content: "---\nname: check-deployment-status\ndescription: Check the deployment status of ArgoCD apps\n---\n\n# Check Deployment Status\n",
  },
  {
    id: "aws-cost-analysis",
    name: "aws-cost-analysis",
    description: "Analyze AWS cloud spending",
    title: "AWS Cost Analysis",
    category: "Cloud",
    icon: "Cloud",
    tags: ["AWS", "FinOps", "Cost"],
    content: "---\nname: aws-cost-analysis\ndescription: Analyze AWS cloud spending\n---\n\n# AWS Cost Analysis\n",
  },
];

const mockFetch = jest.fn();

beforeAll(() => {
  global.fetch = mockFetch as unknown as typeof fetch;
});

beforeEach(() => {
  invalidateTemplateCache();
  mockFetch.mockReset();
});

// ─────────────────────────────────────────────────────────────────────────────
// fetchSkillTemplates
// ─────────────────────────────────────────────────────────────────────────────
describe("fetchSkillTemplates", () => {
  it("should fetch templates from the API", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => MOCK_TEMPLATES,
    });

    const templates = await fetchSkillTemplates();
    expect(templates).toEqual(MOCK_TEMPLATES);
    expect(mockFetch).toHaveBeenCalledWith("/api/skill-templates");
  });

  it("should return cached templates on subsequent calls", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => MOCK_TEMPLATES,
    });

    const first = await fetchSkillTemplates();
    const second = await fetchSkillTemplates();
    expect(first).toEqual(second);
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it("should return empty array on API failure", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 500,
    });

    const templates = await fetchSkillTemplates();
    expect(templates).toEqual([]);
  });

  it("should return empty array on network error", async () => {
    mockFetch.mockRejectedValueOnce(new Error("Network failure"));

    const templates = await fetchSkillTemplates();
    expect(templates).toEqual([]);
  });

  it("should re-fetch after cache invalidation", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => MOCK_TEMPLATES,
    });

    await fetchSkillTemplates();
    expect(mockFetch).toHaveBeenCalledTimes(1);

    invalidateTemplateCache();
    await fetchSkillTemplates();
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it("should deduplicate concurrent requests", async () => {
    let resolvePromise: (value: unknown) => void;
    const delayed = new Promise((r) => { resolvePromise = r; });
    mockFetch.mockReturnValueOnce(
      delayed.then(() => ({
        ok: true,
        json: async () => MOCK_TEMPLATES,
      }))
    );

    const p1 = fetchSkillTemplates();
    const p2 = fetchSkillTemplates();

    resolvePromise!(undefined);

    const [r1, r2] = await Promise.all([p1, p2]);
    expect(r1).toEqual(MOCK_TEMPLATES);
    expect(r2).toEqual(MOCK_TEMPLATES);
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// invalidateTemplateCache
// ─────────────────────────────────────────────────────────────────────────────
describe("invalidateTemplateCache", () => {
  it("should clear the cache so helpers return empty results", () => {
    invalidateTemplateCache();
    expect(getSkillTemplate("review-specific-pr")).toBeUndefined();
    expect(getAllTemplateTags()).toEqual([]);
    expect(getTemplatesByCategory("Development")).toEqual([]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// getSkillTemplate (requires populated cache)
// ─────────────────────────────────────────────────────────────────────────────
describe("getSkillTemplate", () => {
  beforeEach(async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => MOCK_TEMPLATES,
    });
    await fetchSkillTemplates();
  });

  it("should find a template by ID", () => {
    const result = getSkillTemplate("review-specific-pr");
    expect(result).toBeDefined();
    expect(result!.id).toBe("review-specific-pr");
    expect(result!.category).toBe("Development");
  });

  it("should return undefined for a non-existent ID", () => {
    expect(getSkillTemplate("non-existent")).toBeUndefined();
  });

  it("should return undefined for empty string", () => {
    expect(getSkillTemplate("")).toBeUndefined();
  });

  it("should be case-sensitive", () => {
    expect(getSkillTemplate("Review-Specific-PR")).toBeUndefined();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// getAllTemplateTags (requires populated cache)
// ─────────────────────────────────────────────────────────────────────────────
describe("getAllTemplateTags", () => {
  beforeEach(async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => MOCK_TEMPLATES,
    });
    await fetchSkillTemplates();
  });

  it("should return a non-empty sorted array", () => {
    const tags = getAllTemplateTags();
    expect(tags.length).toBeGreaterThan(0);
    const sorted = [...tags].sort();
    expect(tags).toEqual(sorted);
  });

  it("should return unique tags", () => {
    const tags = getAllTemplateTags();
    expect(tags.length).toBe(new Set(tags).size);
  });

  it("should include tags from all templates", () => {
    const tags = getAllTemplateTags();
    expect(tags).toContain("GitHub");
    expect(tags).toContain("ArgoCD");
    expect(tags).toContain("AWS");
  });

  it("should return consistent results", () => {
    expect(getAllTemplateTags()).toEqual(getAllTemplateTags());
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// getTemplatesByCategory (requires populated cache)
// ─────────────────────────────────────────────────────────────────────────────
describe("getTemplatesByCategory", () => {
  beforeEach(async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => MOCK_TEMPLATES,
    });
    await fetchSkillTemplates();
  });

  it("should return templates for a valid category", () => {
    const devOps = getTemplatesByCategory("DevOps");
    expect(devOps.length).toBe(1);
    expect(devOps[0].id).toBe("check-deployment-status");
  });

  it("should return empty for non-existent category", () => {
    expect(getTemplatesByCategory("NonExistent")).toEqual([]);
  });

  it("should return empty for empty string", () => {
    expect(getTemplatesByCategory("")).toEqual([]);
  });

  it("should be case-sensitive", () => {
    expect(getTemplatesByCategory("devops")).toEqual([]);
    expect(getTemplatesByCategory("DevOps").length).toBe(1);
  });

  it("should include all templates across categories", () => {
    const categories = ["Development", "DevOps", "Cloud"];
    let total = 0;
    for (const cat of categories) {
      total += getTemplatesByCategory(cat).length;
    }
    expect(total).toBe(MOCK_TEMPLATES.length);
  });
});
