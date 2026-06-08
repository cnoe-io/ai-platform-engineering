// assisted-by Cursor Composer

import type { OnboardingStepState, ProjectDocument } from "@/types/projects";
import {
  getConfiguredStepOrder,
  loadProjectOnboardingConfig,
} from "@/lib/projects/onboarding-config";

export interface MockProvisionResult {
  mock_ref: string;
  integrations: Record<string, string>;
  status_message: string;
}

const STEP_DELAY_MS = 1200;

const MOCK_STATUS: Record<string, string> = {
  catalogue: "Registered project in Backstage catalogue with RBAC and attribution",
  wiki: "LLM Wiki space created and linked to project context",
  webex: "Collaboration space provisioned and team invited",
  pam: "Meeting assistant connected for notes and follow-ups",
  agent_mesh: "AI teammate mesh provisioned and ready",
};

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function provisionMockStep(
  stepId: string,
  project: ProjectDocument,
  stepTitle?: string,
): Promise<MockProvisionResult> {
  await delay(STEP_DELAY_MS);
  const label = stepTitle ?? stepId;
  return {
    mock_ref: `${stepId}-${project.slug}-${Date.now()}`,
    integrations: {
      [`${stepId}_ref`]: `${stepId}-${project.slug}`,
      [`${stepId}_url`]: `https://example.outshift.io/${project.slug}/${stepId}`,
    },
    status_message:
      MOCK_STATUS[stepId] ?? `${label} provisioned successfully (mock)`,
  };
}

/**
 * Create the project in Outshift Context Graph (tiny-teams-with-tokens) on
 * onboarding. Posts as the project owner via the `x-caipe-user` identity hint
 * so the new project is owned by them and appears in their /apps/ttt list.
 */
async function provisionContextGraph(
  project: ProjectDocument,
  actorSubject?: string,
): Promise<MockProvisionResult> {
  const base =
    process.env.CONTEXT_GRAPH_BACKEND_URL ||
    "http://outshift-context-graph-backend:8765";
  // Use the same identity key the proxy forwards as x-caipe-user (the actor's
  // session subject); fall back to owner email only if unavailable.
  const owner = (actorSubject || project.owner_id || "").trim();
  const res = await fetch(`${base}/api/projects`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-caipe-user": owner,
      "x-caipe-roles": "user",
    },
    body: JSON.stringify({ name: project.name }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(
      `Context Graph create failed: ${res.status} ${text.slice(0, 200)}`,
    );
  }
  const created = (await res.json().catch(() => ({}))) as { id?: string };
  return {
    mock_ref: `context-graph-${created.id ?? project.slug}`,
    integrations: {
      context_graph_id: String(created.id ?? ""),
      context_graph_url: "/apps/ttt",
    },
    status_message: "Project created in Outshift Context Graph",
  };
}

export function getOnboardingStepOrder(): string[] {
  return getConfiguredStepOrder();
}

export async function runOnboardingStep(
  stepId: string,
  project: ProjectDocument,
  actorSubject?: string,
): Promise<MockProvisionResult> {
  const config = loadProjectOnboardingConfig();
  const step = config.steps.find((entry) => entry.id === stepId);
  if (!step) {
    throw new Error(`Unknown onboarding step: ${stepId}`);
  }

  if (step.provider === "mock") {
    return provisionMockStep(stepId, project, step.title);
  }

  if (step.provider === "context-graph") {
    return provisionContextGraph(project, actorSubject);
  }

  return {
    mock_ref: `skipped-${stepId}`,
    integrations: {},
    status_message: `${step.title} skipped (no provider configured)`,
  };
}

export function stepLabel(stepId: string): string {
  const config = loadProjectOnboardingConfig();
  return config.steps.find((step) => step.id === stepId)?.title ?? stepId;
}

export function isOnboardingComplete(
  onboarding: Record<string, OnboardingStepState>,
): boolean {
  const order = getOnboardingStepOrder();
  if (order.length === 0) {
    return true;
  }
  return order.every((stepId) => onboarding[stepId]?.status === "completed");
}
