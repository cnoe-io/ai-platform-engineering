import { createCredentialError } from "@/lib/credentials/errors";

export type CredentialCallerType =
  | "agentgateway"
  | "credential_exchange"
  | "dynamic_agent"
  | "internal_service"
  | "mcp_runtime";

export interface CredentialCallerContext {
  callerType: CredentialCallerType;
  audience: string;
  browserAccessible: false;
}

export interface CredentialCallerGuardInput {
  headers: Headers;
  expectedAudience: string;
}

const CREDENTIAL_CALLER_HEADER = "x-caipe-credential-caller";
const CREDENTIAL_AUDIENCE_HEADER = "x-caipe-credential-audience";

const ALLOWED_CALLER_TYPES = new Set<string>([
  "agentgateway",
  "credential_exchange",
  "dynamic_agent",
  "internal_service",
  "mcp_runtime",
]);

export function classifyCredentialRequest(headers: Headers): { browserAccessible: boolean } {
  const fetchSite = headers.get("sec-fetch-site");
  const hasBrowserOrigin = Boolean(headers.get("origin") || headers.get("referer"));
  const hasBrowserFetchMetadata = Boolean(fetchSite || headers.get("sec-fetch-mode"));
  const hasSessionCookie = Boolean(headers.get("cookie"));

  return {
    browserAccessible: hasBrowserOrigin || hasBrowserFetchMetadata || hasSessionCookie,
  };
}

function readCredentialCallerType(headers: Headers): CredentialCallerType {
  const callerType = headers.get(CREDENTIAL_CALLER_HEADER)?.trim();

  if (!callerType || !ALLOWED_CALLER_TYPES.has(callerType)) {
    throw createCredentialError({
      reasonCode: "invalid_caller",
      message: "Credential service caller is not allowed",
      status: 403,
    });
  }

  return callerType as CredentialCallerType;
}

export function assertCredentialServiceCaller(
  input: CredentialCallerGuardInput,
): CredentialCallerContext {
  if (classifyCredentialRequest(input.headers).browserAccessible) {
    throw createCredentialError({
      reasonCode: "browser_request_denied",
      message: "Browser clients cannot retrieve credential material",
      status: 403,
    });
  }

  if (!input.headers.get("authorization")?.startsWith("Bearer ")) {
    throw createCredentialError({
      reasonCode: "missing_jwt",
      message: "Credential service calls require a bearer token",
      status: 401,
    });
  }

  const audience = input.headers.get(CREDENTIAL_AUDIENCE_HEADER)?.trim();
  if (audience !== input.expectedAudience) {
    throw createCredentialError({
      reasonCode: "wrong_audience",
      message: "Credential service audience mismatch",
      status: 403,
    });
  }

  return {
    callerType: readCredentialCallerType(input.headers),
    audience,
    browserAccessible: false,
  };
}
