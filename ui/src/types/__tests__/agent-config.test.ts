/**
 * Tests for agent-config.ts utility functions.
 *
 * Covers:
 *  - extractPromptVariables: single-brace, double-brace, default values, dedup, edge cases
 *  - generateInputFormFromPrompt: label generation, field types, defaults, null return
 *  - parseTaskConfigObject: category inference, env var extraction
 */

import {
  extractPromptVariables,
  generateInputFormFromPrompt,
  parseTaskConfigObject,
} from "../agent-config";

// ---------------------------------------------------------------------------
// extractPromptVariables
// ---------------------------------------------------------------------------

describe("extractPromptVariables", () => {
  it("extracts single-brace required variables", () => {
    const vars = extractPromptVariables("Deploy {app_name} to {cluster}");
    expect(vars).toEqual([
      { name: "app_name", required: true },
      { name: "cluster", required: true },
    ]);
  });

  it("extracts double-brace required variables", () => {
    const vars = extractPromptVariables("Review PR at {{prUrl}}");
    expect(vars).toEqual([{ name: "prUrl", required: true }]);
  });

  it("extracts double-brace variables with default values", () => {
    const vars = extractPromptVariables(
      "Deploy {{app_name:my-service}} to {{cluster:prod-us}}"
    );
    expect(vars).toEqual([
      { name: "app_name", required: false, defaultValue: "my-service" },
      { name: "cluster", required: false, defaultValue: "prod-us" },
    ]);
  });

  it("handles mixed required and optional variables", () => {
    const vars = extractPromptVariables(
      "Deploy {app_name} to {{cluster:prod}} with {{replicas:3}}"
    );
    expect(vars).toEqual([
      { name: "app_name", required: true },
      { name: "cluster", required: false, defaultValue: "prod" },
      { name: "replicas", required: false, defaultValue: "3" },
    ]);
  });

  it("deduplicates variable names (first occurrence wins)", () => {
    const vars = extractPromptVariables(
      "Deploy {app_name} and then check {app_name} again"
    );
    expect(vars).toHaveLength(1);
    expect(vars[0].name).toBe("app_name");
  });

  it("deduplicates across single and double brace patterns", () => {
    const vars = extractPromptVariables(
      "Deploy {app_name} and {{app_name:default}}"
    );
    expect(vars).toHaveLength(1);
    expect(vars[0]).toEqual({ name: "app_name", required: true });
  });

  it("returns empty array for prompts without variables", () => {
    const vars = extractPromptVariables("Show me the status of all apps");
    expect(vars).toEqual([]);
  });

  it("handles empty string input", () => {
    expect(extractPromptVariables("")).toEqual([]);
  });

  it("handles default values containing spaces", () => {
    const vars = extractPromptVariables("{{greeting:hello world}}");
    expect(vars).toEqual([
      { name: "greeting", required: false, defaultValue: "hello world" },
    ]);
  });

  it("handles numeric default values", () => {
    const vars = extractPromptVariables(
      "Scale to {{replicas:50}} instances on {{port:8080}}"
    );
    expect(vars).toEqual([
      { name: "replicas", required: false, defaultValue: "50" },
      { name: "port", required: false, defaultValue: "8080" },
    ]);
  });

  it("ignores empty double-brace content", () => {
    const vars = extractPromptVariables("Deploy {{}} to cluster");
    expect(vars).toEqual([]);
  });

  it("supports underscored and camelCase variable names", () => {
    const vars = extractPromptVariables(
      "{repo_name} {{clusterName}} {{maxRetries:5}}"
    );
    expect(vars).toHaveLength(3);
    expect(vars[0].name).toBe("repo_name");
    expect(vars[1].name).toBe("clusterName");
    expect(vars[2].name).toBe("maxRetries");
  });

  it("handles default value with colon in value", () => {
    const vars = extractPromptVariables("{{endpoint:http://localhost:8080}}");
    expect(vars).toEqual([
      { name: "endpoint", required: false, defaultValue: "http://localhost:8080" },
    ]);
  });

  it("trims whitespace in variable names and defaults", () => {
    const vars = extractPromptVariables("{{ app_name : my-service }}");
    expect(vars).toEqual([
      { name: "app_name", required: false, defaultValue: "my-service" },
    ]);
  });
});

// ---------------------------------------------------------------------------
// generateInputFormFromPrompt
// ---------------------------------------------------------------------------

