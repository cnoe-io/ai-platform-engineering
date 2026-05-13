"use client";

import type { ReactNode } from "react";
import { GitBranch } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import type { UniversalRebacRelationship } from "@/types/rbac-universal";
import { PolicyChangeSetDiff } from "./PolicyChangeSetDiff";

interface RebacPolicyBuilderProps {
  selectedGrant?: UniversalRebacRelationship | null;
  selectedRevocation?: UniversalRebacRelationship | null;
  disabled?: boolean;
  busy?: boolean;
  children: ReactNode;
  onGrant: () => void;
  onRevoke: () => void;
}

export function RebacPolicyBuilder({
  selectedGrant,
  selectedRevocation,
  disabled,
  busy,
  children,
  onGrant,
  onRevoke,
}: RebacPolicyBuilderProps) {
  const grants = selectedGrant ? [selectedGrant] : [];
  const revocations = selectedRevocation ? [selectedRevocation] : [];

  return (
    <Card>
      <CardHeader>
        <CardTitle>Guided Policy Builder</CardTitle>
        <CardDescription>
          Stage a ReBAC change set, validate it, and apply it atomically instead of writing raw tuples.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {children}
        <PolicyChangeSetDiff grants={grants} revocations={revocations} />
        <div className="flex flex-wrap gap-2">
          <Button disabled={disabled || busy || !selectedGrant} onClick={onGrant} className="gap-2">
            <GitBranch className="h-4 w-4" />
            Validate and grant
          </Button>
          <Button
            variant="outline"
            disabled={disabled || busy || !selectedRevocation}
            onClick={onRevoke}
          >
            Validate and revoke
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
