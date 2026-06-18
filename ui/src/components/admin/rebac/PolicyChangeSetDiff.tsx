"use client";

import { Badge } from "@/components/ui/badge";
import type { UniversalRebacRelationship } from "@/types/rbac-universal";

interface BlockedChange {
  operation: "grant" | "revoke";
  code: string;
  reason: string;
  relationship: UniversalRebacRelationship;
}

export interface PolicyChangeSetDiffProps {
  grants: UniversalRebacRelationship[];
  revocations: UniversalRebacRelationship[];
  blocked?: BlockedChange[];
}

function describe(relationship: UniversalRebacRelationship): string {
  const subject = `${relationship.subject.type}:${relationship.subject.id}${
    relationship.subject.relation ? `#${relationship.subject.relation}` : ""
  }`;
  return `${subject} ${relationship.action} ${relationship.resource.type}:${relationship.resource.id}`;
}

export function PolicyChangeSetDiff({
  grants,
  revocations,
  blocked = [],
}: PolicyChangeSetDiffProps) {
  if (grants.length === 0 && revocations.length === 0 && blocked.length === 0) {
    return null;
  }

  return (
    <div className="space-y-3 rounded-md border bg-muted/20 p-3 text-sm">
      <div className="flex flex-wrap gap-2">
        <Badge variant="default">{grants.length} grant{grants.length === 1 ? "" : "s"}</Badge>
        <Badge variant="secondary">
          {revocations.length} revoke{revocations.length === 1 ? "" : "s"}
        </Badge>
        {blocked.length > 0 && (
          <Badge variant="destructive">
            {blocked.length} blocked change{blocked.length === 1 ? "" : "s"}
          </Badge>
        )}
      </div>
      {grants.length > 0 && (
        <div>
          <p className="font-medium">Grants</p>
          <ul className="mt-1 list-disc space-y-1 pl-5">
            {grants.map((relationship) => (
              <li key={`grant:${describe(relationship)}`}>{describe(relationship)}</li>
            ))}
          </ul>
        </div>
      )}
      {revocations.length > 0 && (
        <div>
          <p className="font-medium">Revocations</p>
          <ul className="mt-1 list-disc space-y-1 pl-5">
            {revocations.map((relationship) => (
              <li key={`revoke:${describe(relationship)}`}>{describe(relationship)}</li>
            ))}
          </ul>
        </div>
      )}
      {blocked.length > 0 && (
        <div>
          <p className="font-medium text-destructive">Blocked by validation</p>
          <ul className="mt-1 list-disc space-y-1 pl-5">
            {blocked.map((change, index) => (
              <li key={`${change.code}:${index}`}>
                {change.operation} {describe(change.relationship)}: {change.reason}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
