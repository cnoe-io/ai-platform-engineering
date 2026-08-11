import { ApiError } from "@/lib/api-error";

type TomeSession = {
  catalogKey?: string;
  principalType?: string;
};

/**
 * Project and Tome surfaces are human/RBAC surfaces. Catalog keys and local
 * skills tokens have a narrow catalog-read purpose and must never be promoted
 * into a Tome principal.
 */
export function requireInteractiveTomePrincipal(session: unknown): void {
  const auth = (session ?? {}) as TomeSession;
  if (
    auth.catalogKey ||
    auth.principalType === "catalog_api_key" ||
    auth.principalType === "skills_api_key"
  ) {
    throw new ApiError(
      "Scoped catalog credentials are not authorized for Tome",
      403,
      "TOME_INTERACTIVE_PRINCIPAL_REQUIRED",
    );
  }
}
