// Run with: mongosh <connection-string> scripts/migrate-swimlanes-to-areas.js
db.projects.updateMany(
  { "labels.swimlanes": { $exists: true } },
  [{ $set: { "labels.areas": "$labels.swimlanes" } }, { $unset: "labels.swimlanes" }]
);
print("Migration complete: labels.swimlanes → labels.areas");
