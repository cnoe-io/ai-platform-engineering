/**
 * Unit tests for the SKILL.md parser & generator.
 *
 * Tests cover the Anthropic Agent Skills SKILL.md format:
 * https://github.com/anthropics/skills
 *
 * - parseFrontmatter: YAML key-value extraction from frontmatter block
 * - splitSections: Markdown body splitting by H2 headings
 * - parseSkillMd: Full SKILL.md parsing (frontmatter + body)
 * - generateSkillMd: Generating SKILL.md content from structured data
 * - createBlankSkillMd: Blank template generation
 *
 * @jest-environment node
 */

import {
  parseSkillMd,
  generateSkillMd,
  createBlankSkillMd,
  parseFrontmatter,
  splitSections,
  updateAllowedToolsInFrontmatter,
} from "../skill-md-parser";

// ─────────────────────────────────────────────────────────────────────────────
// parseFrontmatter
// ─────────────────────────────────────────────────────────────────────────────
describe("parseFrontmatter", () => {
  it("should parse simple key-value pairs", () => {
    const raw = "name: my-skill\ndescription: A test skill";
    const result = parseFrontmatter(raw);
    expect(result).toEqual({
      name: "my-skill",
      description: "A test skill",
    });
  });

  it("should handle multi-line description values", () => {
    const raw =
      "name: mcp-builder\ndescription: Guide for creating high-quality MCP servers\n  that enable LLMs to interact with external services.";
    const result = parseFrontmatter(raw);
    expect(result.name).toBe("mcp-builder");
    expect(result.description).toBe(
      "Guide for creating high-quality MCP servers that enable LLMs to interact with external services."
    );
  });

  it("should return empty object for empty string", () => {
    expect(parseFrontmatter("")).toEqual({});
  });

  it("should handle values with colons", () => {
    const raw = "name: my-skill\ndescription: Use when: building servers";
    const result = parseFrontmatter(raw);
    expect(result.description).toBe("Use when: building servers");
  });

  it("should handle the license field from Anthropic skills", () => {
    const raw =
      "name: brand-guidelines\ndescription: Applies brand colors.\nlicense: Complete terms in LICENSE.txt";
    const result = parseFrontmatter(raw);
    expect(result.name).toBe("brand-guidelines");
    expect(result.description).toBe("Applies brand colors.");
    expect(result.license).toBe("Complete terms in LICENSE.txt");
  });

  it("should handle keys with hyphens", () => {
    const raw = "name: my-skill\nsome-key: some-value";
    const result = parseFrontmatter(raw);
    expect(result["some-key"]).toBe("some-value");
  });

  it("should trim whitespace from values", () => {
    const raw = "name:   spaced-name  \ndescription:  spaced desc  ";
    const result = parseFrontmatter(raw);
    expect(result.name).toBe("spaced-name");
    expect(result.description).toBe("spaced desc");
  });

  it("should handle single key-value pair", () => {
    const raw = "name: only-name";
    const result = parseFrontmatter(raw);
    expect(result).toEqual({ name: "only-name" });
  });

  it("should handle empty value after colon", () => {
    const raw = "name: \ndescription: something";
    const result = parseFrontmatter(raw);
    expect(result.name).toBe("");
    expect(result.description).toBe("something");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// splitSections
// ─────────────────────────────────────────────────────────────────────────────
describe("splitSections", () => {
  it("should split body into H2 sections", () => {
    const body = "# Title\n\nIntro text.\n\n## Instructions\n\nDo this.\n\n## Examples\n\n- Example 1";
    const sections = splitSections(body);
    expect(sections.size).toBe(2);
    expect(sections.has("Instructions")).toBe(true);
    expect(sections.has("Examples")).toBe(true);
    expect(sections.get("Instructions")).toBe("Do this.");
    expect(sections.get("Examples")).toBe("- Example 1");
  });

  it("should return empty map for body with no H2 headings", () => {
    const body = "# Just a Title\n\nSome content with no subsections.";
    const sections = splitSections(body);
    expect(sections.size).toBe(0);
  });

  it("should handle body with only one H2 section", () => {
    const body = "## Guidelines\n\n- Be thorough\n- Be precise";
    const sections = splitSections(body);
    expect(sections.size).toBe(1);
    expect(sections.get("Guidelines")).toBe("- Be thorough\n- Be precise");
  });

  it("should handle multiple sections with complex content", () => {
    const body = `# MCP Builder

Overview text.

## Phase 1: Research

Research the API.

### Sub-heading

Sub content.

## Phase 2: Implementation

Build the server.

## Phase 3: Testing

Test everything.`;
    const sections = splitSections(body);
    expect(sections.size).toBe(3);
    expect(sections.has("Phase 1: Research")).toBe(true);
    expect(sections.has("Phase 2: Implementation")).toBe(true);
    expect(sections.has("Phase 3: Testing")).toBe(true);
    expect(sections.get("Phase 1: Research")).toContain("Research the API.");
    expect(sections.get("Phase 1: Research")).toContain("### Sub-heading");
  });

  it("should handle empty body", () => {
    const sections = splitSections("");
    expect(sections.size).toBe(0);
  });

  it("should not confuse H3 headings with H2", () => {
    const body = "## Real Section\n\nContent.\n\n### Not a Section\n\nMore content.";
    const sections = splitSections(body);
    expect(sections.size).toBe(1);
    expect(sections.has("Real Section")).toBe(true);
    expect(sections.get("Real Section")).toContain("### Not a Section");
  });

  it("should trim content of each section", () => {
    const body = "## Section 1\n\n  Content with spaces  \n\n## Section 2\n\n  More content  ";
    const sections = splitSections(body);
    expect(sections.get("Section 1")).toBe("Content with spaces");
    expect(sections.get("Section 2")).toBe("More content");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// parseSkillMd — Anthropic format compatibility
// ─────────────────────────────────────────────────────────────────────────────
describe("parseSkillMd", () => {
  describe("Anthropic template format", () => {
    it("should parse the Anthropic template skill", () => {
      const content = `---
name: template-skill
description: Replace with description of the skill and when Claude should use it.
---

# Insert instructions below`;

      const result = parseSkillMd(content);
      expect(result.name).toBe("template-skill");
      expect(result.description).toBe(
        "Replace with description of the skill and when Claude should use it."
      );
      expect(result.title).toBe("Insert instructions below");
      expect(result.body).toBe("# Insert instructions below");
      expect(result.sections.size).toBe(0);
      expect(result.rawContent).toBe(content);
    });

    it("should parse an Anthropic-style skill with sections", () => {
      const content = `---
name: internal-comms
description: A set of resources to help me write all kinds of internal communications.
---

## When to use this skill
To write internal communications, use this skill for:
- 3P updates
- Company newsletters
- FAQ responses

## How to use this skill

To write any internal communication:
1. Identify the communication type
2. Load the appropriate guideline file

## Keywords
3P updates, company newsletter, weekly update`;

      const result = parseSkillMd(content);
      expect(result.name).toBe("internal-comms");
      expect(result.description).toBe(
        "A set of resources to help me write all kinds of internal communications."
      );
      expect(result.title).toBe("internal-comms");
      expect(result.sections.size).toBe(3);
      expect(result.sections.has("When to use this skill")).toBe(true);
      expect(result.sections.has("How to use this skill")).toBe(true);
      expect(result.sections.has("Keywords")).toBe(true);
    });

    it("should parse a complex Anthropic-style skill (mcp-builder pattern)", () => {
      const content = `---
name: mcp-builder
description: Guide for creating high-quality MCP servers that enable LLMs to interact with external services through well-designed tools.
---

# MCP Server Development Guide

## Overview

Create MCP servers that enable LLMs to interact with external services.

## Process

### Phase 1: Research
Research the API.

### Phase 2: Implementation
Build the server.

## Reference Files

- [Python Guide](./reference/python_mcp_server.md)
- [TypeScript Guide](./reference/node_mcp_server.md)`;

      const result = parseSkillMd(content);
      expect(result.name).toBe("mcp-builder");
      expect(result.title).toBe("MCP Server Development Guide");
      expect(result.sections.size).toBe(3);
      expect(result.sections.has("Overview")).toBe(true);
      expect(result.sections.has("Process")).toBe(true);
      expect(result.sections.has("Reference Files")).toBe(true);
      expect(result.sections.get("Process")).toContain("### Phase 1: Research");
    });
  });

  describe("frontmatter parsing", () => {
    it("should extract name and description from frontmatter", () => {
      const content = `---
name: my-skill
description: My skill description
---

# My Skill`;

      const result = parseSkillMd(content);
      expect(result.name).toBe("my-skill");
      expect(result.description).toBe("My skill description");
    });

    it("should handle multi-line description in frontmatter", () => {
      const content = `---
name: complex-skill
description: A very long description that spans
  multiple lines and continues here.
---

# Complex Skill`;

      const result = parseSkillMd(content);
      expect(result.name).toBe("complex-skill");
      expect(result.description).toBe(
        "A very long description that spans multiple lines and continues here."
      );
    });

    it("should handle additional frontmatter fields (e.g., license)", () => {
      const content = `---
name: branded-skill
description: Applies branding.
license: Complete terms in LICENSE.txt
---

# Branded Skill`;

      const result = parseSkillMd(content);
      expect(result.name).toBe("branded-skill");
      expect(result.description).toBe("Applies branding.");
    });

    it("should handle missing frontmatter gracefully", () => {
      const content = "# My Skill\n\nSome instructions.";
      const result = parseSkillMd(content);
      expect(result.name).toBe("");
      expect(result.description).toBe("");
      expect(result.title).toBe("My Skill");
      expect(result.body).toBe("# My Skill\n\nSome instructions.");
    });

    it("should handle empty frontmatter", () => {
      const content = `---
---

# Empty Frontmatter Skill`;

      const result = parseSkillMd(content);
      expect(result.name).toBe("");
      expect(result.description).toBe("");
      expect(result.title).toBe("Empty Frontmatter Skill");
    });
  });

  describe("title extraction", () => {
    it("should extract title from first H1 heading", () => {
      const content = `---
name: test
description: test
---

# My Awesome Skill

Instructions here.`;

      const result = parseSkillMd(content);
      expect(result.title).toBe("My Awesome Skill");
    });

    it("should fall back to frontmatter name if no H1 exists", () => {
      const content = `---
name: fallback-name
description: test
---

## Only H2 Headings

Some content.`;

      const result = parseSkillMd(content);
      expect(result.title).toBe("fallback-name");
    });

    it("should fall back to 'Untitled Skill' if no H1 and no name", () => {
      const content = "Just some text\nwith no structure at all.";
      const result = parseSkillMd(content);
      expect(result.title).toBe("Untitled Skill");
    });

    it("should handle H1 with special characters", () => {
      const content = `---
name: special
description: test
---

# Review a Specific PR (GitHub)

Instructions.`;

      const result = parseSkillMd(content);
      expect(result.title).toBe("Review a Specific PR (GitHub)");
    });
  });

  describe("body extraction", () => {
    it("should extract the full body after frontmatter", () => {
      const content = `---
name: test
description: test
---

# Title

Body content here.

## Section 1

Section content.`;

      const result = parseSkillMd(content);
      expect(result.body).toContain("# Title");
      expect(result.body).toContain("Body content here.");
      expect(result.body).toContain("## Section 1");
    });

    it("should treat entire content as body when no frontmatter", () => {
      const content = "# No Frontmatter\n\nJust markdown.";
      const result = parseSkillMd(content);
      expect(result.body).toBe("# No Frontmatter\n\nJust markdown.");
    });

    it("should handle empty body after frontmatter", () => {
      const content = `---
name: empty-body
description: test
---
`;

      const result = parseSkillMd(content);
      expect(result.body).toBe("");
    });
  });

  describe("section parsing", () => {
    it("should parse H2 sections into a Map", () => {
      const content = `---
name: test
description: test
---

# My Skill

Overview.

## Instructions

Do this thing.

## Examples

- Example 1
- Example 2

## Guidelines

- Guideline 1
- Guideline 2`;

      const result = parseSkillMd(content);
      expect(result.sections.size).toBe(3);
      expect(result.sections.get("Instructions")).toBe("Do this thing.");
      expect(result.sections.get("Examples")).toContain("- Example 1");
      expect(result.sections.get("Guidelines")).toContain("- Guideline 1");
    });

    it("should handle sections with nested H3 headings", () => {
      const content = `---
name: test
description: test
---

# Skill

## Instructions

### Phase 1: Gather
Gather data.

### Phase 2: Analyze
Analyze data.

## Output Format

The output should be a markdown report.`;

      const result = parseSkillMd(content);
      expect(result.sections.size).toBe(2);
      const instructions = result.sections.get("Instructions");
      expect(instructions).toContain("### Phase 1: Gather");
      expect(instructions).toContain("### Phase 2: Analyze");
    });

    it("should handle sections with code blocks containing ## markers", () => {
      const content = `---
name: test
description: test
---

# Skill

## Output Format

\`\`\`markdown
## Report Title
| Column | Value |
|--------|-------|
\`\`\`

## Guidelines

- Be precise`;

      const result = parseSkillMd(content);
      expect(result.sections.has("Output Format")).toBe(true);
      expect(result.sections.has("Guidelines")).toBe(true);
    });
  });

  describe("rawContent preservation", () => {
    it("should preserve the original content exactly", () => {
      const content = `---
name: test
description: A skill.
---

# Test Skill

Do something useful.`;

      const result = parseSkillMd(content);
      expect(result.rawContent).toBe(content);
    });

    it("should preserve content with special characters", () => {
      const content = `---
name: test
description: Handle {{variables}} and \`code\`.
---

# Template Skill

Use {{repo_url}} to fetch data.`;

      const result = parseSkillMd(content);
      expect(result.rawContent).toBe(content);
      expect(result.body).toContain("{{repo_url}}");
    });
  });

  describe("edge cases", () => {
    it("should handle empty string input", () => {
      const result = parseSkillMd("");
      expect(result.name).toBe("");
      expect(result.description).toBe("");
      expect(result.title).toBe("Untitled Skill");
      expect(result.body).toBe("");
      expect(result.sections.size).toBe(0);
    });

    it("should handle whitespace-only input", () => {
      const result = parseSkillMd("   \n\n  \n");
      expect(result.name).toBe("");
      expect(result.title).toBe("Untitled Skill");
    });

    it("should handle frontmatter-only content (no body)", () => {
      const content = `---
name: minimal
description: Minimal skill.
---`;

      const result = parseSkillMd(content);
      expect(result.name).toBe("minimal");
      expect(result.description).toBe("Minimal skill.");
    });

    it("should handle content with Windows-style line endings in body", () => {
      const content = "---\r\nname: win\r\ndescription: Windows.\r\n---\r\n\r\n# Win Skill\r\n\r\nContent.";
      const result = parseSkillMd(content);
      expect(result.name).toBe("win");
    });

    it("should handle content with only frontmatter delimiters and no key-values", () => {
      const content = "---\n---\n\n# Empty FM";
      const result = parseSkillMd(content);
      expect(result.name).toBe("");
      expect(result.title).toBe("Empty FM");
    });
  });

  describe("real-world Anthropic skill examples", () => {
    it("should parse the webapp-testing skill format", () => {
      const content = `---
name: webapp-testing
description: Toolkit for interacting with and testing local web applications using Playwright.
---

# Web Application Testing

To test local web applications, write native Python Playwright scripts.

## Decision Tree: Choosing Your Approach

\`\`\`
User task → Is it static HTML?
    ├─ Yes → Read HTML file directly
    └─ No → Use Playwright
\`\`\`

## Best Practices

- Use bundled scripts as black boxes
- Use sync_playwright() for synchronous scripts
- Always close the browser when done`;

      const result = parseSkillMd(content);
      expect(result.name).toBe("webapp-testing");
      expect(result.title).toBe("Web Application Testing");
      expect(result.sections.size).toBe(2);
      expect(result.sections.has("Decision Tree: Choosing Your Approach")).toBe(true);
      expect(result.sections.has("Best Practices")).toBe(true);
    });

    it("should parse the brand-guidelines skill format", () => {
      const content = `---
name: brand-guidelines
description: Applies brand colors and typography to any artifact.
license: Complete terms in LICENSE.txt
---

# Brand Styling

## Overview

To access official brand identity and style resources, use this skill.

## Brand Guidelines

### Colors

- Dark: \`#141413\`
- Light: \`#faf9f5\`

### Typography

- Headings: Poppins
- Body Text: Lora`;

      const result = parseSkillMd(content);
      expect(result.name).toBe("brand-guidelines");
      expect(result.title).toBe("Brand Styling");
      expect(result.sections.size).toBe(2);
      expect(result.sections.get("Brand Guidelines")).toContain("### Colors");
      expect(result.sections.get("Brand Guidelines")).toContain("### Typography");
    });

    it("should parse the skill-creator skill format (complex, nested)", () => {
      const content = `---
name: skill-creator
description: Guide for creating effective skills.
---

# Skill Creator

This skill provides guidance for creating effective skills.

## About Skills

Skills are modular, self-contained packages.

### What Skills Provide

1. Specialized workflows
2. Tool integrations

## Core Principles

### Concise is Key

Only add context Claude doesn't already have.

### Set Appropriate Degrees of Freedom

Match the level of specificity to the task.

## Skill Creation Process

Follow these steps in order.`;

      const result = parseSkillMd(content);
      expect(result.name).toBe("skill-creator");
      expect(result.title).toBe("Skill Creator");
      expect(result.sections.size).toBe(3);
      expect(result.sections.has("About Skills")).toBe(true);
      expect(result.sections.has("Core Principles")).toBe(true);
      expect(result.sections.has("Skill Creation Process")).toBe(true);
      expect(result.sections.get("Core Principles")).toContain("### Concise is Key");
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// generateSkillMd
// ─────────────────────────────────────────────────────────────────────────────
describe("generateSkillMd", () => {
  it("should generate valid Anthropic SKILL.md format", () => {
    const result = generateSkillMd({
      name: "my-skill",
      description: "A test skill.",
      body: "# My Skill\n\nDo something useful.\n\n## Examples\n\n- Example 1",
    });

    expect(result).toContain("---\nname: my-skill\n");
    expect(result).toContain("description: A test skill.\n---");
    expect(result).toContain("# My Skill");
    expect(result).toContain("## Examples");
  });

  it("should produce valid frontmatter delimiters", () => {
    const result = generateSkillMd({
      name: "test",
      description: "test",
      body: "# Test",
    });

    const lines = result.split("\n");
    expect(lines[0]).toBe("---");
    expect(lines[3]).toBe("---");
  });

  it("should trim body content", () => {
    const result = generateSkillMd({
      name: "test",
      description: "test",
      body: "  \n\n  # Test Skill  \n\n  ",
    });

    expect(result).toContain("# Test Skill");
    expect(result).not.toContain("  \n\n  # Test Skill  ");
  });

  it("should handle empty body", () => {
    const result = generateSkillMd({
      name: "empty",
      description: "Empty skill.",
      body: "",
    });

    expect(result).toContain("name: empty");
    expect(result).toContain("description: Empty skill.");
  });

  it("should handle description with special characters", () => {
    const result = generateSkillMd({
      name: "special",
      description: "Handle {{variables}}, `code`, and URL: http://example.com",
      body: "# Special Skill",
    });

    expect(result).toContain("description: Handle {{variables}}, `code`, and URL: http://example.com");
  });

  it("should round-trip with parseSkillMd", () => {
    const original = {
      name: "round-trip",
      description: "A round-trip test skill.",
      body: "# Round Trip Skill\n\nThis is the body.\n\n## Examples\n\n- Example 1\n- Example 2\n\n## Guidelines\n\n- Guideline 1",
    };

    const generated = generateSkillMd(original);
    const parsed = parseSkillMd(generated);

    expect(parsed.name).toBe(original.name);
    expect(parsed.description).toBe(original.description);
    expect(parsed.title).toBe("Round Trip Skill");
    expect(parsed.body).toBe(original.body);
    expect(parsed.sections.size).toBe(2);
    expect(parsed.sections.has("Examples")).toBe(true);
    expect(parsed.sections.has("Guidelines")).toBe(true);
  });

  it("should produce output that matches Anthropic template format", () => {
    const result = generateSkillMd({
      name: "my-skill-name",
      description: "A clear description of what this skill does and when to use it.",
      body: "# My Skill Name\n\n[Add your instructions here]\n\n## Examples\n- Example usage 1\n- Example usage 2\n\n## Guidelines\n- Guideline 1\n- Guideline 2",
    });

    expect(result.startsWith("---\n")).toBe(true);
    expect(result).toContain("name: my-skill-name");
    expect(result).toContain("description: A clear description");
    expect(result).toContain("# My Skill Name");
    expect(result).toContain("## Examples");
    expect(result).toContain("## Guidelines");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// createBlankSkillMd
// ─────────────────────────────────────────────────────────────────────────────
describe("createBlankSkillMd", () => {
  it("should return a non-empty string", () => {
    const result = createBlankSkillMd();
    expect(typeof result).toBe("string");
    expect(result.length).toBeGreaterThan(0);
  });

  it("should have valid YAML frontmatter", () => {
    const result = createBlankSkillMd();
    expect(result).toMatch(/^---\n/);
    expect(result).toContain("name:");
    expect(result).toContain("description:");
    expect(result).toMatch(/\n---\n/);
  });

  it("should be parseable by parseSkillMd", () => {
    const blank = createBlankSkillMd();
    const parsed = parseSkillMd(blank);
    expect(parsed.name).toBe("my-skill-name");
    expect(parsed.description).toBeTruthy();
    expect(parsed.title).toBeTruthy();
    expect(parsed.body.length).toBeGreaterThan(0);
  });

  it("should follow the Anthropic template structure", () => {
    const blank = createBlankSkillMd();
    expect(blank).toContain("## Examples");
    expect(blank).toContain("## Guidelines");
  });

  it("should have a placeholder H1 title", () => {
    const blank = createBlankSkillMd();
    const parsed = parseSkillMd(blank);
    expect(parsed.title).toBe("My Skill Name");
  });

  it("should match the Anthropic template format pattern", () => {
    const blank = createBlankSkillMd();
    const parsed = parseSkillMd(blank);
    expect(parsed.name).toMatch(/^[a-z0-9-]+$/);
    expect(parsed.description.length).toBeGreaterThan(10);
  });

  it("should produce consistent output on multiple calls", () => {
    const first = createBlankSkillMd();
    const second = createBlankSkillMd();
    expect(first).toBe(second);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Integration: parseSkillMd with our built-in templates
// ─────────────────────────────────────────────────────────────────────────────
describe("parseSkillMd integration with built-in templates", () => {
  it("should parse the review-specific-pr template correctly", () => {
    const content = `---
name: review-specific-pr
description: Perform a comprehensive code review of a specific GitHub Pull Request.
---

# Review a Specific PR

Given a GitHub PR URL or identifier, perform a thorough code review.

## Instructions

### Phase 1: Context Gathering
1. Fetch PR metadata
2. Fetch the diff

## Output Format

Return a structured markdown review.

## Examples

- "Review the PR at https://github.com/org/repo/pull/42"
- "Can you do a code review of org/repo#123"

## Guidelines

- Always read the full diff
- Check if the PR description explains the "why"`;

    const result = parseSkillMd(content);
    expect(result.name).toBe("review-specific-pr");
    expect(result.title).toBe("Review a Specific PR");
    expect(result.sections.size).toBe(4);
    expect(result.sections.has("Instructions")).toBe(true);
    expect(result.sections.has("Output Format")).toBe(true);
    expect(result.sections.has("Examples")).toBe(true);
    expect(result.sections.has("Guidelines")).toBe(true);
    expect(result.body).toContain("### Phase 1: Context Gathering");
  });

  it("should handle template variables ({{variable}} syntax)", () => {
    const content = `---
name: deploy-check
description: Check deployment status for {{environment}}.
---

# Check Deployment for {{environment}}

Check the health of {{cluster_name}} in {{region}}.

## Instructions

1. Connect to {{cluster_name}}
2. Verify {{service_name}} health`;

    const result = parseSkillMd(content);
    expect(result.description).toContain("{{environment}}");
    expect(result.body).toContain("{{cluster_name}}");
    expect(result.body).toContain("{{region}}");
    expect(result.body).toContain("{{service_name}}");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Performance
// ─────────────────────────────────────────────────────────────────────────────
describe("parseSkillMd performance", () => {
  it("should parse a large SKILL.md quickly", () => {
    const sections = Array.from({ length: 50 }, (_, i) =>
      `## Section ${i}\n\n${"Lorem ipsum dolor sit amet. ".repeat(20)}`
    ).join("\n\n");

    const content = `---
name: large-skill
description: A very large skill with many sections.
---

# Large Skill

${sections}`;

    const start = performance.now();
    const result = parseSkillMd(content);
    const elapsed = performance.now() - start;

    expect(result.sections.size).toBe(50);
    expect(elapsed).toBeLessThan(100);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// allowed-tools frontmatter support
// ─────────────────────────────────────────────────────────────────────────────
describe("parseSkillMd — allowed-tools", () => {
  it("should parse allowed-tools from frontmatter as a string array", () => {
    const content = `---
name: pdf-processor
description: Extract text and tables from PDF files.
allowed-tools: Read, Write, pdf_tools.py
---

# PDF Processor

Process PDF documents.`;

    const result = parseSkillMd(content);
    expect(result.allowedTools).toEqual(["Read", "Write", "pdf_tools.py"]);
  });

  it("should handle a single tool", () => {
    const content = `---
name: simple
description: Simple skill.
allowed-tools: Read
---

# Simple`;

    const result = parseSkillMd(content);
    expect(result.allowedTools).toEqual(["Read"]);
  });

  it("should handle MCP tool URIs", () => {
    const content = `---
name: mcp-skill
description: Uses MCP tools.
allowed-tools: github, mcp://my-org/rag-server, Read
---

# MCP Skill`;

    const result = parseSkillMd(content);
    expect(result.allowedTools).toEqual(["github", "mcp://my-org/rag-server", "Read"]);
  });

  it("should return empty array when no allowed-tools field", () => {
    const content = `---
name: basic
description: Basic skill.
---

# Basic Skill`;

    const result = parseSkillMd(content);
    expect(result.allowedTools).toEqual([]);
  });

  it("should handle empty allowed-tools value", () => {
    const content = `---
name: empty-tools
description: No tools.
allowed-tools: 
---

# Empty Tools`;

    const result = parseSkillMd(content);
    expect(result.allowedTools).toEqual([]);
  });

  it("should trim whitespace from tool names", () => {
    const content = `---
name: spaced
description: Spaced tools.
allowed-tools:   Read ,  Write  , Edit  
---

# Spaced`;

    const result = parseSkillMd(content);
    expect(result.allowedTools).toEqual(["Read", "Write", "Edit"]);
  });
});

describe("generateSkillMd — allowed-tools", () => {
  it("should include allowed-tools in frontmatter when provided", () => {
    const result = generateSkillMd({
      name: "pdf-processor",
      description: "Extract text from PDFs.",
      body: "# PDF Processor\n\nProcess documents.",
      allowedTools: ["Read", "Write", "pdf_tools.py"],
    });

    expect(result).toContain("allowed-tools: Read, Write, pdf_tools.py");
  });

  it("should omit allowed-tools when empty array", () => {
    const result = generateSkillMd({
      name: "no-tools",
      description: "No tools.",
      body: "# No Tools",
      allowedTools: [],
    });

    expect(result).not.toContain("allowed-tools");
  });

  it("should omit allowed-tools when undefined", () => {
    const result = generateSkillMd({
      name: "no-tools",
      description: "No tools.",
      body: "# No Tools",
    });

    expect(result).not.toContain("allowed-tools");
  });

  it("should round-trip allowed-tools through parse and generate", () => {
    const original = {
      name: "round-trip",
      description: "Round-trip test.",
      body: "# Round Trip\n\nBody text.",
      allowedTools: ["github", "mcp://org/server", "Read"],
    };

    const generated = generateSkillMd(original);
    const parsed = parseSkillMd(generated);

    expect(parsed.name).toBe(original.name);
    expect(parsed.description).toBe(original.description);
    expect(parsed.allowedTools).toEqual(original.allowedTools);
    expect(parsed.body).toBe(original.body);
  });

  it("should place allowed-tools after description in frontmatter", () => {
    const result = generateSkillMd({
      name: "ordered",
      description: "Ordered fields.",
      body: "# Ordered",
      allowedTools: ["Read"],
    });

    const lines = result.split("\n");
    expect(lines[0]).toBe("---");
    expect(lines[1]).toBe("name: ordered");
    expect(lines[2]).toBe("description: Ordered fields.");
    expect(lines[3]).toBe("allowed-tools: Read");
    expect(lines[4]).toBe("---");
  });
});

describe("updateAllowedToolsInFrontmatter", () => {
  const base = `---
name: test-skill
description: A test skill.
---

# Test Skill

Do something.
`;

  it("should add allowed-tools to frontmatter that has none", () => {
    const updated = updateAllowedToolsInFrontmatter(base, ["Read", "Write"]);
    const parsed = parseSkillMd(updated);
    expect(parsed.allowedTools).toEqual(["Read", "Write"]);
    expect(parsed.name).toBe("test-skill");
    expect(parsed.body).toContain("# Test Skill");
  });

  it("should replace existing allowed-tools", () => {
    const withTools = `---
name: test-skill
description: A test skill.
allowed-tools: Read, Write
---

# Test Skill

Do something.
`;
    const updated = updateAllowedToolsInFrontmatter(withTools, ["github", "argocd"]);
    const parsed = parseSkillMd(updated);
    expect(parsed.allowedTools).toEqual(["github", "argocd"]);
  });

  it("should remove allowed-tools line when given empty array", () => {
    const withTools = `---
name: test-skill
description: A test skill.
allowed-tools: Read, Write
---

# Test Skill
`;
    const updated = updateAllowedToolsInFrontmatter(withTools, []);
    expect(updated).not.toContain("allowed-tools");
    const parsed = parseSkillMd(updated);
    expect(parsed.allowedTools).toEqual([]);
    expect(parsed.name).toBe("test-skill");
  });

  it("should not alter content when empty tools and no existing field", () => {
    const result = updateAllowedToolsInFrontmatter(base, []);
    expect(result).toBe(base);
  });

  it("should return content unchanged when no frontmatter exists", () => {
    const noFm = "# No Frontmatter\n\nJust markdown.";
    const result = updateAllowedToolsInFrontmatter(noFm, ["Read"]);
    expect(result).toBe(noFm);
  });

  it("should preserve body content exactly", () => {
    const updated = updateAllowedToolsInFrontmatter(base, ["Read"]);
    const parsed = parseSkillMd(updated);
    expect(parsed.body).toBe("# Test Skill\n\nDo something.");
  });
});
