import type { OktaSyncRun, OktaSyncSettings } from "./mongo-collections";
import { getRbacCollection } from "./mongo-collections";

const DEFAULT_SETTINGS: Omit<OktaSyncSettings, "_id"> = {
  id: "singleton",
  enabled: false,
  sync_interval_minutes: 60,
  chunk_size: 250,
  updated_by: "system",
  updated_at: new Date(0).toISOString(),
};

export async function getOktaSyncSettings(): Promise<OktaSyncSettings> {
  const col = await getRbacCollection<OktaSyncSettings>("oktaSyncSettings");
  const doc = await col.findOne({ id: "singleton" });
  if (!doc) return DEFAULT_SETTINGS as OktaSyncSettings;
  return doc;
}

export async function upsertOktaSyncSettings(
  settings: Partial<Omit<OktaSyncSettings, "id">>
): Promise<void> {
  const col = await getRbacCollection<OktaSyncSettings>("oktaSyncSettings");
  await col.updateOne(
    { id: "singleton" },
    { $set: { ...settings, id: "singleton" } },
    { upsert: true }
  );
}

export async function listOktaSyncRuns(limit = 20): Promise<OktaSyncRun[]> {
  const col = await getRbacCollection<OktaSyncRun>("oktaSyncRuns");
  return col.find({}).sort({ started_at: -1 }).limit(limit).toArray();
}

export async function insertOktaSyncRun(run: Omit<OktaSyncRun, "_id">): Promise<void> {
  const col = await getRbacCollection<OktaSyncRun>("oktaSyncRuns");
  await col.insertOne(run as OktaSyncRun);
}

export async function updateOktaSyncRun(
  id: string,
  update: Partial<OktaSyncRun>
): Promise<void> {
  const col = await getRbacCollection<OktaSyncRun>("oktaSyncRuns");
  await col.updateOne({ id }, { $set: update });
}
