/**
 * Server-runtime-free home for `ApiError`.
 *
 * `@/lib/api-middleware` imports `next/server`, which references the
 * global `Request` constructor at module load time. That isn't defined
 * in jsdom test environments, so any module imported into a client
 * component (and any test that renders such a component) used to fail
 * to load if it transitively pulled `ApiError` in via the middleware
 * file.
 *
 * Extracting the class to this leaf module breaks the chain: shared
 * helpers like `app/api/skill-hubs/_lib/normalize.ts` (used by both
 * server route handlers and the admin form) can import `ApiError`
 * here without dragging the Next.js server runtime into the client
 * bundle / test env.
 *
 * `@/lib/api-middleware` continues to re-export `ApiError` from this
 * file so existing route-handler imports (`import { ApiError } from
 * "@/lib/api-middleware"`) keep working unchanged.
 */
export class ApiError extends Error {
  constructor(
    message: string,
    public statusCode: number = 500,
    public code?: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}
