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
 * Normalized, product-agnostic view of a project that onboarding `http` steps
 * reference from their configured `body` template via `${project.<field>}`.
 * Derives a best-effort `repos` list from Backstage component annotations and
 * git-like integration URLs so the receiving system can seed sources.
 */
function buildProjectContext(project: ProjectDocument): Record<string, unknown> {
  const integrations = project.integrations ?? {};
  const components = (project.components ?? []) as Array<{
    metadata?: { annotations?: Record<string, string> };
  }>;
  const sources = project.sources ?? {};
  const repos = new Set<string>();
  for (const repo of sources.repos ?? []) {
    if (typeof repo === "string" && repo.trim()) repos.add(repo.trim());
  }
  for (const value of Object.values(integrations)) {
    if (typeof value === "string" && /(github|gitlab)\.com|\.git(\b|$)/.test(value)) {
      repos.add(value.replace(/^url:/, ""));
    }
  }
  for (const component of components) {
    const annotations = component?.metadata?.annotations ?? {};
    for (const [key, value] of Object.entries(annotations)) {
      if (
        typeof value === "string" &&
        /source-location|(github|gitlab)\.com/i.test(`${key} ${value}`)
      ) {
        repos.add(value.replace(/^url:/, ""));
      }
    }
  }
  return {
    name: project.name,
    slug: project.slug,
    title: project.title,
    description: project.description,
    domain: project.domain,
    owner: project.owner_id,
    members: project.member_ids ?? [],
    tags: project.tags ?? [],
    labels: project.labels ?? {},
    integrations,
    components,
    repos: Array.from(repos),
    confluence_url: sources.confluence_url ?? "",
    component_urls: sources.component_urls ?? [],
  };
}

function resolveProjectPath(ctx: Record<string, unknown>, path: string): unknown {
  return path
    .split(".")
    .reduce<unknown>(
      (acc, key) =>
        acc && typeof acc === "object"
          ? (acc as Record<string, unknown>)[key]
          : undefined,
      ctx,
    );
}

/**
 * Render a configured `body` template against the project context. A value that
 * is exactly `${project.<path>}` resolves to the real typed value (array/object
 * preserved); strings with embedded `${project.<path>}` interpolate to text.
 */
function renderBodyTemplate(value: unknown, ctx: Record<string, unknown>): unknown {
  if (typeof value === "string") {
    const exact = value.match(/^\$\{project\.([a-zA-Z0-9_.]+)\}$/);
    if (exact) return resolveProjectPath(ctx, exact[1]) ?? null;
    return value.replace(/\$\{project\.([a-zA-Z0-9_.]+)\}/g, (_m, path) => {
      const resolved = resolveProjectPath(ctx, path);
      if (resolved == null) return "";
      return typeof resolved === "string" ? resolved : JSON.stringify(resolved);
    });
  }
  if (Array.isArray(value)) return value.map((item) => renderBodyTemplate(item, ctx));
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([k, v]) => [
        k,
        renderBodyTemplate(v, ctx),
      ]),
    );
  }
  return value;
}

/**
 * Generic HTTP onboarding provider.
 *
 * POSTs the project to an external system at the step-configured `endpoint`,
 * forwarding the CAIPE-authenticated actor identity via `x-caipe-user` /
 * `x-caipe-roles`. The request body is the step's configured `body` template
 * rendered against the project (default `{ name, slug }`), so a deployment can
 * pass full project metadata — description, repos, labels, integrations —
 * without any product specifics living in this repo.
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
  // Render the configured body template against the project (default name+slug).
  const ctx = buildProjectContext(project);
  const payload =
    step.body && typeof step.body === "object"
      ? renderBodyTemplate(step.body, ctx)
      : { name: ctx.name, slug: ctx.slug };
  const res = await fetch(endpoint, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-caipe-user": actor,
      "x-caipe-roles": "user",
    },
    body: JSON.stringify(payload),
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
    // Display label for the app tile comes from the step's configured title, so
    // the deployment controls the name (no product label hardcoded in code).
    [`${step.id}_label`]: step.title,
  };
  if (step.appUrl) {
    // `${ENV_VAR}` from env, plus `${id}` = the id returned by the create call,
    // so an appUrl can deep-link to the new resource (e.g. an embed shell with
    // `?to=/projects/${id}`).
    integrations[`${step.id}_url`] = interpolateEnv(step.appUrl).replace(
      /\$\{id\}/g,
      String(created.id ?? ""),
    );
  }
  return {
    mock_ref: `${step.id}-${created.id ?? project.slug}`,
    integrations,
    status_message: `${step.title} provisioned`,
  };
}

/**
 * Link provider: no backend call — just records an app-tile deep link for a
 * first-party/in-process app (e.g. Agentic SDLC at `/apps/agentic-sdlc`). The
 * label comes from the step title; the URL from `appUrl` (`${ENV_VAR}` allowed).
 */
function provisionLink(
  step: ProjectOnboardingStepConfig,
  project: ProjectDocument,
): ProvisionResult {
  const integrations: Record<string, string> = {
    [`${step.id}_label`]: step.title,
  };
  if (step.appUrl) {
    integrations[`${step.id}_url`] = interpolateEnv(step.appUrl);
  }
  return {
    mock_ref: `link-${step.id}-${project.slug}`,
    integrations,
    status_message: `${step.title} linked`,
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

  if (step.provider === "link") {
    return provisionLink(step, project);
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
