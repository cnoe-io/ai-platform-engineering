import { randomUUID } from "crypto";
import type { Document } from "mongodb";
import type { UniversalRebacRelationship } from "@/types/rbac-universal";

import { getRbacCollection } from "./mongo-collections";
import type { PolicyChangeValidationResult } from "./policy-change-validator";

export type PolicyChangeSetStatus = "draft" | "validated" | "blocked" | "applied";

export interface PolicyChangeSetDocument extends Document {
  id: string;
  name: string;
  description?: string;
  status: PolicyChangeSetStatus;
  writes: UniversalRebacRelationship[];
  deletes: UniversalRebacRelationship[];
  validation?: PolicyChangeValidationResult;
  created_by: string;
  created_at: string;
  updated_by?: string;
  updated_at?: string;
  applied_by?: string;
  applied_at?: string;
}

export interface CreatePolicyChangeSetInput {
  name: string;
  description?: string;
  writes: UniversalRebacRelationship[];
  deletes: UniversalRebacRelationship[];
  actorEmail: string;
}

function collection() {
  return getRbacCollection<PolicyChangeSetDocument>("policyChangeSets");
}

export async function createPolicyChangeSet(
  input: CreatePolicyChangeSetInput
): Promise<PolicyChangeSetDocument> {
  const now = new Date().toISOString();
  const doc: PolicyChangeSetDocument = {
    id: randomUUID(),
    name: input.name,
    description: input.description,
    status: "draft",
    writes: input.writes,
    deletes: input.deletes,
    created_by: input.actorEmail,
    created_at: now,
    updated_by: input.actorEmail,
    updated_at: now,
  };
  await (await collection()).insertOne(doc);
  return doc;
}

export async function getPolicyChangeSet(
  id: string
): Promise<PolicyChangeSetDocument | null> {
  return (await collection()).findOne({ id });
}

export async function updatePolicyChangeSet(
  id: string,
  updates: Partial<PolicyChangeSetDocument>
): Promise<PolicyChangeSetDocument | null> {
  const existing = await getPolicyChangeSet(id);
  if (!existing) return null;
  const next = { ...existing, ...updates };
  await (await collection()).updateOne({ id }, { $set: updates });
  return next;
}
