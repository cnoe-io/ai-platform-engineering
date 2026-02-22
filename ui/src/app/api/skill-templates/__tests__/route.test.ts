/**
 * @jest-environment node
 */
/**
 * Tests for Skill Templates API Route
 *
 * Covers:
 * - GET /api/skill-templates — returns templates from filesystem
 * - Folder-per-skill layout (local dev)
 * - Flat ConfigMap layout (Kubernetes)
 * - Cache behavior (30s TTL)
 * - Error handling (missing dir, corrupt files)
 * - Frontmatter parsing
 * - Metadata merging
 */

import { NextRequest } from "next/server";
import fs from "fs";
import path from "path";
import os from "os";

// Mock withErrorHandler to pass through
jest.mock("@/lib/api-middleware", () => ({
  withErrorHandler: (handler: Function) => handler,
  ApiError: class ApiError extends Error {
    constructor(
      message: string,
      public statusCode: number
    ) {
      super(message);
    }
  },
}));

let tmpDir: string;

function createFolderLayout(
  skills: Array<{
    id: string;
    skillMd: string;
    metadata?: Record<string, unknown>;
  }>
) {
  for (const skill of skills) {
    const skillDir = path.join(tmpDir, skill.id);
    fs.mkdirSync(skillDir, { recursive: true });
    fs.writeFileSync(path.join(skillDir, "SKILL.md"), skill.skillMd);
    if (skill.metadata) {
      fs.writeFileSync(
        path.join(skillDir, "metadata.json"),
        JSON.stringify(skill.metadata)
      );
    }
  }
}

function createFlatLayout(
  skills: Array<{
    id: string;
    skillMd: string;
    metadata?: Record<string, unknown>;
  }>
) {
  for (const skill of skills) {
    fs.writeFileSync(path.join(tmpDir, `${skill.id}--SKILL.md`), skill.skillMd);
    if (skill.metadata) {
      fs.writeFileSync(
        path.join(tmpDir, `${skill.id}--metadata.json`),
        JSON.stringify(skill.metadata)
      );
    }
  }
}

const SAMPLE_SKILL = `---
name: test-skill
description: A test skill for unit testing
---

# Test Skill

## Instructions

Do something useful.

## Examples

- Example 1
`;

const SAMPLE_METADATA = {
  title: "Test Skill",
  category: "Testing",
  icon: "Bug",
  tags: ["Test", "Unit"],
};

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "skill-templates-test-"));
  process.env.SKILLS_DIR = tmpDir;
  jest.resetModules();
});

