import { suggestNamespaceBindings } from "../BuiltinToolsPicker";

describe("suggestNamespaceBindings", () => {
  it("derives trusted binding candidates from MCP input schemas", () => {
    const result = suggestNamespaceBindings(
      "pods",
      [
        { name: "list_pods", inputSchema: { type: "object", properties: {} } },
        { name: "get_pod", inputSchema: { type: "object", properties: { pod_id: { type: "string" } } } },
        { name: "search", input_schema: { type: "object", properties: { query: { type: "string" } } } },
      ],
      "pod_id",
      "list_pods",
    );

    expect(result).toEqual([
      { server: "pods", tools: ["get_pod"], bind_arg: "pod_id", require_namespace: true },
    ]);
  });
});
