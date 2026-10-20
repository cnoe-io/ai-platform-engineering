import type { AgentExecution, AgentRuntimeProfile, AgentRuntimeTier } from "@/types/dynamic-agent";

export function RuntimeContractDetails({ execution, profile, tiers }: {
  execution: AgentExecution;
  profile?: AgentRuntimeProfile;
  tiers: AgentRuntimeTier[];
}) {
  const native = execution.kind === "native";
  const contract = native ? tiers.find((tier) => tier.tier === "1")?.runtime_contract : profile?.runtime_contract;
  const unavailable = tiers.filter((tier) => (tier.tier === "2" || tier.tier === "2.5") && !tier.selectable);

  return <div className="space-y-2 text-xs text-muted-foreground">
    <p>{native
      ? "DeepAgents uses a logical workspace in CAIPE's shared runtime, scoped to the conversation by default. Approved workflows or namespace settings can share logical artifacts. No sandbox is created."
      : contract
        ? "Claude Code runs over ACP in a private sandbox for each caller-owned conversation."
        : "Claude Code runs over ACP using the selected sandbox profile."}</p>
    {contract && <dl aria-label="Runtime workspace and policy" className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
      <dt>{native ? "Default workspace" : "Workspace"}</dt><dd>{native ? "Conversation" : "Caller-owned conversation"}</dd>
      <dt>Files</dt><dd>{contract.filesystem === "logical" ? "Logical filesystem" : "Real sandbox filesystem"}</dd>
      <dt>Policy</dt><dd>{contract.policy_authority === "caipe" ? "CAIPE permissions and tools" : "CAIPE and the operator profile"}</dd>
    </dl>}
    {!native && profile && !contract && <p>Workspace and policy details are not reported by this server.</p>}
    {!native && contract && <p>Approved workflow artifacts can be synchronized separately.</p>}
    <p>Agent sharing controls access to its definition. Conversation access and workspace policies are separate. Runtime changes apply to new conversations; existing sessions keep their binding.</p>
    {unavailable.length > 0 && <details className="border-t pt-2">
      <summary className="cursor-pointer font-medium">Other runtime paths</summary>
      <ul className="mt-1 space-y-1">
        {unavailable.map((tier) => <li key={tier.tier}>
          <span className="font-medium">{tier.name}</span>{" "}
          <span>({tier.status === "research" ? "Research" : "Planned"}, unavailable)</span>
          {tier.reason && <p>{tier.reason}</p>}
        </li>)}
      </ul>
    </details>}
  </div>;
}
