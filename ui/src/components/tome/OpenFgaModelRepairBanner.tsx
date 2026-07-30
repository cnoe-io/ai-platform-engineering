"use client";

import { useCallback, useEffect, useState } from "react";
import { CheckCircle2, Loader2, ShieldAlert } from "lucide-react";

import { Button } from "@/components/ui/button";

type RepairState =
  | "checking"
  | "healthy"
  | "repair-needed"
  | "repairing"
  | "repaired"
  | "error";

/**
 * Global Tome authorization-model recovery. This lives on the Projects hub so
 * an administrator can repair a stale model even when project creation rolled
 * back and no per-project Settings page exists.
 */
export function OpenFgaModelRepairBanner() {
  const [state, setState] = useState<RepairState>("checking");

  const inspectModel = useCallback(async () => {
    setState("checking");
    try {
      const response = await fetch("/api/tome/admin/openfga-model", {
        cache: "no-store",
      });
      const body = (await response.json().catch(() => ({}))) as {
        healthy?: boolean;
      };
      if (!response.ok) throw new Error("model inspection failed");
      setState(body.healthy ? "healthy" : "repair-needed");
    } catch {
      setState("error");
    }
  }, []);

  useEffect(() => {
    void inspectModel();
  }, [inspectModel]);

  const repairModel = useCallback(async () => {
    setState("repairing");
    try {
      const response = await fetch("/api/tome/admin/openfga-model", {
        method: "POST",
      });
      if (!response.ok) throw new Error("model repair failed");
      setState("repaired");
    } catch {
      setState("error");
    }
  }, []);

  if (state === "healthy" || state === "checking") return null;

  return (
    <div
      role="status"
      aria-live="polite"
      className={
        state === "repaired"
          ? "flex flex-wrap items-center justify-between gap-3 rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-3"
          : "flex flex-wrap items-center justify-between gap-3 rounded-xl border border-amber-500/40 bg-amber-500/10 px-4 py-3"
      }
    >
      <div className="flex min-w-0 items-start gap-3">
        {state === "repaired" ? (
          <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-emerald-600 dark:text-emerald-400" />
        ) : (
          <ShieldAlert className="mt-0.5 h-5 w-5 shrink-0 text-amber-700 dark:text-amber-300" />
        )}
        <div>
          <p className="text-sm font-medium">
            {state === "repaired"
              ? "Inherited access model repaired"
              : state === "error"
                ? "Could not verify inherited access"
                : "Inherited access model needs repair"}
          </p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {state === "repaired"
              ? "You can retry project onboarding now."
              : state === "error"
                ? "Review Platform Health, then retry the model check."
                : "The active OpenFGA model is missing document parent inheritance. Repairing it preserves existing access tuples."}
          </p>
        </div>
      </div>
      {state === "repair-needed" || state === "repairing" ? (
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={() => void repairModel()}
          disabled={state === "repairing"}
        >
          {state === "repairing" ? (
            <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
          ) : null}
          {state === "repairing" ? "Repairing…" : "Repair model"}
        </Button>
      ) : (
        state === "error" && (
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => void inspectModel()}
          >
            Retry check
          </Button>
        )
      )}
    </div>
  );
}
