// assisted-by claude code claude-opus-4-8

import type { OnboardingStepState, ProjectDocument } from "@/types/projects";
import {
  getConfiguredStepOrder,
  loadProjectOnboardingConfig,
  type ProjectOnboardingStepConfig,
} from "@/lib/projects/onboarding-config";

export interface ProvisionResult {
  mock_ref: string;
  integrations: Record<string, string>;
  status_message: string;
}

/** @deprecated kept for backwards compatibility; use {@link ProvisionResult}. */
export type MockProvisionResult = ProvisionResult;

const STEP_DELAY_MS = 1200;

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function provisionMockStep(
  stepId: string,
  project: ProjectDocument,
  stepTitle?: string,
): Promise<ProvisionResult> {
  await delay(STEP_DELAY_MS);
  const label = stepTitle ?? stepId;
  return {
    mock_ref: `${stepId}-${project.slug}-${Date.now()}`,
    integrations: {
      [`${stepId}_ref`]: `${stepId}-${project.slug}`,
      [`${stepId}_url`]: `https://example.com/${project.slug}/${stepId}`,
    },
    status_message: `${label} provisioned successfully (mock)`,
  };
}

/**
 * Interpolate `${ENV_VAR}` references in a config string from the process
 * environment. Lets deployment config keep hostnames/endpoints out of the
 * repo, e.g. `endpoint: "${MY_BACKEND_URL}/api/projects"`.
 */
function interpolateEnv(value: string): string {
  return value.replace(/\$\{([A-Z0-9_]+)\}/g, (_m, name) => process.env[name] ?? "");
}

/**
 * Generic HTTP onboarding provider.
 *
 * POSTs the project to an external system at the step-configured `endpoint`,
 * forwarding the CAIPE-authenticated actor identity via `x-caipe-user` /
 * `x-caipe-roles` so the remote resource is owned by the real user. The target
 * system, endpoint, and resulting deep-link (`appUrl`) all come from
 * deployment config — nothing about any specific external product lives here.
 */
async function provisionViaHttp(
  step: ProjectOnboardingStepConfig,
  project: ProjectDocument,
  actorSubject?: string,
): Promise<ProvisionResult> {
  const rawEndpoint = (step.endpoint ?? "").trim();
  if (!rawEndpoint) {
    throw new Error(
      `Onboarding step "${step.id}" uses provider "http" but has no endpoint configured`,
    );
  }
  const endpoint = interpolateEnv(rawEndpoint);
  if (!/^https?:\/\//.test(endpoint)) {
    throw new Error(
      `Onboarding step "${step.id}" endpoint did not resolve to an http(s) URL`,
    );
  }

  const actor = (actorSubject || project.owner_id || "").trim();
  const res = await fetch(endpoint, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-caipe-user": actor,
      "x-caipe-roles": "user",
    },
    body: JSON.stringify({ name: project.name, slug: project.slug }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(
      `${step.title} provisioning failed: ${res.status} ${text.slice(0, 200)}`,
    );
  }
  const created = (await res.json().catch(() => ({}))) as { id?: string };
  const integrations: Record<string, string> = {
    [`${step.id}_id`]: String(created.id ?? ""),
  };
  if (step.appUrl) {
    integrations[`${step.id}_url`] = interpolateEnv(step.appUrl);
  }
  return {
    mock_ref: `${step.id}-${created.id ?? project.slug}`,
    integrations,
    status_message: `${step.title} provisioned`,
  };
}

export function getOnboardingStepOrder(): string[] {
  return getConfiguredStepOrder();
}

export async function runOnboardingStep(
  stepId: string,
  project: ProjectDocument,
  actorSubject?: string,
): Promise<ProvisionResult> {
  const config = loadProjectOnboardingConfig();
  const step = config.steps.find((entry) => entry.id === stepId);
  if (!step) {
    throw new Error(`Unknown onboarding step: ${stepId}`);
  }

  if (step.provider === "mock") {
    return provisionMockStep(stepId, project, step.title);
  }

  if (step.provider === "http") {
    return provisionViaHttp(step, project, actorSubject);
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
