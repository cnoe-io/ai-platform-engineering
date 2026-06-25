import { expect, type Page, type Route } from "@playwright/test";

type A2AEvent = Record<string, unknown>;

interface CapturedMessage {
  method: string;
  prompt: string;
}

interface MockOptions {
  savedUseCases?: Array<Record<string, unknown>>;
}

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "content-type, authorization, accept",
  "Access-Control-Allow-Methods": "GET,POST,PUT,OPTIONS",
};

const agentCard = {
  name: "CAIPE Supervisor",
  description: "Coordinates platform engineering agents for SRE workflows.",
  skills: [
    { id: "argocd", name: "ArgoCD", description: "GitOps deployment checks", tags: ["ArgoCD", "Kubernetes"] },
    { id: "github", name: "GitHub", description: "Repository and CI checks", tags: ["GitHub", "CI/CD"] },
    { id: "aws", name: "AWS", description: "Cloud infrastructure checks", tags: ["AWS", "EKS"] },
    { id: "pagerduty", name: "PagerDuty", description: "Incident and on-call checks", tags: ["PagerDuty", "Incidents"] },
    { id: "splunk", name: "Splunk", description: "Log search and alert checks", tags: ["Splunk", "Logs"] },
    { id: "webex", name: "Webex", description: "Team space updates", tags: ["Webex", "Collaboration"] },
  ],
};

const cannedResponses = [
  {
    match: /outshift|basic sre|sre triage|platform triage/i,
    sourceAgent: "supervisor",
    finalText:
      "# Outshift SRE Debug Summary\n\n- GitHub pull requests and workflow checks were reviewed.\n- ArgoCD applications are synced.\n- AWS health, PagerDuty incidents, and Splunk errors are within expected bounds.",
    toolStart: "Coordinating Outshift SRE triage across platform integrations...",
    toolEnd: "Outshift SRE triage completed",
  },
  {
    match: /@webex\b|webex|team space|notify/i,
    sourceAgent: "webex",
    finalText: "# Webex Update\n\nPosted the incident summary to the team space and included current owner, impact, and next update time.",
    toolStart: "Preparing Webex team space update...",
    toolEnd: "Webex team space updated",
  },
  {
    match: /@pagerduty\b|pagerduty|on-call|oncall|incident/i,
    sourceAgent: "pagerduty",
    finalText: "# PagerDuty Incident Summary\n\n- Active incidents: 1 P2 incident under investigation.\n- Current on-call: Platform SRE primary.\n- No escalation policy gaps detected.",
    toolStart: "Looking up PagerDuty incidents and schedules...",
    toolEnd: "PagerDuty incident data retrieved",
  },
  {
    match: /@splunk\b|splunk|log|logs|error|errors/i,
    sourceAgent: "splunk",
    finalText: "# Splunk Log Search\n\n- Searched the last 60 minutes for 5xx errors.\n- Error rate is within baseline.\n- No new critical alert signatures were found.",
    toolStart: "Searching Splunk logs for recent errors...",
    toolEnd: "Splunk search completed",
  },
  {
    match: /@github\b|github|pull request|pr\b|repo|workflow/i,
    sourceAgent: "github",
    finalText: "# GitHub Debug Summary\n\n- Open pull requests reviewed.\n- CI status is green for the platform engineering repositories.\n- No blocking review comments were found.",
    toolStart: "Checking GitHub pull requests and workflow status...",
    toolEnd: "GitHub repository status retrieved",
  },
  {
    match: /@aws\b|aws|eks|ec2|cloud|cost/i,
    sourceAgent: "aws",
    finalText: "# AWS Debug Summary\n\n- EKS control plane is healthy.\n- No critical CloudWatch alarms are active.\n- Top service cost anomaly: none detected.",
    toolStart: "Inspecting AWS account health and EKS signals...",
    toolEnd: "AWS account health retrieved",
  },
  {
    match: /@argocd\b|argocd|deploy|deployment/i,
    sourceAgent: "argocd",
    finalText: "The ArgoCD version is **v2.12.3**.\n\nApplications are synced and no degraded workloads were found.",
    toolStart: "Fetching ArgoCD application and version details...",
    toolEnd: "ArgoCD health details retrieved",
  },
];

