/**
 * Tests for task-config.ts utility functions
 *
 * Covers:
 * - extractFileIO: extracts reads and writes from prompt text
 * - extractFileIO: returns empty arrays for prompts without file references
 * - extractEnvVars: extracts environment variables from task steps
 * - toTaskConfigYamlFormat: converts TaskConfig array to YAML-format object
 */

import {
  extractFileIO,
  extractEnvVars,
  toTaskConfigYamlFormat,
} from "../task-config";
import type { TaskConfig, TaskStep } from "../task-config";

// ============================================================================
// extractFileIO
// ============================================================================

describe("extractFileIO", () => {
  it("extracts reads from Read pattern", () => {
    const result = extractFileIO("Read /data/input.txt and process");
    expect(result.reads).toContain("/data/input.txt");
    expect(result.writes).toEqual([]);
  });

  it("extracts reads from from pattern", () => {
    const result = extractFileIO("Load content from /config/settings.yml");
    expect(result.reads).toContain("/config/settings.yml");
  });

  it("extracts writes from Write pattern", () => {
    const result = extractFileIO("Write the result to /output/result.txt");
    expect(result.writes).toContain("/output/result.txt");
  });

  it("extracts writes from Save pattern", () => {
    const result = extractFileIO("Save the template to /data/template.yml");
    expect(result.writes).toContain("/data/template.yml");
  });

  it("extracts both reads and writes from prompt", () => {
    const result = extractFileIO(
      "Read /data/input.txt and write the output to /data/output.txt"
    );
    expect(result.reads).toContain("/data/input.txt");
    expect(result.writes).toContain("/data/output.txt");
  });

  it("returns empty arrays for prompts without file references", () => {
    const result = extractFileIO("Do something with the data");
    expect(result.reads).toEqual([]);
    expect(result.writes).toEqual([]);
  });

  it("returns empty arrays for empty prompt", () => {
    const result = extractFileIO("");
    expect(result.reads).toEqual([]);
    expect(result.writes).toEqual([]);
  });
});

// ============================================================================
// extractEnvVars
// ============================================================================

describe("extractEnvVars", () => {
  it("extracts environment variables from task steps", () => {
    const tasks: TaskStep[] = [
      {
        display_text: "Step 1",
        llm_prompt: "Use ${API_KEY} and ${SECRET_TOKEN}",
        subagent: "user_input",
      },
    ];
    const result = extractEnvVars(tasks);
    expect(result).toContain("API_KEY");
    expect(result).toContain("SECRET_TOKEN");
    expect(result).toHaveLength(2);
  });

  it("deduplicates env vars across steps", () => {
    const tasks: TaskStep[] = [
      {
        display_text: "Step 1",
        llm_prompt: "Use ${GITHUB_TOKEN}",
        subagent: "github",
      },
      {
        display_text: "Step 2",
        llm_prompt: "Also use ${GITHUB_TOKEN}",
        subagent: "github",
      },
    ];
    const result = extractEnvVars(tasks);
    expect(result).toEqual(["GITHUB_TOKEN"]);
  });

  it("returns empty array when no env vars", () => {
    const tasks: TaskStep[] = [
      {
        display_text: "Step 1",
        llm_prompt: "No variables here",
        subagent: "user_input",
      },
    ];
    const result = extractEnvVars(tasks);
    expect(result).toEqual([]);
  });

  it("returns empty array for empty tasks", () => {
    const result = extractEnvVars([]);
    expect(result).toEqual([]);
  });
});

// ============================================================================
// toTaskConfigYamlFormat
// ============================================================================

describe("toTaskConfigYamlFormat", () => {
  it("converts TaskConfig array to YAML-format object", () => {
    const configs: TaskConfig[] = [
      {
        id: "cfg-1",
        name: "Create Repo",
        category: "GitHub Operations",
        description: "Create a GitHub repo",
        tasks: [
          {
            display_text: "Create",
            llm_prompt: "Create repo ${REPO_NAME}",
            subagent: "github",
          },
        ],
        owner_id: "user",
        is_system: false,
        visibility: "private",
        created_at: new Date(),
        updated_at: new Date(),
      },
    ];

    const result = toTaskConfigYamlFormat(configs);

    expect(result).toHaveProperty("Create Repo");
    expect(result["Create Repo"].tasks).toHaveLength(1);
    expect(result["Create Repo"].tasks[0]).toEqual({
      display_text: "Create",
      llm_prompt: "Create repo ${REPO_NAME}",
      subagent: "github",
    });
  });

  it("handles multiple configs", () => {
    const configs: TaskConfig[] = [
      {
        id: "1",
        name: "Workflow A",
        category: "Custom",
        tasks: [
          { display_text: "A1", llm_prompt: "Do A", subagent: "user_input" },
        ],
        owner_id: "user",
        is_system: false,
        visibility: "private",
        created_at: new Date(),
        updated_at: new Date(),
      },
      {
        id: "2",
        name: "Workflow B",
        category: "Custom",
        tasks: [
          { display_text: "B1", llm_prompt: "Do B", subagent: "github" },
        ],
        owner_id: "user",
        is_system: false,
        visibility: "private",
        created_at: new Date(),
        updated_at: new Date(),
      },
    ];

    const result = toTaskConfigYamlFormat(configs);

    expect(result).toHaveProperty("Workflow A");
    expect(result).toHaveProperty("Workflow B");
    expect(result["Workflow A"].tasks[0].display_text).toBe("A1");
    expect(result["Workflow B"].tasks[0].display_text).toBe("B1");
  });

  it("returns empty object for empty array", () => {
    const result = toTaskConfigYamlFormat([]);
    expect(result).toEqual({});
  });
});
