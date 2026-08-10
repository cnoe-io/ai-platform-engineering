import { buildCredentialMigrationPreview } from "@/lib/credentials/migration-preview";

describe("buildCredentialMigrationPreview", () => {
  it("returns metadata-only migration candidates for legacy MCP env refs", () => {
    const preview = buildCredentialMigrationPreview([
      {
        _id: "github",
        name: "GitHub",
        env: {
          GITHUB_TOKEN: "GITHUB_TOKEN_PRIVATE",
          SAFE_MODE: "true",
        },
      },
      {
        _id: "jira",
        name: "Jira",
        env: {
          JIRA_API_TOKEN: "JIRA_API_TOKEN",
        },
      },
    ]);

    expect(preview).toEqual([
      {
        sourceId: "github",
        sourceName: "GitHub",
        sourceKind: "mcp_server_env",
        envName: "GITHUB_TOKEN",
        envRef: "GITHUB_TOKEN_PRIVATE",
        proposedSecretName: "GitHub GITHUB_TOKEN",
      },
      {
        sourceId: "jira",
        sourceName: "Jira",
        sourceKind: "mcp_server_env",
        envName: "JIRA_API_TOKEN",
        envRef: "JIRA_API_TOKEN",
        proposedSecretName: "Jira JIRA_API_TOKEN",
      },
    ]);
    expect(JSON.stringify(preview)).not.toContain("true");
  });
});
