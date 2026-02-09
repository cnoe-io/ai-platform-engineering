/**
 * PublicEnvScript - Server Component that injects runtime environment variables
 *
 * TWO-LAYER env injection strategy for Docker/K8s deployments:
 *
 * Layer 1 (PRIMARY): entrypoint.sh generates /app/public/env-config.js at
 *   container start, loaded via <script src="/env-config.js"> in layout.tsx.
 *   This is synchronous, guaranteed, and works regardless of SSR mode.
 *
 * Layer 2 (SECONDARY): This Server Component reads process.env at REQUEST TIME
 *   and merges any additional NEXT_PUBLIC_* values into window.__RUNTIME_ENV__.
 *   Uses headers() to force dynamic rendering (prevents build-time caching).
 *
 * The merge approach ensures both layers cooperate:
 * - env-config.js sets the base values (always correct, from container env)
 * - PublicEnvScript adds/overwrites if process.env has fresher values
 *
 * Adding a new NEXT_PUBLIC_* variable? Just set it in your environment.
 * Both layers auto-discover all NEXT_PUBLIC_* variables.
 */

import { headers } from 'next/headers';

/**
 * Collect all NEXT_PUBLIC_* environment variables from process.env.
 * Runs server-side at request time (forced by headers() call).
 */
function getPublicEnv(): Record<string, string> {
  const publicEnv: Record<string, string> = {};

  for (const [key, value] of Object.entries(process.env)) {
    if (key.startsWith('NEXT_PUBLIC_') && value !== undefined) {
      publicEnv[key] = value;
    }
  }

  return publicEnv;
}

/**
 * Server Component that renders an inline script injecting runtime env vars.
 *
 * Uses headers() to OPT INTO DYNAMIC RENDERING -- this ensures process.env
 * is read at request time, not build time (critical for Docker/K8s where
 * env vars are set at container runtime, not during `npm run build`).
 *
 * The script merges with any existing window.__RUNTIME_ENV__ (set by
 * env-config.js from entrypoint.sh) using Object.assign.
 */
export async function PublicEnvScript() {
  // Force dynamic rendering: headers() is a dynamic API that opts out of
  // static pre-rendering. Without this, the component executes at BUILD TIME
  // when NEXT_PUBLIC_* vars are not yet available.
  await headers();

  const publicEnv = getPublicEnv();

  // Merge with existing __RUNTIME_ENV__ (from env-config.js) rather than
  // overwriting. Object.assign(target, source) -- source values win on conflict,
  // which is correct since process.env at request time is the freshest source.
  return (
    <script
      dangerouslySetInnerHTML={{
        __html: `window.__RUNTIME_ENV__=Object.assign(window.__RUNTIME_ENV__||{},${JSON.stringify(publicEnv)});`,
      }}
    />
  );
}

/**
 * Helper for server-side code to access public env vars.
 * On the server, this reads process.env directly (runtime).
 * Not needed for client-side code -- use getRuntimeEnv() from config.ts instead.
 */
export { getPublicEnv };