describe("generateInputFormFromPrompt", () => {
  it("returns null for prompts with no variables", () => {
    const form = generateInputFormFromPrompt(
      "Show me the status of all apps",
      "Test"
    );
    expect(form).toBeNull();
  });

  it("generates form with correct title and fields", () => {
    const form = generateInputFormFromPrompt(
      "Deploy {app_name} to {cluster}",
      "Deploy Helper"
    );
    expect(form).not.toBeNull();
    expect(form!.title).toBe("Deploy Helper");
    expect(form!.fields).toHaveLength(2);
    expect(form!.submitLabel).toBe("Start");
    expect(form!.description).toContain("following information");
  });

  it("converts snake_case names to title case labels", () => {
    const form = generateInputFormFromPrompt("{repo_name}", "Test");
    expect(form!.fields[0].label).toBe("Repo Name");
  });

  it("converts camelCase names to title case labels", () => {
    const form = generateInputFormFromPrompt("{clusterName}", "Test");
    expect(form!.fields[0].label).toBe("Cluster Name");
  });

  it("converts underscore names to title case labels", () => {
    const form = generateInputFormFromPrompt("{{my_service}}", "Test");
    expect(form!.fields[0].label).toBe("My Service");
  });

  it("detects URL type from variable name containing 'url'", () => {
    const form = generateInputFormFromPrompt("{prUrl}", "Test");
    expect(form!.fields[0].type).toBe("url");
  });

  it("detects URL type from variable name containing 'link'", () => {
    const form = generateInputFormFromPrompt("{pr_link}", "Test");
    expect(form!.fields[0].type).toBe("url");
  });

  it("detects number type from variable name containing 'count'", () => {
    const form = generateInputFormFromPrompt("{retry_count}", "Test");
    expect(form!.fields[0].type).toBe("number");
  });

  it("detects number type from variable name containing 'number'", () => {
    const form = generateInputFormFromPrompt("{port_number}", "Test");
    expect(form!.fields[0].type).toBe("number");
  });

  it("marks required variables as required", () => {
    const form = generateInputFormFromPrompt("{app_name}", "Test");
    expect(form!.fields[0].required).toBe(true);
    expect(form!.fields[0].defaultValue).toBeUndefined();
    expect(form!.fields[0].placeholder).toBe("Enter app name");
  });

  it("marks optional variables (with default) as not required", () => {
    const form = generateInputFormFromPrompt("{{app_name:my-app}}", "Test");
    expect(form!.fields[0].required).toBe(false);
    expect(form!.fields[0].defaultValue).toBe("my-app");
    expect(form!.fields[0].placeholder).toBe("Default: my-app");
  });

  it("handles mixed required and optional variables", () => {
    const form = generateInputFormFromPrompt(
      "{repo_name} {{branch:main}} {{count:10}}",
      "Test"
    );
    expect(form!.fields).toHaveLength(3);
    expect(form!.fields[0].required).toBe(true);
    expect(form!.fields[0].placeholder).toBe("Enter repo name");
    expect(form!.fields[1].required).toBe(false);
    expect(form!.fields[1].defaultValue).toBe("main");
    expect(form!.fields[2].required).toBe(false);
    expect(form!.fields[2].type).toBe("number");
  });
});

// ---------------------------------------------------------------------------
// parseTaskConfigObject
// ---------------------------------------------------------------------------

describe("parseTaskConfigObject", () => {
  it("infers GitHub category from name", () => {
    const configs = parseTaskConfigObject({
      "Create GitHub Repo": {
        tasks: [
          { display_text: "Create", llm_prompt: "Create repo", subagent: "github" },
        ],
      },
    });
    expect(configs[0].category).toBe("GitHub Operations");
    expect(configs[0].is_system).toBe(true);
  });

  it("infers AWS category from name", () => {
    const configs = parseTaskConfigObject({
      "Provision EC2 Instance": {
        tasks: [
          { display_text: "Provision", llm_prompt: "Create EC2", subagent: "aws" },
        ],
      },
    });
    expect(configs[0].category).toBe("AWS Operations");
  });

  it("infers ArgoCD category from deploy keyword", () => {
    const configs = parseTaskConfigObject({
      "Deploy Application": {
        tasks: [
          { display_text: "Deploy", llm_prompt: "Deploy app", subagent: "argocd" },
        ],
      },
    });
    expect(configs[0].category).toBe("ArgoCD Operations");
  });

  it("defaults to Custom for unrecognized names", () => {
    const configs = parseTaskConfigObject({
      "Random Workflow": {
        tasks: [
          { display_text: "Do stuff", llm_prompt: "Do stuff", subagent: "caipe" },
        ],
      },
    });
    expect(configs[0].category).toBe("Custom");
  });

  it("extracts environment variables from prompts", () => {
    const configs = parseTaskConfigObject({
      "Test Workflow": {
        tasks: [
          {
            display_text: "Test",
            llm_prompt: "Use ${API_KEY} and ${SECRET_TOKEN}",
            subagent: "caipe",
          },
        ],
      },
    });
    expect(configs[0].metadata?.env_vars_required).toEqual(
      expect.arrayContaining(["API_KEY", "SECRET_TOKEN"])
    );
  });

  it("uses provided ownerId", () => {
    const configs = parseTaskConfigObject(
      {
        "Test": {
          tasks: [{ display_text: "T", llm_prompt: "T", subagent: "caipe" }],
        },
      },
      "user@example.com"
    );
    expect(configs[0].owner_id).toBe("user@example.com");
    expect(configs[0].is_system).toBe(false);
  });

  it("creates multiple configs from multiple entries", () => {
    const configs = parseTaskConfigObject({
      "Workflow A": {
        tasks: [{ display_text: "A", llm_prompt: "A", subagent: "caipe" }],
      },
      "Workflow B": {
        tasks: [{ display_text: "B", llm_prompt: "B", subagent: "github" }],
      },
    });
    expect(configs).toHaveLength(2);
  });
});
