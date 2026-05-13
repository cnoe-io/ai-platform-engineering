import type { Document } from "mongodb";
import type { UniversalRebacRelationship } from "@/types/rbac-universal";

import { getRbacCollection } from "./mongo-collections";

export interface PolicyRuleDocument extends Document {
  id: string;
  name: string;
  description?: string;
  enabled: boolean;
  relationships: UniversalRebacRelationship[];
  created_by?: string;
  created_at: string;
  updated_by?: string;
  updated_at?: string;
}

function collection() {
  return getRbacCollection<PolicyRuleDocument>("policyRules");
}

export async function listPolicyRules(): Promise<PolicyRuleDocument[]> {
  return (await collection()).find({}).sort({ name: 1 }).toArray();
}

export async function upsertPolicyRule(rule: PolicyRuleDocument): Promise<void> {
  await (await collection()).updateOne({ id: rule.id }, { $set: rule }, { upsert: true });
}