export async function installCaipeMocks(page: Page, options: MockOptions = {}) {
  const capturedMessages: CapturedMessage[] = [];
  let savedUseCases = options.savedUseCases ?? [];

  await page.route("**/api/usecases**", async (route) => {
    const request = route.request();

    if (request.method() === "GET") {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(savedUseCases),
      });
      return;
    }

    if (request.method() === "POST" || request.method() === "PUT") {
      const data = request.postDataJSON() as Record<string, unknown>;
      const saved = {
        id: `mock-usecase-${savedUseCases.length + 1}`,
        ...data,
        createdAt: new Date("2026-06-24T12:00:00.000Z").toISOString(),
      };
      savedUseCases = [...savedUseCases, saved];

      await route.fulfill({
        status: request.method() === "POST" ? 201 : 200,
        contentType: "application/json",
        body: JSON.stringify({ success: true, id: saved.id }),
      });
      return;
    }

    await route.continue();
  });

  await page.route(/https?:\/\/(localhost|127\.0\.0\.1):8000\/.*/, async (route) => {
    await handleA2ARoute(route, capturedMessages);
  });

  return {
    capturedMessages,
    lastPrompt: () => capturedMessages.at(-1)?.prompt ?? "",
  };
}

export async function expectAppReady(page: Page) {
  await expect(page.getByRole("link", { name: /use cases/i })).toBeVisible();
  await expect(page.getByText(/Connected|Checking|Disconnected/).first()).toBeVisible();
}

function handleA2ARoute(route: Route, capturedMessages: CapturedMessage[]) {
  const request = route.request();
  const url = request.url();

  if (request.method() === "OPTIONS") {
    return route.fulfill({ status: 204, headers: corsHeaders });
  }

  if (url.endsWith("/.well-known/agent.json")) {
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      headers: corsHeaders,
      body: JSON.stringify(agentCard),
    });
  }

  if (request.method() !== "POST") {
    return route.fulfill({ status: 404, headers: corsHeaders, body: "Not found" });
  }

  const body = request.postDataJSON() as { id?: number; method?: string; params?: any };
  const prompt = extractPrompt(body);
  capturedMessages.push({ method: body.method ?? "", prompt });

  if (body.method !== "message/stream") {
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      headers: corsHeaders,
      body: JSON.stringify({ jsonrpc: "2.0", id: body.id, result: {} }),
    });
  }

  return route.fulfill({
    status: 200,
    contentType: "text/event-stream",
    headers: {
      ...corsHeaders,
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
    body: toSse(body.id ?? 1, eventsForPrompt(prompt)),
  });
}

function extractPrompt(body: { params?: any }) {
  const parts = body.params?.message?.parts;
  if (!Array.isArray(parts)) return "";

  return parts
    .filter((part) => part?.kind === "text")
    .map((part) => String(part.text ?? ""))
    .join("\n");
}

function eventsForPrompt(prompt: string): A2AEvent[] {
  const scenario = cannedResponses.find((item) => item.match.test(prompt)) ?? cannedResponses[0];
  return buildFinalResultEvents(scenario);
}

function buildFinalResultEvents({
  sourceAgent,
  finalText,
  toolStart,
  toolEnd,
}: {
  sourceAgent: string;
  finalText: string;
  toolStart: string;
  toolEnd: string;
}): A2AEvent[] {
  const contextId = `context-${sourceAgent}`;
  const taskId = `task-${sourceAgent}`;

  return [
    {
      kind: "task",
      id: taskId,
      contextId,
      status: { state: "working" },
      artifacts: [],
    },
    artifactUpdate(taskId, contextId, "tool_notification_start", toolStart, sourceAgent, false),
    artifactUpdate(taskId, contextId, "tool_notification_end", toolEnd, sourceAgent, false),
    artifactUpdate(taskId, contextId, "streaming_result", finalText.slice(0, Math.ceil(finalText.length / 2)), "supervisor", false),
    artifactUpdate(taskId, contextId, "streaming_result", finalText.slice(Math.ceil(finalText.length / 2)), "supervisor", true),
    artifactUpdate(taskId, contextId, "final_result", finalText, "supervisor", false),
    {
      kind: "status-update",
      taskId,
      contextId,
      status: { state: "completed" },
      final: true,
    },
  ];
}

function artifactUpdate(
  taskId: string,
  contextId: string,
  name: string,
  text: string,
  sourceAgent: string,
  append: boolean,
) {
  return {
    kind: "artifact-update",
    taskId,
    contextId,
    artifact: {
      name,
      parts: [{ kind: "text", text }],
      metadata: { sourceAgent },
    },
    append,
  };
}

function toSse(id: number, events: A2AEvent[]) {
  return events
    .map((event) => `data: ${JSON.stringify({ jsonrpc: "2.0", id, result: event })}\n\n`)
    .join("");
}
