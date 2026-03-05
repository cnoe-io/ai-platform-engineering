#!/usr/bin/env node

/**
 * Seed script — inserts sample feedback on messages and NPS responses into MongoDB
 * so the admin Feedback and NPS tabs have data to display.
 *
 * Usage:
 *   node ui/scripts/seed-feedback-nps.mjs
 *   MONGODB_URI=mongodb://... MONGODB_DATABASE=caipe node ui/scripts/seed-feedback-nps.mjs
 */

import { MongoClient, ObjectId } from "mongodb";
import { randomUUID } from "crypto";

const uri = process.env.MONGODB_URI || "mongodb://admin:changeme@localhost:27017";
const dbName = process.env.MONGODB_DATABASE || "caipe";

const SAMPLE_USERS = [
  "alice@example.com",
  "bob@example.com",
  "carol@example.com",
  "dave@example.com",
  "eve@example.com",
  "frank@example.com",
  "grace@example.com",
];

const AGENTS = [
  "platform-engineer",
  "github-agent",
  "argocd-agent",
  "komodor-agent",
  "splunk-agent",
];

const POSITIVE_REASONS = ["Very Helpful", "Accurate", "Simplified My Task"];
const NEGATIVE_REASONS = ["Inaccurate", "Poorly Formatted", "Incomplete", "Off-topic"];

const SAMPLE_USER_MESSAGES = [
  "How do I deploy my app to Kubernetes?",
  "Show me the ArgoCD sync status for prod",
  "Create a GitHub PR to fix the login bug",
  "What's the CPU usage for the payments service?",
  "Investigate the 5xx errors in staging",
  "Help me write a Helm chart for Redis",
  "Why is my pod in CrashLoopBackOff?",
  "Set up a new GitHub repo with CI/CD",
  "Show me Splunk logs for the auth service",
  "How do I scale my deployment to 5 replicas?",
  "What Kubernetes events happened in the last hour?",
  "Help me debug this Terraform plan failure",
  "Can you summarize the recent incident?",
  "Update the ArgoCD application manifest",
  "List all open PRs in the platform repo",
];

const SAMPLE_ASSISTANT_MESSAGES = [
  "I've analyzed the deployment configuration. Here's what I recommend for your Kubernetes deployment...",
  "The ArgoCD sync status for production shows all applications are in sync. Here's the breakdown...",
  "I've created a pull request #142 to fix the login bug. The changes include input validation and session handling improvements...",
  "The payments service CPU usage over the last 24 hours shows an average of 45% with peaks at 78% during high traffic...",
  "I found 23 5xx errors in staging over the last hour. The root cause appears to be a database connection timeout...",
  "Here's a Helm chart for Redis with high availability configuration, persistent storage, and resource limits...",
  "Your pod is in CrashLoopBackOff because the health check endpoint /healthz is returning 503. The application logs show...",
  "I've created the repository `platform/new-service` with GitHub Actions CI/CD pipeline, branch protection rules...",
  "Here are the Splunk logs for the auth service. I noticed elevated latency starting at 14:23 UTC...",
  "I've scaled the deployment `payments-api` to 5 replicas. Current status shows 5/5 pods running...",
  "In the last hour, there were 12 Kubernetes events: 3 pod restarts, 2 HPA scaling events, and 7 normal events...",
  "The Terraform plan failed because the AWS provider version constraint conflicts with the required module version...",
  "Here's a summary of the recent incident: Duration 47 minutes, root cause was a misconfigured ingress rule...",
  "I've updated the ArgoCD application manifest with the new image tag and resource limits...",
  "There are 8 open PRs in the platform repo. Here's a summary sorted by age...",
];

const NPS_COMMENTS = [
  "Love the multi-agent approach — it saves me so much time!",
  "The ArgoCD integration is incredibly useful for our team.",
  "Sometimes the responses are slow, but accuracy is great.",
  "Would be nice to have better Terraform support.",
  "This has replaced half of my daily kubectl commands.",
  "The GitHub PR creation feature is a game changer.",
  "Needs better error messages when things fail.",
  "I use this every day — can't imagine working without it.",
  "The Splunk log analysis is decent but could be deeper.",
  "Great tool, but the NPS survey is a bit annoying ;)",
  "",
  "",
  "",
  "",
];

