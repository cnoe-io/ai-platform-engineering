"use client";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { UniversalRebacRelationship } from "@/types/rbac-universal";
import { Shield } from "lucide-react";

export function RebacAccessChecker({
  relationship,
  allowed,
  busy,
  canGrant,
  onCheck,
  onGrant,
  onRevoke,
}: {
  relationship: UniversalRebacRelationship | null;
  allowed: boolean | null;
  busy: boolean;
  canGrant?: boolean;
  onCheck: () => void;
  onGrant?: () => void;
  onRevoke?: () => void;
}) {
  return (
    <div className="space-y-3">
      <Button disabled={busy || !relationship} onClick={onCheck} className="gap-2">
        <Shield className="h-4 w-4" />
        Explain effective access
      </Button>
      {allowed !== null && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-md border p-3 text-sm">
          <div>
            Result: <Badge variant={allowed ? "default" : "destructive"}>{allowed ? "allowed" : "denied"}</Badge>
          </div>
          {allowed === false && canGrant && onGrant && (
            <Button type="button" size="sm" variant="outline" disabled={busy || !relationship} onClick={onGrant}>
              Grant this access
            </Button>
          )}
          {allowed === true && canGrant && onRevoke && (
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={busy || !relationship}
              onClick={onRevoke}
              className="text-destructive"
            >
              Revoke this access
            </Button>
          )}
        </div>
      )}
    </div>
  );
}
