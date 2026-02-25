/**
 * Test fixture generators for conversation and message data.
 *
 * Inspired by the MongoDB seed scripts (scripts/seed-*-conversation.js),
 * these produce realistic in-memory conversation objects at various sizes
 * for unit testing spinner, scroll, grouping, and rendering behavior.
 */

const TOPICS = [
  "ArgoCD applications", "Kubernetes pods", "Jira sprint backlog",
  "GitHub pull requests", "PagerDuty incidents", "Splunk error logs",
  "AWS EC2 fleet", "S3 bucket audit", "RDS database metrics",
  "Helm release inventory", "Istio service mesh", "Network policies",
  "RBAC role bindings", "HPA autoscalers", "PVC disk utilization",
  "CronJob execution history", "SSL certificate inventory",
  "Terraform state drift", "Docker container health", "MCP server diagnostics",
];

const USER_QUESTIONS = [
  (t: string) => `Can you check the status of ${t} and provide a detailed breakdown?`,
  (t: string) => `Show me a comprehensive report on ${t} across all environments.`,
  (t: string) => `I need to investigate ${t} - can you pull the latest data?`,
  (t: string) => `What is the current state of ${t}? Include metrics and anomalies.`,
  (t: string) => `Give me an analysis of ${t} with recommendations.`,
];

function generateTable(rows: number): string {
  let t = "| # | Resource | Status | Namespace | CPU | Memory |\n";
  t += "|---|---|---|---|---|---|\n";
  for (let r = 0; r < rows; r++) {
    const s = r % 7 === 0 ? "Degraded" : "Running";
    t += `| ${r + 1} | svc-${String(r).padStart(3, "0")} | ${s} | ns-${r % 8} | ${(0.1 + Math.random() * 2).toFixed(1)} | ${Math.floor(128 + Math.random() * 2048)}Mi |\n`;
  }
  return t;
}

function generateAssistantContent(topic: string, turnIndex: number, size: "small" | "medium" | "large"): string {
  let c = `## ${topic} — Analysis (Turn ${turnIndex + 1})\n\n`;
  c += `### Summary\n- Total items: ${Math.floor(50 + Math.random() * 500)}\n`;
  c += `- Healthy: ${Math.floor(40 + Math.random() * 400)}\n`;
  c += `- Critical: ${Math.floor(1 + Math.random() * 10)}\n\n`;

  const tableRows = size === "large" ? 40 : size === "medium" ? 15 : 5;
  c += `### Breakdown\n\n${generateTable(tableRows)}\n`;

  if (size !== "small") {
    c += `### Recommendations\n\n`;
    const recCount = size === "large" ? 8 : 4;
    for (let r = 1; r <= recCount; r++) {
      c += `${r}. **${r <= 2 ? "Critical" : "Medium"}**: Address item-${r} in namespace ns-${r % 8}.\n`;
    }
  }

  return c;
}

export interface FixtureMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  timestamp?: Date;
  events?: any[];
  turnId?: string;
  isFinal?: boolean;
}

export interface FixtureConversation {
  id: string;
  title: string;
  createdAt: Date;
  updatedAt: Date;
  messages: FixtureMessage[];
  a2aEvents: any[];
}

/**
 * Generate a conversation with the specified number of turns.
 * Each turn = 1 user message + 1 assistant message.
 *
 * @param numTurns Number of question-answer turns
 * @param options.messageSize Controls assistant message content size
 * @param options.uuid Custom UUID (auto-generated if omitted)
 * @param options.title Custom title
 */
export function generateConversation(
  numTurns: number,
  options: {
    messageSize?: "small" | "medium" | "large";
    uuid?: string;
    title?: string;
  } = {}
): FixtureConversation {
  const {
    messageSize = "small",
    uuid = `fixture-${numTurns}-${Date.now()}`,
    title = `Test Conversation (${numTurns} turns)`,
  } = options;

  const now = new Date();
  const baseTime = new Date(now.getTime() - numTurns * 2 * 60 * 1000);
  const messages: FixtureMessage[] = [];

  for (let i = 0; i < numTurns; i++) {
    const topic = TOPICS[i % TOPICS.length];
    const turnId = `turn-${String(i + 1).padStart(4, "0")}`;
    const userTime = new Date(baseTime.getTime() + i * 2 * 60 * 1000);
    const assistantTime = new Date(userTime.getTime() + 30 * 1000);

    messages.push({
      id: `msg-user-${i + 1}`,
      role: "user",
      content: USER_QUESTIONS[i % USER_QUESTIONS.length](topic),
      timestamp: userTime,
      events: [],
      turnId,
      isFinal: true,
    });

    messages.push({
      id: `msg-asst-${i + 1}`,
      role: "assistant",
      content: generateAssistantContent(topic, i, messageSize),
      timestamp: assistantTime,
      events: [],
      turnId,
      isFinal: true,
    });
  }

  return {
    id: uuid,
    title,
    createdAt: baseTime,
    updatedAt: now,
    messages,
    a2aEvents: [],
  };
}

/**
 * Generate just the messages array (without conversation wrapper).
 * Useful for tests that only need to populate store messages.
 */
export function generateMessages(
  numTurns: number,
  size: "small" | "medium" | "large" = "small"
): FixtureMessage[] {
  return generateConversation(numTurns, { messageSize: size }).messages;
}
