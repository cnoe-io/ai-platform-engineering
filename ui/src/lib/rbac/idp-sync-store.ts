import type { IdpSyncRun, IdpSyncSettings } from "./mongo-collections";
import { getRbacCollection } from "./mongo-collections";

function defaultSettings(providerId: string): IdpSyncSettings {
  return {
    provider_id: providerId,
    enabled: false,
    schedule_mode: "interval",
    sync_interval_minutes: 60,
    updated_by: "system",
    updated_at: new Date(0).toISOString(),
  } as IdpSyncSettings;
}

/** Settings for one IdP connector. Returns connector defaults when unset. */
export async function getIdpSyncSettings(providerId: string): Promise<IdpSyncSettings> {
  const col = await getRbacCollection<IdpSyncSettings>("idpSyncSettings");
  const doc = await col.findOne({ provider_id: providerId });
  return doc ?? defaultSettings(providerId);
}

export async function upsertIdpSyncSettings(
  providerId: string,
  settings: Partial<Omit<IdpSyncSettings, "provider_id">>
): Promise<void> {
  const col = await getRbacCollection<IdpSyncSettings>("idpSyncSettings");
  await col.updateOne(
    { provider_id: providerId },
    { $set: { ...settings, provider_id: providerId } },
    { upsert: true }
  );
}

/** Recent runs for one connector, newest first. */
export async function listIdpSyncRuns(providerId: string, limit = 20): Promise<IdpSyncRun[]> {
  const col = await getRbacCollection<IdpSyncRun>("idpSyncRuns");
  return col.find({ provider_id: providerId }).sort({ started_at: -1 }).limit(limit).toArray();
}

export async function insertIdpSyncRun(run: Omit<IdpSyncRun, "_id">): Promise<void> {
  const col = await getRbacCollection<IdpSyncRun>("idpSyncRuns");
  await col.insertOne(run as IdpSyncRun);
}

export async function updateIdpSyncRun(id: string, update: Partial<IdpSyncRun>): Promise<void> {
  const col = await getRbacCollection<IdpSyncRun>("idpSyncRuns");
  await col.updateOne({ id }, { $set: update });
}
