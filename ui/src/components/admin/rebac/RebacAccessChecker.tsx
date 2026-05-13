"use client";

import { Shield } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { UniversalRebacRelationship } from "@/types/rbac-universal";

export function RebacAccessChecker({
  relationship,
  allowed,
  busy,
  onCheck,
}: {
  relationship: UniversalRebacRelationship | null;
  allowed: boolean | null;
  busy: boolean;
  onCheck: () => void;
}) {
  return (
    <div className="space-y-3">
      <Button disabled={busy || !relationship} onClick={onCheck} className="gap-2">
        <Shield className="h-4 w-4" />
        Explain effective access
      </Button>
      {allowed !== null && (
        <div className="rounded-md border p-3 text-sm">
          Result: <Badge variant={allowed ? "default" : "destructive"}>{allowed ? "allowed" : "denied"}</Badge>
        </div>
      )}
    </div>
  );
}
