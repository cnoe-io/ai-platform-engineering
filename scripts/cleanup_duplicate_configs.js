/**
 * MongoDB Script: Remove Duplicate Agent Configs
 * 
 * This script finds and removes duplicate agent configs based on the `id` field,
 * keeping only the most recently updated version of each config.
 * 
 * Usage:
 *   mongosh mongodb://localhost:27017/caipe scripts/cleanup_duplicate_configs.js
 * 
 * Or from mongosh:
 *   use caipe
 *   load('scripts/cleanup_duplicate_configs.js')
 */

db = db.getSiblingDB('caipe');

print('🔍 Finding duplicate agent configs...');

// Aggregate to find duplicate IDs
const duplicates = db.agent_skills.aggregate([
  {
    $group: {
      _id: '$id',
      count: { $sum: 1 },
      docs: { $push: { _id: '$_id', updated_at: '$updated_at', name: '$name' } }
    }
  },
  {
    $match: {
      count: { $gt: 1 }
    }
  }
]).toArray();

if (duplicates.length === 0) {
  print('✅ No duplicates found!');
} else {
  print(`⚠️  Found ${duplicates.length} duplicate config IDs:`);
  
  let totalDeleted = 0;
  
  duplicates.forEach(dup => {
    print(`\n📝 Config ID: ${dup._id} (${dup.count} copies)`);
    
    // Sort by updated_at descending, keep the most recent
    const sortedDocs = dup.docs.sort((a, b) => {
      const dateA = a.updated_at ? new Date(a.updated_at) : new Date(0);
      const dateB = b.updated_at ? new Date(b.updated_at) : new Date(0);
      return dateB - dateB;
    });
    
    // Keep the first (most recent), delete the rest
    const toKeep = sortedDocs[0];
    const toDelete = sortedDocs.slice(1);
    
    print(`   ✅ Keeping: ${toKeep.name || 'unnamed'} (${toKeep._id})`);
    
    toDelete.forEach(doc => {
      print(`   🗑️  Deleting: ${doc.name || 'unnamed'} (${doc._id})`);
      db.agent_skills.deleteOne({ _id: doc._id });
      totalDeleted++;
    });
  });
  
  print(`\n✅ Cleanup complete! Deleted ${totalDeleted} duplicate entries.`);
  print(`📊 Remaining configs: ${db.agent_skills.countDocuments()}`);
}

// Verify unique index exists
print('\n🔍 Checking for unique index on id field...');
const indexes = db.agent_skills.getIndexes();
const hasUniqueIndex = indexes.some(idx => 
  idx.key && idx.key.id === 1 && idx.unique === true
);

if (hasUniqueIndex) {
  print('✅ Unique index on "id" field already exists');
} else {
  print('⚠️  Creating unique index on "id" field...');
  try {
    db.agent_skills.createIndex({ id: 1 }, { unique: true });
    print('✅ Unique index created successfully');
  } catch (error) {
    print(`❌ Failed to create unique index: ${error.message}`);
    print('   You may need to remove remaining duplicates first');
  }
}

print('\n✅ Done!');
