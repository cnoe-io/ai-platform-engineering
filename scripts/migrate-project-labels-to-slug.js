#!/usr/bin/env node
/**
 * One-time migration: replace name-string values in labels.initiatives and
 * labels.areas with the stable slug of the referenced entity.
 *
 * Must run BEFORE deploying the code that switches label writes to slugs
 * (ui/src/components/tome/ProjectSettingsPanel.tsx, BhagProjectsPanel.tsx).
 *
 * Usage:
 *   MONGODB_URI=mongodb://... node scripts/migrate-project-labels-to-slug.js
 *   # dry-run (no writes):
 *   DRY_RUN=1 MONGODB_URI=... node scripts/migrate-project-labels-to-slug.js
 */

const { MongoClient } = require("mongodb");

const MONGODB_URI = process.env.MONGODB_URI;
const DB_NAME = process.env.MONGODB_DB ?? "caipe";
const DRY_RUN = process.env.DRY_RUN === "1";

if (!MONGODB_URI) {
  console.error("MONGODB_URI is required");
  process.exit(1);
}

function normLabel(value) {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

async function main() {
  const client = new MongoClient(MONGODB_URI);
  await client.connect();
  const db = client.db(DB_NAME);
  const col = db.collection("projects");

  // Load all BHAGs and Areas — each has a slug and a (possibly legacy) name.
  const parents = await col.find({ type: { $in: ["bhag", "area"] } }).toArray();

  // Build a map: normLabel(name or title) → slug, for each parent.
  // Prefer title (the editable display name) as the key since that's what
  // was stored in child labels; fall back to name.
  const nameToSlug = new Map();
  for (const p of parents) {
    const display = p.title || p.name || "";
    if (display) nameToSlug.set(normLabel(display), p.slug);
    if (p.name && p.name !== display) nameToSlug.set(normLabel(p.name), p.slug);
  }

  console.log(`Loaded ${parents.length} BHAG/Area entities`);
  console.log(`DRY_RUN=${DRY_RUN}`);

  // Find all projects with non-empty initiative or area labels.
  const projects = await col
    .find({
      $or: [
        { "labels.initiatives": { $exists: true, $ne: [] } },
        { "labels.areas": { $exists: true, $ne: [] } },
      ],
    })
    .toArray();

  let updated = 0;
  let skipped = 0;
  let unmapped = 0;

  for (const project of projects) {
    const initiatives = project.labels?.initiatives ?? [];
    const areas = project.labels?.areas ?? [];

    const newInitiatives = initiatives.map((i) => {
      // Already a slug (all lowercase, no spaces)?
      if (i === i.toLowerCase() && !i.includes(" ")) return i;
      const slug = nameToSlug.get(normLabel(i));
      if (!slug) {
        console.warn(`  [unmapped] project ${project.slug}: initiative "${i}" — no parent found`);
        unmapped++;
        return i;
      }
      return slug;
    });

    const newAreas = areas.map((a) => {
      if (a === a.toLowerCase() && !a.includes(" ")) return a;
      const slug = nameToSlug.get(normLabel(a));
      if (!slug) {
        console.warn(`  [unmapped] project ${project.slug}: area "${a}" — no parent found`);
        unmapped++;
        return a;
      }
      return slug;
    });

    const changed =
      JSON.stringify(newInitiatives) !== JSON.stringify(initiatives) ||
      JSON.stringify(newAreas) !== JSON.stringify(areas);

    if (!changed) {
      skipped++;
      continue;
    }

    console.log(`  [update] ${project.slug}: initiatives ${JSON.stringify(initiatives)} → ${JSON.stringify(newInitiatives)}, areas ${JSON.stringify(areas)} → ${JSON.stringify(newAreas)}`);

    if (!DRY_RUN) {
      await col.updateOne(
        { _id: project._id },
        { $set: { "labels.initiatives": newInitiatives, "labels.areas": newAreas } },
      );
    }
    updated++;
  }

  // Also unset the legacy `name` field from all documents that have it.
  if (!DRY_RUN) {
    const { modifiedCount } = await col.updateMany(
      { name: { $exists: true } },
      { $unset: { name: "" } },
    );
    console.log(`Unset legacy 'name' field from ${modifiedCount} documents`);
  } else {
    const legacyCount = await col.countDocuments({ name: { $exists: true } });
    console.log(`[DRY_RUN] Would unset legacy 'name' field from ${legacyCount} documents`);
  }

  console.log(`\nDone. Updated: ${updated}, skipped (already slugs): ${skipped}, unmapped: ${unmapped}`);
  await client.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
