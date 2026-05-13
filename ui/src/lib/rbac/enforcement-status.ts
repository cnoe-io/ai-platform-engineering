import { getRbacCollection } from "./mongo-collections";
import { listResourceTypeDefinitions } from "./resource-model";
import type { RebacEnforcementStatus } from "./resource-catalog";
import type { UniversalRebacResourceType } from "@/types/rbac-universal";

export interface RebacEnforcementStatusRecord {
  resource_type: UniversalRebacResourceType;
  enforcement_status: RebacEnforcementStatus;
  surface: string;
  notes?: string;
  updated_by?: string;
  updated_at?: string;
}

const DEFAULT_STATUS: RebacEnforcementStatus = "role_gated";

export async function listRebacEnforcementStatuses(): Promise<RebacEnforcementStatusRecord[]> {
  const defaults = listResourceTypeDefinitions().map((definition) => ({
    resource_type: definition.type,
    enforcement_status: DEFAULT_STATUS,
    surface: definition.type,
  }));

  let overrides: RebacEnforcementStatusRecord[] = [];
  try {
    const collection = await getRbacCollection<RebacEnforcementStatusRecord>(
      "rebacEnforcementStatus"
    );
    overrides = await collection.find({}).sort({ resource_type: 1 }).toArray();
  } catch {
    overrides = [];
  }

  const overrideByType = new Map(overrides.map((row) => [row.resource_type, row]));
  return defaults.map((row) => ({ ...row, ...overrideByType.get(row.resource_type) }));
}
