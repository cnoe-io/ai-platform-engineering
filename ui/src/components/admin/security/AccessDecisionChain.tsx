import { Badge } from "@/components/ui/badge";
import type { UnifiedAuditEvent } from "@/lib/rbac/types";
import { ACCESS_GATE_LABELS } from "./access-decision-description";

export function AccessDecisionChain({ event }: { event: UnifiedAuditEvent }) {
  const aggregate = event.count !== undefined || event.batch || event.list_objects;
  const checks = aggregate ? undefined : event.gateway_checks;
  return (
    <section aria-label="Recorded access chain" className="mb-4 space-y-3 rounded-md border p-3 text-sm">
      <h4 className="font-semibold">Recorded access chain</h4>
      <p className="break-words">
        <span className="text-muted-foreground">Starting principal: </span>{event.subject_ref || "Not recorded"}
        {event.agent_ref && <> → {event.agent_ref}</>}
        {event.resource_ref && <> → {event.resource_ref}</>}
      </p>
      <p><span className="text-muted-foreground">Requested by: </span>{event.actor_ref || "Not recorded"}</p>
      <p className="text-xs text-muted-foreground">This chain starts at CAS. Earlier sign-in or delegation steps are not recorded here.</p>
      {aggregate ? <p>No individual chain is available for this rollup or catalog lookup.</p>
        : !checks?.length ? <p>Full check sequence not recorded. Only the event&apos;s reported outcome and failed check are available.</p>
          : <>
            {event.gateway_policy && <p><span className="font-medium">Rule at the time: </span>{event.gateway_policy}</p>}
            <ol className="space-y-2">
              {checks.map((check, index) => {
                const status = check.reason === "AUTHZ_UNAVAILABLE" ? "Unavailable" : check.decision === "ALLOW" ? "Passed"
                  : check.gate === "context" ? "Rejected" : "No match";
                return (
                  <li key={index} className="rounded border p-2">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-medium">{index + 1}. {ACCESS_GATE_LABELS[check.gate]}</span>
                      <Badge variant="outline">{status}</Badge>
                    </div>
                    <div className="mt-1 break-words font-mono text-xs">
                      {check.subject_ref} · {check.relation || "verify signed caller-bound context"}
                      {check.resource_ref && <> · {check.resource_ref}</>}
                    </div>
                    <div className="mt-1 text-xs text-muted-foreground">Recorded reason: {check.reason}</div>
                  </li>
                );
              })}
            </ol>
            {checks.some((check) => check.resource_ref?.endsWith("/*")) && <p className="text-xs text-muted-foreground">Exact and server-wide tool grants are alternatives. “No match” is a candidate result, not the final request verdict.</p>}
            <p className="font-medium">{event.failed_gate
              ? `Stopped at ${ACCESS_GATE_LABELS[event.failed_gate] || event.failed_gate}.`
              : event.outcome === "allow" ? "All required checks passed." : "See the recorded outcome above."}</p>
            <p className="text-xs text-muted-foreground">OpenFGA&apos;s answer does not identify the particular team, inherited relationship or grant that produced it.</p>
          </>}
    </section>
  );
}