afterEach(() => {
  delete process.env.SKILLS_DIR;
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

async function callGET() {
  const { GET } = await import("../route");
  const request = new NextRequest("http://localhost:3000/api/skill-templates");
  return GET(request);
}

// ─────────────────────────────────────────────────────────────────────────────
// Folder-per-skill layout
// ─────────────────────────────────────────────────────────────────────────────
describe("folder-per-skill layout", () => {
  it("should load templates from subdirectories", async () => {
    createFolderLayout([
      { id: "test-skill", skillMd: SAMPLE_SKILL, metadata: SAMPLE_METADATA },
    ]);

    const response = await callGET();
    const data = await response.json();

    expect(data).toHaveLength(1);
    expect(data[0].id).toBe("test-skill");
    expect(data[0].name).toBe("test-skill");
    expect(data[0].description).toBe("A test skill for unit testing");
    expect(data[0].title).toBe("Test Skill");
    expect(data[0].category).toBe("Testing");
    expect(data[0].icon).toBe("Bug");
    expect(data[0].tags).toEqual(["Test", "Unit"]);
    expect(data[0].content).toContain("# Test Skill");
  });

  it("should use defaults when metadata.json is missing", async () => {
    createFolderLayout([{ id: "no-meta", skillMd: SAMPLE_SKILL }]);

    const response = await callGET();
    const data = await response.json();

    expect(data).toHaveLength(1);
    expect(data[0].category).toBe("Custom");
    expect(data[0].icon).toBe("Zap");
    expect(data[0].tags).toEqual([]);
  });

  it("should skip directories without SKILL.md", async () => {
    fs.mkdirSync(path.join(tmpDir, "empty-dir"));
    createFolderLayout([
      { id: "valid-skill", skillMd: SAMPLE_SKILL, metadata: SAMPLE_METADATA },
    ]);

    const response = await callGET();
    const data = await response.json();

    expect(data).toHaveLength(1);
    expect(data[0].id).toBe("test-skill");
  });

  it("should load multiple templates sorted by title", async () => {
    createFolderLayout([
      {
        id: "z-skill",
        skillMd: "---\nname: z-skill\ndescription: Zeta\n---\n# Z Skill\n",
        metadata: { title: "Zeta Skill", category: "Other", icon: "Zap", tags: [] },
      },
      {
        id: "a-skill",
        skillMd: "---\nname: a-skill\ndescription: Alpha\n---\n# A Skill\n",
        metadata: { title: "Alpha Skill", category: "Other", icon: "Zap", tags: [] },
      },
    ]);

    const response = await callGET();
    const data = await response.json();

    expect(data).toHaveLength(2);
    expect(data[0].title).toBe("Alpha Skill");
    expect(data[1].title).toBe("Zeta Skill");
  });

  it("should parse frontmatter name and description", async () => {
    const content = `---
name: my-custom-skill
description: Custom description here
---

# My Custom Skill
`;
    createFolderLayout([{ id: "my-custom-skill", skillMd: content }]);

    const response = await callGET();
    const data = await response.json();

    expect(data[0].name).toBe("my-custom-skill");
    expect(data[0].description).toBe("Custom description here");
  });

  it("should use folder name as fallback when frontmatter has no name", async () => {
    const content = `---
description: Only description
---

# Untitled
`;
    createFolderLayout([{ id: "fallback-id", skillMd: content }]);

    const response = await callGET();
    const data = await response.json();

    expect(data[0].id).toBe("fallback-id");
    expect(data[0].name).toBe("fallback-id");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Flat ConfigMap layout
// ─────────────────────────────────────────────────────────────────────────────
describe("flat ConfigMap layout", () => {
  it("should load templates from flat files", async () => {
    createFlatLayout([
      { id: "test-skill", skillMd: SAMPLE_SKILL, metadata: SAMPLE_METADATA },
    ]);

    const response = await callGET();
    const data = await response.json();

    expect(data).toHaveLength(1);
    expect(data[0].id).toBe("test-skill");
    expect(data[0].title).toBe("Test Skill");
    expect(data[0].category).toBe("Testing");
  });

  it("should handle flat layout without metadata", async () => {
    createFlatLayout([{ id: "flat-only", skillMd: SAMPLE_SKILL }]);

    const response = await callGET();
    const data = await response.json();

    expect(data).toHaveLength(1);
    expect(data[0].category).toBe("Custom");
    expect(data[0].icon).toBe("Zap");
  });

  it("should load multiple flat templates sorted by title", async () => {
    createFlatLayout([
      {
        id: "z-flat",
        skillMd: "---\nname: z-flat\ndescription: Zeta\n---\n# Z\n",
        metadata: { title: "Zeta Flat", category: "Other", icon: "Zap", tags: [] },
      },
      {
        id: "a-flat",
        skillMd: "---\nname: a-flat\ndescription: Alpha\n---\n# A\n",
        metadata: { title: "Alpha Flat", category: "Other", icon: "Zap", tags: [] },
      },
    ]);

    const response = await callGET();
    const data = await response.json();

    expect(data).toHaveLength(2);
    expect(data[0].title).toBe("Alpha Flat");
    expect(data[1].title).toBe("Zeta Flat");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Error handling
// ─────────────────────────────────────────────────────────────────────────────
describe("error handling", () => {
  it("should return empty array when directory doesn't exist", async () => {
    process.env.SKILLS_DIR = "/nonexistent/path/to/skills";

    const response = await callGET();
    const data = await response.json();

    expect(data).toEqual([]);
  });

  it("should return empty array when directory is empty", async () => {
    const response = await callGET();
    const data = await response.json();

    expect(data).toEqual([]);
  });

  it("should skip skill with corrupt metadata.json gracefully", async () => {
    const skillDir = path.join(tmpDir, "corrupt-meta");
    fs.mkdirSync(skillDir);
    fs.writeFileSync(path.join(skillDir, "SKILL.md"), SAMPLE_SKILL);
    fs.writeFileSync(path.join(skillDir, "metadata.json"), "{ not valid json");

    const response = await callGET();
    const data = await response.json();

    expect(data).toHaveLength(1);
    expect(data[0].category).toBe("Custom");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Cache behavior
// ─────────────────────────────────────────────────────────────────────────────
describe("cache behavior", () => {
  it("should return cached results on sequential calls", async () => {
    createFolderLayout([
      { id: "cached-skill", skillMd: SAMPLE_SKILL, metadata: SAMPLE_METADATA },
    ]);

    const response1 = await callGET();
    const data1 = await response1.json();

    const response2 = await callGET();
    const data2 = await response2.json();

    expect(data1).toEqual(data2);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Integration with actual chart data/skills files
// ─────────────────────────────────────────────────────────────────────────────
describe("integration with chart data/skills", () => {
  beforeEach(() => {
    delete process.env.SKILLS_DIR;
    jest.resetModules();
  });

  it("should load real skill templates from chart data directory", async () => {
    const chartSkillsDir = path.resolve(
      __dirname,
      "..",
      "..",
      "..",
      "..",
      "..",
      "..",
      "charts",
      "ai-platform-engineering",
      "data",
      "skills"
    );

    if (!fs.existsSync(chartSkillsDir)) {
      console.log("Skipping: chart skills dir not found at", chartSkillsDir);
      return;
    }

    process.env.SKILLS_DIR = chartSkillsDir;
    const { GET } = await import("../route");
    const request = new NextRequest("http://localhost:3000/api/skill-templates");
    const response = await GET(request);
    const data = await response.json();

    expect(data.length).toBeGreaterThanOrEqual(10);

    for (const template of data) {
      expect(template.id).toBeTruthy();
      expect(template.name).toBeTruthy();
      expect(template.description).toBeTruthy();
      expect(template.content).toContain("---");
    }

    const ids = data.map((t: { id: string }) => t.id);
    expect(ids).toContain("review-specific-pr");
    expect(ids).toContain("check-deployment-status");
    expect(ids).toContain("aws-cost-analysis");
  });
});
