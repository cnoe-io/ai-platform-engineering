"use client";

const LABELS: Record<string, string> = {
  unconditional_exact_allow: "An unconditional exact grant also allows this subject.",
  wildcard_allow: "A wildcard grant also allows every tool on this server.",
  known_transitive_subject: "A userset or channel path may grant equivalent access.",
};

export function PolicyEffectiveness({
  exclusive,
  warnings,
}: {
  exclusive: boolean;
  warnings: string[];
}) {
  return (
    <div className={`rounded-md border p-3 text-sm ${exclusive ? "border-emerald-500/40 bg-emerald-500/5" : "border-amber-500/40 bg-amber-500/5"}`}>
      <div className="font-medium">{exclusive ? "Exclusive restriction" : "Additive policy"}</div>
      <p className="mt-1 text-muted-foreground">
        {exclusive
          ? "No known broader relationship currently bypasses this expression."
          : "The condition is valid, but another relationship can still allow the request."}
      </p>
      {warnings.length > 0 && (
        <ul className="mt-2 list-disc space-y-1 pl-5">
          {warnings.map((warning) => <li key={warning}>{LABELS[warning] ?? warning}</li>)}
        </ul>
      )}
      <p className="mt-2 text-xs text-muted-foreground">
        Derived access can change as teams, usersets, and wildcard relationships change.
      </p>
    </div>
  );
}