function pick(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

function daysAgo(n) {
  return new Date(Date.now() - n * 24 * 60 * 60 * 1000);
}

function hoursAgo(n) {
  return new Date(Date.now() - n * 60 * 60 * 1000);
}

async function seed() {
  console.log(`\nConnecting to MongoDB at ${uri.replace(/\/\/.*@/, "//***@")} (db: ${dbName})...\n`);

  const client = new MongoClient(uri);
  await client.connect();
  const db = client.db(dbName);

  const conversations = db.collection("conversations");
  const messages = db.collection("messages");
  const npsResponses = db.collection("nps_responses");
  const npsCampaigns = db.collection("nps_campaigns");

  // ─── Create sample conversations + messages with feedback ───────────

  const feedbackCount = 25;
  let insertedConvs = 0;
  let insertedMsgs = 0;
  let insertedFeedback = 0;

  console.log(`Creating ${feedbackCount} feedback entries across conversations...\n`);

  for (let i = 0; i < feedbackCount; i++) {
    const user = pick(SAMPLE_USERS);
    const agent = pick(AGENTS);
    const convId = randomUUID();
    const daysBack = Math.floor(Math.random() * 28) + 1;
    const createdAt = daysAgo(daysBack);
    const userMsgIdx = i % SAMPLE_USER_MESSAGES.length;
    const assistantMsgIdx = i % SAMPLE_ASSISTANT_MESSAGES.length;

    // Insert conversation
    await conversations.insertOne({
      _id: convId,
      title: SAMPLE_USER_MESSAGES[userMsgIdx].slice(0, 60),
      owner_id: user,
      created_at: createdAt,
      updated_at: createdAt,
      metadata: {
        agent_version: "1.0.0",
        model_used: pick(["gpt-4o", "claude-sonnet-4-20250514", "gpt-5-mini"]),
        total_messages: 2,
      },
      sharing: {
        is_public: false,
        shared_with: [],
        shared_with_teams: [],
        share_link_enabled: false,
      },
      tags: [],
      is_archived: false,
      is_pinned: false,
    });
    insertedConvs++;

    const turnId = `turn-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;

    // Insert user message
    await messages.insertOne({
      message_id: randomUUID(),
      conversation_id: convId,
      owner_id: user,
      role: "user",
      content: SAMPLE_USER_MESSAGES[userMsgIdx],
      created_at: createdAt,
      sender_email: user,
      metadata: { turn_id: turnId },
    });
    insertedMsgs++;

    // Insert assistant message WITH feedback
    const isPositive = Math.random() > 0.35; // ~65% positive
    const rating = isPositive ? "positive" : "negative";
    const reasons = isPositive ? POSITIVE_REASONS : NEGATIVE_REASONS;
    const reason = pick(reasons);
    const feedbackTime = new Date(createdAt.getTime() + 5 * 60 * 1000); // 5 min after

    await messages.insertOne({
      message_id: randomUUID(),
      conversation_id: convId,
      owner_id: user,
      role: "assistant",
      content: SAMPLE_ASSISTANT_MESSAGES[assistantMsgIdx],
      created_at: new Date(createdAt.getTime() + 3000),
      metadata: {
        turn_id: turnId,
        agent_name: agent,
        is_final: true,
        latency_ms: 1500 + Math.floor(Math.random() * 8000),
      },
      feedback: {
        rating,
        comment: reason,
        submitted_at: feedbackTime,
        submitted_by: user,
      },
    });
    insertedMsgs++;
    insertedFeedback++;
  }

  console.log(`  ✓ ${insertedConvs} conversations created`);
  console.log(`  ✓ ${insertedMsgs} messages created (${insertedFeedback} with feedback)`);

  // ─── Create NPS campaign ───────────────────────────────────────────

  console.log(`\nCreating NPS campaign...\n`);

  const campaignStart = daysAgo(14);
  const campaignEnd = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000);

  const campaignResult = await npsCampaigns.insertOne({
    name: "Q1 2026 NPS",
    starts_at: campaignStart,
    ends_at: campaignEnd,
    created_by: "admin@example.com",
    created_at: campaignStart,
  });

  const campaignId = campaignResult.insertedId.toString();
  console.log(`  ✓ Campaign "Q1 2026 NPS" created (${campaignId})`);
  console.log(`    Active: ${campaignStart.toISOString()} → ${campaignEnd.toISOString()}`);

  // ─── Create NPS responses (linked to campaign) ────────────────────

  const npsCount = 30;
  const npsEntries = [];

  console.log(`\nCreating ${npsCount} NPS responses...\n`);

  for (let i = 0; i < npsCount; i++) {
    const daysBack = Math.floor(Math.random() * 14) + 1;
    // Weighted score distribution: skew toward 7-10 for a realistic positive NPS
    let score;
    const rand = Math.random();
    if (rand < 0.15) score = Math.floor(Math.random() * 5);          // 0-4 (detractors)
    else if (rand < 0.30) score = 5 + Math.floor(Math.random() * 2); // 5-6 (detractors)
    else if (rand < 0.50) score = 7 + Math.floor(Math.random() * 2); // 7-8 (passives)
    else score = 9 + Math.floor(Math.random() * 2);                  // 9-10 (promoters)

    const comment = pick(NPS_COMMENTS);

    npsEntries.push({
      user_email: pick(SAMPLE_USERS),
      score,
      comment: comment || undefined,
      campaign_id: campaignId,
      created_at: daysAgo(daysBack),
    });
  }

  await npsResponses.insertMany(npsEntries);

  // Compute and display NPS summary
  const promoters = npsEntries.filter((r) => r.score >= 9).length;
  const passives = npsEntries.filter((r) => r.score >= 7 && r.score <= 8).length;
  const detractors = npsEntries.filter((r) => r.score <= 6).length;
  const npsScore = Math.round(((promoters - detractors) / npsCount) * 100);

  console.log(`  ✓ ${npsCount} NPS responses created (linked to campaign)`);
  console.log(`    Promoters (9-10): ${promoters}`);
  console.log(`    Passives  (7-8):  ${passives}`);
  console.log(`    Detractors (0-6): ${detractors}`);
  console.log(`    NPS Score:        ${npsScore > 0 ? "+" : ""}${npsScore}`);

  // ─── Summary ───────────────────────────────────────────────────────

  console.log(`\n${"═".repeat(55)}`);
  console.log(`  Seed complete!`);
  console.log(`  ${insertedConvs} conversations, ${insertedMsgs} messages, ${insertedFeedback} feedback`);
  console.log(`  1 NPS campaign, ${npsCount} NPS responses`);
  console.log(`${"═".repeat(55)}`);
  console.log(`\n  Open the admin dashboard → Feedback tab to view feedback`);
  console.log(`  Open the admin dashboard → NPS tab to view NPS score and campaigns\n`);

  await client.close();
}

seed().catch((err) => {
  console.error("Seed failed:", err);
  process.exit(1);
});
