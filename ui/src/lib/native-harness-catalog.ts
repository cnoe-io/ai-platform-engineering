import type { AgentExecution, AgentRuntimeCatalog } from "@/types/dynamic-agent";
import type { HarnessDescriptor } from "@/types/harness-engine";

/** UI profile keys are projections; saved native execution retains its existing shape. */
export function nativeHarnessProfileKey(execution: AgentExecution): string {
  return execution.kind === "native" ? "native" : `sandbox:${execution.profile_id}`;
}

/** Native ACP and SDK providers share one descriptor-driven editor. */
export function nativeHarnessDescriptor(catalog?: AgentRuntimeCatalog): HarnessDescriptor {
  return {
    id: "dynamic_agents", display_name: "Native ACP", adapter_version: "1", contract_version: 1,
    execution_mode: "in_process", availability: "available", certification: "experimental",
    profiles: [
      { id: "native", harness_id: "dynamic_agents", display_name: "Managed Agent (DeepAgents)",
        description: "CAIPE logical workspace and native tools", available: true, native_execution: { kind: "native" } },
      ...(catalog?.profiles ?? []).map((profile) => ({
        id: nativeHarnessProfileKey({ kind: "sandbox", profile_id: profile.id }), harness_id: "dynamic_agents",
        display_name: `${profile.name} (Private Coding Sandbox, Claude Code)`, description: "Operator-admitted private coding environment",
        available: true, native_execution: { kind: "sandbox" as const, profile_id: profile.id },
      })),
    ],
    options_schema: { type: "object", properties: {} }, ui_schema: {}, capabilities: {},
    ...(catalog ? { native_runtime_catalog: catalog } : { runtime_catalog_unavailable: true }),
  };
}
