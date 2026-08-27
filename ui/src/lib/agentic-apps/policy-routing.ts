import type {
  AgenticAppManifest,
  AgenticAppPdpPolicyAction,
} from "@/types/agentic-app";

export function resolveAgenticAppHttpPolicyAction(
  manifest: AgenticAppManifest,
  method: string,
  path: string,
): AgenticAppPdpPolicyAction | undefined {
  const normalizedMethod = method.toUpperCase();
  const normalizedPath = normalizePath(path);
  const policies = manifest.access?.policyActions ?? [];
  const routePolicy = policies.find(
    (candidate) =>
      candidate.method === normalizedMethod &&
      typeof candidate.path === "string" &&
      routeMatches(candidate.path, normalizedPath),
  );
  if (routePolicy) return routePolicy;

  // Manifests without route selectors retain the v1 method-only contract.
  if (!policies.some((candidate) => candidate.method === normalizedMethod)) {
    return policies.find((candidate) => candidate.action === `proxy:${normalizedMethod}`);
  }
  return undefined;
}

export function findAgenticAppPolicyAction(
  manifest: AgenticAppManifest,
  action: string,
): AgenticAppPdpPolicyAction | undefined {
  return manifest.access?.policyActions?.find((candidate) => candidate.action === action);
}

function routeMatches(template: string, actual: string): boolean {
  const expectedSegments = normalizePath(template).split("/").filter(Boolean);
  const actualSegments = actual.split("/").filter(Boolean);
  if (expectedSegments.length !== actualSegments.length) return false;
  return expectedSegments.every(
    (segment, index) => segment.startsWith(":") || segment === actualSegments[index],
  );
}

function normalizePath(value: string): string {
  const withSlash = value.startsWith("/") ? value : `/${value}`;
  return withSlash.length > 1 ? withSlash.replace(/\/+$/, "") : withSlash;
}
