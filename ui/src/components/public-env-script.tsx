/**
 * PublicEnvScript - Server Component that injects runtime environment variables
 *
 * This replaces the entrypoint.sh → env-config.js approach with a cleaner pattern:
 * - Runs as a React Server Component inside the root layout
 * - Reads process.env at REQUEST TIME (Node.js runtime, not build time)
 * - Auto-discovers ALL NEXT_PUBLIC_* variables (no manual listing needed)
 * - Injects them into window.__RUNTIME_ENV__ via an inline <script> tag
 *
 * Why this works:
 * Server Components execute in Node.js where process.env is read at runtime.
 * The rendered <script> tag is part of the SSR HTML, so it's available before
 * any client-side JavaScript runs -- equivalent to "beforeInteractive".
 *
 * Adding a new NEXT_PUBLIC_* variable? Just set it in your environment.
 * This component will automatically pick it up. No code changes needed.
 */

/**
 * Collect all NEXT_PUBLIC_* environment variables from process.env.
 * Runs server-side at request time -- values are always fresh.
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
 * Usage in app/layout.tsx:
 *   import { PublicEnvScript } from '@/components/public-env-script';
 *
 *   export default function RootLayout({ children }) {
 *     return (
 *       <html>
 *         <head>
 *           <PublicEnvScript />
 *         </head>
 *         <body>{children}</body>
 *       </html>
 *     );
 *   }
 *
 * Client-side access:
 *   const value = window.__RUNTIME_ENV__?.NEXT_PUBLIC_MONGODB_ENABLED;
 */
export function PublicEnvScript() {
  const publicEnv = getPublicEnv();

  return (
    <script
      dangerouslySetInnerHTML={{
        __html: `window.__RUNTIME_ENV__=${JSON.stringify(publicEnv)};`,
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
