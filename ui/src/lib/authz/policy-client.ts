import { ApiError } from "@/lib/api-error";

export interface PolicyExpression {
  template: "string_argument_in_v1";
  version: "1";
  field: string;
  values: string[];
}

export interface ExpressionPolicyInput {
  resource_type: "tool";
  resource_id: string;
  subject: { type: "user" | "service_account" | "team"; id: string };
  expression: PolicyExpression;
  input_schema_sha256: string;
  exclusive: boolean;
}

function baseUrl(): string {
  return (process.env.AUTHZ_SERVICE_URL ?? "http://caipe-authz:8090").replace(/\/+$/, "");
}

async function adminRequest(path: string, init: RequestInit = {}): Promise<unknown> {
  const token = process.env.AUTHZ_ADMIN_TOKEN?.trim();
  if (!token) throw new ApiError("caipe-authz admin token is not configured", 503);
  let response: Response;
  try {
    response = await fetch(`${baseUrl()}${path}`, {
      ...init,
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${token}`,
        ...(init.headers ?? {}),
      },
      signal: AbortSignal.timeout(Number(process.env.AUTHZ_ADMIN_TIMEOUT_MS ?? 3000)),
    });
  } catch (error) {
    throw new ApiError(
      `caipe-authz is unavailable: ${error instanceof Error ? error.message : String(error)}`,
      503,
    );
  }
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    const detail = (body as { detail?: unknown }).detail;
    throw new ApiError(
      typeof detail === "string" ? detail : "caipe-authz policy request failed",
      response.status,
    );
  }
  return body;
}

export function listExpressionPolicies(resourceType?: string, resourceId?: string): Promise<unknown> {
  const query = new URLSearchParams();
  if (resourceType) query.set("resource_type", resourceType);
  if (resourceId) query.set("resource_id", resourceId);
  const suffix = query.size ? `?${query}` : "";
  return adminRequest(`/v1/admin/policies${suffix}`);
}

export function validateExpressionPolicy(input: ExpressionPolicyInput): Promise<unknown> {
  return adminRequest("/v1/admin/policies:validate", { method: "POST", body: JSON.stringify(input) });
}

export function explainExpressionPolicy(input: ExpressionPolicyInput): Promise<unknown> {
  return adminRequest("/v1/admin/policies:explain", { method: "POST", body: JSON.stringify(input) });
}

export function putExpressionPolicy(
  policyId: string,
  version: number,
  input: ExpressionPolicyInput,
): Promise<unknown> {
  return adminRequest(`/v1/admin/policies/${encodeURIComponent(policyId)}`, {
    method: "PUT",
    headers: { "if-match": String(version) },
    body: JSON.stringify(input),
  });
}

export function deleteExpressionPolicy(policyId: string, version: number): Promise<unknown> {
  return adminRequest(`/v1/admin/policies/${encodeURIComponent(policyId)}`, {
    method: "DELETE",
    headers: { "if-match": String(version) },
  });
}

export function putPolicySchema(input: {
  resource_type: string;
  resource_id: string;
  schema_hash: string;
  schema: Record<string, unknown>;
  eligible_fields: Array<{ pointer: string; type: string; required: boolean }>;
}): Promise<unknown> {
  const resource = `${encodeURIComponent(input.resource_type)}/${input.resource_id.split("/").map(encodeURIComponent).join("/")}`;
  return adminRequest(`/v1/admin/schemas/${resource}`, { method: "PUT", body: JSON.stringify(input) });
}
