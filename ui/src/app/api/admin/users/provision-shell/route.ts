// POST /api/admin/users/provision-shell
//
// Canonical JIT "create-or-resolve a federated shell user" endpoint (issue
// #1781). Resolves an email to a Keycloak `sub`, provisioning a federated-only
// shell user (spec-103 shape) when none exists yet, so RBAC can be granted to
// people who have not logged into CAIPE.
//
// This is the single first-party surface bots use for JIT provisioning. The
// Slack bot (and any future bot, e.g. Webex) calls it with its own
// service-account token + `X-Client-Source`. The in-process Okta / IdP
// directory sync does NOT call this HTTP route — it shares the same
// `provisionShellUser` lib function directly (no self-network hop).

import { NextRequest } from "next/server";

import {
  ApiError,
  getAuthFromBearerOrSession,
  successResponse,
  withErrorHandler,
} from "@/lib/api-middleware";
import { provisionShellUser } from "@/lib/rbac/keycloak-admin";
import { requireResourcePermission } from "@/lib/rbac/resource-authz";

// Gate on the user-provisioning admin surface. The OpenFGA `admin_surface`
// type lists `service_account` as a valid `writer` subject, so the Slack bot's
// client-credentials caller (graphed as `service_account:<sub>`) can be granted
// `writer admin_surface:user_provisioning` by the realm init seed. Org admins
// pass via the bypass.
const PROVISIONING_SURFACE_ID = "user_provisioning";

// Conservative upper bound; a Keycloak username/email is realistically far
// shorter. Guards against absurd payloads before we touch Keycloak.
const MAX_EMAIL_LENGTH = 320;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseEmail(value: unknown): string {
  if (typeof value !== "string") {
    throw new ApiError("email is required and must be a string", 400, "INVALID_EMAIL");
  }
  const email = value.trim().toLowerCase();
  if (!email) {
    throw new ApiError("email must not be empty", 400, "INVALID_EMAIL");
  }
  if (email.length > MAX_EMAIL_LENGTH) {
    throw new ApiError("email is too long", 400, "INVALID_EMAIL");
  }
  // Loose shape check — Keycloak is the real validator. We only reject the
  // obviously-not-an-email so a typo cannot create a junk shell user.
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new ApiError("email is not a valid address", 400, "INVALID_EMAIL");
  }
  return email;
}

function parseSource(value: unknown): string {
  if (typeof value !== "string") {
    throw new ApiError("source is required and must be a string", 400, "INVALID_SOURCE");
  }
  const source = value.trim();
  if (!source) {
    throw new ApiError("source must not be empty", 400, "INVALID_SOURCE");
  }
  if (source.length > 128) {
    throw new ApiError("source is too long", 400, "INVALID_SOURCE");
  }
  return source;
}

function parseAttributes(value: unknown): Record<string, string[]> | undefined {
  if (value === undefined || value === null) return undefined;
  if (!isRecord(value)) {
    throw new ApiError("attributes must be an object of string arrays", 400, "INVALID_ATTRIBUTES");
  }
  const out: Record<string, string[]> = {};
  for (const [key, raw] of Object.entries(value)) {
    // `created_by` / `created_at` are owned by the server (audit provenance);
    // a caller must not be able to forge them via the attributes bag.
    if (key === "created_by" || key === "created_at") continue;
    if (!Array.isArray(raw) || !raw.every((v) => typeof v === "string")) {
      throw new ApiError(
        `attribute "${key}" must be an array of strings`,
        400,
        "INVALID_ATTRIBUTES"
      );
    }
    out[key] = raw;
  }
  return out;
}

export const POST = withErrorHandler(async (request: NextRequest) => {
  const { session } = await getAuthFromBearerOrSession(request);

  // First-party admin surface: the bot service account is granted
  // `writer admin_surface:user_provisioning`; org admins pass via the bypass.
  await requireResourcePermission(
    session,
    { type: "admin_surface", id: PROVISIONING_SURFACE_ID, action: "write" },
    { bypassForOrgAdmin: true }
  );

  const rawBody = await request.json().catch(() => null);
  if (!isRecord(rawBody)) {
    throw new ApiError("Request body must be a JSON object", 400, "INVALID_BODY");
  }

  const email = parseEmail(rawBody.email);
  const source = parseSource(rawBody.source);
  const attributes = parseAttributes(rawBody.attributes);

  const { sub, created } = await provisionShellUser({ email, source, attributes });
  return successResponse({ sub, created });
});
