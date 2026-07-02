/**
 * MongoDB Script: Migrate allowed_tools empty arrays to boolean true
 *
 * Converts the legacy `allowed_tools: { "server-id": [] }` format to the new
 * canonical `allowed_tools: { "server-id": true }` format.
 *
 * This is a non-destructive migration — `[]` still works at runtime but logs
 * a deprecation warning. Running this script silences those warnings.
 *
 * Usage:
 *   mongosh mongodb://localhost:27017/caipe scripts/migrate_allowed_tools_boolean.js
 *
 * Or from mongosh:
 *   use caipe
 *   load('scripts/migrate_allowed_tools_boolean.js')
 */

db = db.getSiblingDB('caipe');

const collection = db.dynamic_agents;

print('🔍 Scanning dynamic_agents for allowed_tools with empty arrays...');

const agents = collection.find({ allowed_tools: { $exists: true } }).toArray();

let totalUpdated = 0;
let totalServersConverted = 0;

for (const agent of agents) {
  const allowedTools = agent.allowed_tools;
  if (!allowedTools || typeof allowedTools !== 'object') continue;

  const updates = {};
  let hasChanges = false;

  for (const [serverId, value] of Object.entries(allowedTools)) {
    if (Array.isArray(value) && value.length === 0) {
      updates[`allowed_tools.${serverId}`] = true;
      hasChanges = true;
      totalServersConverted++;
    }
  }

  if (hasChanges) {
    collection.updateOne({ _id: agent._id }, { $set: updates });
    print(`  ✓ ${agent.name || agent._id}: converted ${Object.keys(updates).length} server(s) to boolean true`);
    totalUpdated++;
  }
}

if (totalUpdated === 0) {
  print('✅ No migrations needed — all allowed_tools entries already use the new format.');
} else {
  print(`\n✅ Done! Updated ${totalUpdated} agent(s), converted ${totalServersConverted} server entry(ies) from [] to true.`);
}
