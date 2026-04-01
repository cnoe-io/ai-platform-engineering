/**
 * Backfill web feedback from messages.feedback -> feedback collection,
 * then remove the embedded feedback field from messages.
 *
 * One-time script. Run via mongosh:
 *   mongosh "$MONGODB_URI" --eval "var dbName='caipe'" backfill_web_feedback.js
 *
 * Idempotent: uses $merge with whenMatched: "keepExisting" so re-runs
 * won't overwrite existing documents.
 *
 * After migration, the feedback collection is the sole source of truth.
 * The embedded messages.feedback field is removed (no backwards compat).
 */

// Allow overriding database name
const targetDb = typeof dbName !== "undefined" ? dbName : "caipe";
const database = db.getSiblingDB(targetDb);

print(`Backfilling web feedback from ${targetDb}.messages -> ${targetDb}.feedback ...`);

const result = database.messages.aggregate([
  { $match: { "feedback.rating": { $exists: true } } },
  {
    $project: {
      trace_id: { $literal: null },
      source: { $literal: "web" },
      rating: "$feedback.rating",
      value: {
        $cond: [
          { $eq: ["$feedback.rating", "positive"] },
          "thumbs_up",
          "thumbs_down",
        ],
      },
      comment: { $ifNull: ["$feedback.comment", null] },
      user_email: {
        $ifNull: ["$feedback.submitted_by", "$owner_id"],
      },
      user_id: { $literal: null },
      message_id: { $toString: "$_id" },
      conversation_id: "$conversation_id",
      channel_id: { $literal: null },
      channel_name: { $literal: null },
      thread_ts: { $literal: null },
      slack_permalink: { $literal: null },
      created_at: {
        $ifNull: ["$feedback.submitted_at", "$created_at"],
      },
    },
  },
  {
    $merge: {
      into: "feedback",
      whenMatched: "keepExisting",
    },
  },
]);

// Force aggregation to execute (toArray drains the cursor)
result.toArray();

const count = database.feedback.countDocuments({ source: "web" });
print(`Done. ${count} web feedback documents now in feedback collection.`);

// Remove the embedded feedback field from messages — feedback collection is now the source of truth
const unsetResult = database.messages.updateMany(
  { "feedback.rating": { $exists: true } },
  { $unset: { feedback: "" } }
);
print(`Removed embedded feedback from ${unsetResult.modifiedCount} messages.`);

// Tag existing conversations and users as source: "web" for tidiness
// (Slack entries will have source: "slack" set by the Slack bot / backfill)
const convResult = database.conversations.updateMany(
  { source: { $exists: false } },
  { $set: { source: "web" } }
);
print(`Tagged ${convResult.modifiedCount} existing conversations as source: "web".`);

const userResult = database.users.updateMany(
  { source: { $exists: false } },
  { $set: { source: "web" } }
);
print(`Tagged ${userResult.modifiedCount} existing users as source: "web".`);
