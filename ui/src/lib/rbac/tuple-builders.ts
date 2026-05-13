import type {
  UniversalRebacRelationship,
  UniversalRebacResourceAction,
  UniversalRebacResourceRef,
  UniversalRebacSubjectRef,
} from "@/types/rbac-universal";

import type { OpenFgaTupleKey, TeamResourceTupleDiff } from "./openfga";
import { assertRelationshipValid } from "./relationship-validator";

const ACTION_TO_RELATION: Record<UniversalRebacResourceAction, string> = {
  discover: "can_discover",
  read: "can_read",
  use: "can_use",
  write: "can_write",
  create: "can_create",
  delete: "can_delete",
  manage: "can_manage",
  administer: "can_admin",
  audit: "can_audit",
  approve: "can_approve",
  share: "can_share",
  call: "can_call",
  invoke: "can_invoke",
  map: "can_map",
  ingest: "can_ingest",
  "read-metadata": "can_read_metadata",
};

export const OPENFGA_ACTION_RELATIONS = Object.values(ACTION_TO_RELATION);

export interface UniversalRebacTupleDiffInput {
  writes: UniversalRebacRelationship[];
  deletes: UniversalRebacRelationship[];
}

export function openFgaSubject(subject: UniversalRebacSubjectRef): string {
  const base = `${subject.type}:${subject.id}`;
  return subject.relation ? `${base}#${subject.relation}` : base;
}

export function openFgaObject(resource: UniversalRebacResourceRef): string {
  return `${resource.type}:${resource.id}`;
}

export function openFgaRelation(action: UniversalRebacResourceAction): string {
  return ACTION_TO_RELATION[action];
}

export function buildOpenFgaTuple(relationship: UniversalRebacRelationship): OpenFgaTupleKey {
  assertRelationshipValid(relationship);
  return {
    user: openFgaSubject(relationship.subject),
    relation: openFgaRelation(relationship.action),
    object: openFgaObject(relationship.resource),
  };
}

function uniqueTuples(tuples: OpenFgaTupleKey[]): OpenFgaTupleKey[] {
  const seen = new Set<string>();
  const out: OpenFgaTupleKey[] = [];
  for (const tuple of tuples) {
    const key = `${tuple.user}\n${tuple.relation}\n${tuple.object}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(tuple);
  }
  return out;
}

export function buildOpenFgaTupleDiff(input: UniversalRebacTupleDiffInput): TeamResourceTupleDiff {
  return {
    writes: uniqueTuples(input.writes.map(buildOpenFgaTuple)),
    deletes: uniqueTuples(input.deletes.map(buildOpenFgaTuple)),
  };
}

export const buildUniversalRebacTupleDiff = buildOpenFgaTupleDiff;
