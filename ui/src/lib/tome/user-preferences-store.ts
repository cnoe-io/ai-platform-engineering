/**
 * Mongo-backed per-user Tome UI preferences.
 *
 * Kept separate from project documents: one person's hub arrangement must
 * never change the canonical project or another person's view.
 */

import type { Collection, Document } from "mongodb";

import { getCollection } from "@/lib/mongodb";
import { normalizeBhagOrder } from "@/lib/tome/bhag-order";
import {
  normalizeStoredIssueFilterViews,
  type StoredIssueFilterViews,
} from "@/lib/tome/issue-filter-views";

export const TOME_USER_PREFERENCES_COLLECTION = "tome_user_preferences";

interface TomeUserPreferencesDocument extends Document {
  tenant_id: string;
  user_id: string;
  bhag_order: string[];
  issue_filter_views_by_project?: Record<string, StoredIssueFilterViews>;
  updated_at: Date;
}

async function preferencesCollection(): Promise<Collection<TomeUserPreferencesDocument>> {
  return getCollection<TomeUserPreferencesDocument>(TOME_USER_PREFERENCES_COLLECTION);
}

export async function readTomeBhagOrder(
  tenantId: string,
  userId: string,
): Promise<string[]> {
  const collection = await preferencesCollection();
  const document = await collection.findOne(
    { tenant_id: tenantId, user_id: userId },
    { projection: { _id: 0, bhag_order: 1 } },
  );
  return normalizeBhagOrder(document?.bhag_order);
}

export async function writeTomeBhagOrder(
  tenantId: string,
  userId: string,
  bhagOrder: unknown,
): Promise<string[]> {
  const normalized = normalizeBhagOrder(bhagOrder);
  const collection = await preferencesCollection();
  await collection.updateOne(
    { tenant_id: tenantId, user_id: userId },
    {
      $set: {
        tenant_id: tenantId,
        user_id: userId,
        bhag_order: normalized,
        updated_at: new Date(),
      },
    },
    { upsert: true },
  );
  return normalized;
}

export async function readTomeIssueFilterViews(
  tenantId: string,
  userId: string,
  projectId: string,
): Promise<StoredIssueFilterViews> {
  const collection = await preferencesCollection();
  const field = `issue_filter_views_by_project.${projectId}`;
  const document = await collection.findOne(
    { tenant_id: tenantId, user_id: userId },
    { projection: { _id: 0, [field]: 1 } },
  );
  return normalizeStoredIssueFilterViews(
    document?.issue_filter_views_by_project?.[projectId],
  );
}

export async function writeTomeIssueFilterViews(
  tenantId: string,
  userId: string,
  projectId: string,
  value: unknown,
): Promise<StoredIssueFilterViews> {
  const normalized = normalizeStoredIssueFilterViews(value);
  const collection = await preferencesCollection();
  await collection.updateOne(
    { tenant_id: tenantId, user_id: userId },
    {
      $set: {
        tenant_id: tenantId,
        user_id: userId,
        [`issue_filter_views_by_project.${projectId}`]: normalized,
        updated_at: new Date(),
      },
    },
    { upsert: true },
  );
  return normalized;
}
