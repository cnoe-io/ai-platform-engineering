/** @jest-environment node */

import { projectAuthzGraph } from "../inspection-client";

describe("Authz graph projection", () => {
  it("preserves sanitized conditional policy metadata", () => {
    const graph = projectAuthzGraph({
      nodes: [
        { id: "user:example-user", type: "user" },
        { id: "tool:issue_tracker/create_item", type: "tool" },
      ],
      edges: [{
        id: "edge-1",
        source: "user:example-user",
        target: "tool:issue_tracker/create_item",
        relation: "conditional_caller",
        conditional: true,
        condition_name: "string_argument_in_v1",
        policy: {
          policy_id: "primary-project-create",
          status: "ACTIVE",
          template: "string_argument_in_v1",
          field: "/project_key",
          schema_hash: `sha256:${"a".repeat(64)}`,
          version: 2,
        },
      }],
      truncated: false,
    });

    expect(graph.edges[0]).toMatchObject({
      conditional: true,
      condition_name: "string_argument_in_v1",
      policy: {
        policy_id: "primary-project-create",
        field: "/project_key",
        version: 2,
      },
    });
    expect(JSON.stringify(graph)).not.toContain("PRIMARY");
  });
});
