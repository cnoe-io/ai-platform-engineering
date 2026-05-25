/**
 * @jest-environment node
 */

import fs from "fs";
import os from "os";
import path from "path";

let tmpDir: string;

const consoleWarnSpy = jest.spyOn(console, "warn").mockImplementation(() => {});
const consoleErrorSpy = jest.spyOn(console, "error").mockImplementation(() => {});

function writeSkill(
  id: string,
  skillMd: string,
  metadata?: Record<string, unknown>,
): string {
  const skillDir = path.join(tmpDir, id);
  fs.mkdirSync(skillDir, { recursive: true });
  fs.writeFileSync(path.join(skillDir, "SKILL.md"), skillMd);
  if (metadata) {
    fs.writeFileSync(path.join(skillDir, "metadata.json"), JSON.stringify(metadata));
  }
  return skillDir;
}

async function importLoader() {
  jest.resetModules();
  return import("../skill-templates-loader");
}

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "skill-loader-test-"));
  process.env.SKILLS_DIR = tmpDir;
  delete process.env.SKILL_TEMPLATES_ANCILLARY_BYTE_CAP;
  consoleWarnSpy.mockClear();
  consoleErrorSpy.mockClear();
});

afterEach(() => {
  delete process.env.SKILLS_DIR;
  delete process.env.SKILL_TEMPLATES_ANCILLARY_BYTE_CAP;
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

afterAll(() => {
  consoleWarnSpy.mockRestore();
  consoleErrorSpy.mockRestore();
});

describe("loadSkillTemplatesInternal", () => {
  it("loads folder-layout templates with folded frontmatter and metadata", async () => {
    writeSkill(
      "folder-a",
      `---
name: alpha-skill
description: >
  First line
  second line
---
# Alpha
`,
      {
        title: "Alpha Template",
        category: "Testing",
        icon: "Bug",
        tags: ["unit", "loader"],
        input_variables: [
          {
            name: "repo",
            label: "Repository",
            required: true,
            placeholder: "org/repo",
          },
        ],
      },
    );
    writeSkill("folder-z", "---\nname: zeta-skill\ndescription: Zeta\n---\n# Zeta", {
      title: "Zeta Template",
    });

    const { loadSkillTemplatesInternal } = await importLoader();
    const templates = loadSkillTemplatesInternal();

    expect(templates.map((template) => template.title)).toEqual([
      "Alpha Template",
      "Zeta Template",
    ]);
    expect(templates[0]).toMatchObject({
      id: "alpha-skill",
      name: "alpha-skill",
      description: "First line second line",
      category: "Testing",
      icon: "Bug",
      tags: ["unit", "loader"],
      input_variables: [
        {
          name: "repo",
          label: "Repository",
          required: true,
          placeholder: "org/repo",
        },
      ],
    });
  });

  it("loads flat ConfigMap layout and falls back when metadata is invalid", async () => {
    fs.writeFileSync(
      path.join(tmpDir, "flat--SKILL.md"),
      "---\nname: flat-skill\ndescription: Flat layout\n---\n# Flat",
    );
    fs.writeFileSync(path.join(tmpDir, "flat--metadata.json"), "{not json");

    const { loadSkillTemplatesInternal } = await importLoader();
    const templates = loadSkillTemplatesInternal();

    expect(templates).toHaveLength(1);
    expect(templates[0]).toMatchObject({
      id: "flat-skill",
      name: "flat-skill",
      title: "flat-skill",
      category: "Custom",
      icon: "Zap",
      tags: [],
    });
  });

  it("caches template reads within the TTL", async () => {
    writeSkill("cached", "---\nname: cached\ndescription: First\n---\n# First");

    const { loadSkillTemplatesInternal } = await importLoader();
    expect(loadSkillTemplatesInternal()[0].description).toBe("First");

    fs.writeFileSync(
      path.join(tmpDir, "cached", "SKILL.md"),
      "---\nname: cached\ndescription: Second\n---\n# Second",
    );

    expect(loadSkillTemplatesInternal()[0].description).toBe("First");
  });

  it("returns an empty catalog when the configured directory is missing", async () => {
    process.env.SKILLS_DIR = path.join(tmpDir, "missing");
    const { loadSkillTemplatesInternal } = await importLoader();

    expect(loadSkillTemplatesInternal()).toEqual([]);
    expect(consoleWarnSpy).toHaveBeenCalledWith(
      expect.stringContaining("Skills directory not found"),
    );
  });
});

describe("resolveTemplateDir", () => {
  it("resolves by direct folder id and frontmatter name", async () => {
    const directDir = writeSkill("direct", "---\nname: direct\ndescription: Direct\n---\n");
    const namedDir = writeSkill(
      "directory-name",
      "---\nname: logical-name\ndescription: Named\n---\n",
    );

    const { resolveTemplateDir } = await importLoader();

    expect(resolveTemplateDir("direct")).toBe(directDir);
    expect(resolveTemplateDir("logical-name")).toBe(namedDir);
    expect(resolveTemplateDir("missing")).toBeNull();
  });

  it("returns null when only flat files are present", async () => {
    fs.writeFileSync(
      path.join(tmpDir, "flat--SKILL.md"),
      "---\nname: flat\ndescription: Flat\n---\n",
    );

    const { resolveTemplateDir } = await importLoader();

    expect(resolveTemplateDir("flat")).toBeNull();
  });
});

describe("loadTemplateAncillaryFiles", () => {
  it("collects text ancillary files recursively while skipping canonical and binary files", async () => {
    const skillDir = writeSkill("ancillary", "---\nname: ancillary\n---\n");
    fs.mkdirSync(path.join(skillDir, "prompts"));
    fs.writeFileSync(path.join(skillDir, "README.md"), "readme");
    fs.writeFileSync(path.join(skillDir, "prompts", "prompt.txt"), "prompt");
    fs.writeFileSync(path.join(skillDir, "binary.bin"), Buffer.from([0, 1, 2]));

    const { loadTemplateAncillaryFiles } = await importLoader();

    expect(loadTemplateAncillaryFiles(skillDir)).toEqual({
      "README.md": "readme",
      "prompts/prompt.txt": "prompt",
    });
  });

  it("honors the ancillary byte cap and missing directory fallback", async () => {
    const skillDir = writeSkill("capped", "---\nname: capped\n---\n");
    fs.writeFileSync(path.join(skillDir, "small.txt"), "ok");
    fs.writeFileSync(path.join(skillDir, "large.txt"), "too-large");
    process.env.SKILL_TEMPLATES_ANCILLARY_BYTE_CAP = "3";

    const { loadTemplateAncillaryFiles } = await importLoader();

    expect(loadTemplateAncillaryFiles(skillDir)).toEqual({ "small.txt": "ok" });
    expect(loadTemplateAncillaryFiles(path.join(tmpDir, "missing"))).toEqual({});
  });
});
