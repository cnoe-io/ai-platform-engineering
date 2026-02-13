/**
 * CAIPE UI Configuration
 *
 * Architecture:
 *
 * Server-side (Node.js):
 *   getServerConfig() reads process.env at runtime and returns a full Config.
 *   Used by API routes, server components, and the root layout.
 *
 * Client-side (browser):
 *   The root layout (server component) calls getClientConfig(), serializes it
 *   as window.__APP_CONFIG__ via an inline <script> tag. Client code reads
 *   this synchronously — no fetch, no React Context, no loading state.
 *
 * Security:
 *   - Only explicitly allowlisted keys are sent to the browser (ClientConfig).
 *   - Server-only secrets (OIDC_CLIENT_SECRET, MONGODB_URI, etc.) never leave
 *     the server. There is no wildcard env var dump.
 *   - The JSON payload is XSS-safe (< is escaped to prevent script injection).
 *
 * Env var naming:
 *   Env vars use clean names (SSO_ENABLED, APP_NAME, etc.). The env() helper
 *   also checks NEXT_PUBLIC_ prefixed names for backward compatibility.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * Client-safe configuration — only these fields are sent to the browser.
 * NEVER add secrets, credentials, or internal infrastructure details here.
 */
export interface Config {
  /** CAIPE A2A endpoint URL */
  caipeUrl: string;
  /** RAG Server URL for knowledge base operations */
  ragUrl: string;
  /** Whether we're in development mode */
  isDev: boolean;
  /** Whether we're in production mode */
  isProd: boolean;
  /** Whether SSO authentication is enabled */
  ssoEnabled: boolean;
  /** Whether RAG knowledge bases are enabled */
  ragEnabled: boolean;
  /** Whether MongoDB persistence is enabled */
  mongodbEnabled: boolean;
  /** Main tagline displayed throughout the UI */
  tagline: string;
  /** Description text displayed throughout the UI */
  description: string;
  /** Application name displayed throughout the UI */
  appName: string;
  /** Logo URL (relative or absolute) */
  logoUrl: string;
  /** Whether the app is in preview/beta mode */
  previewMode: boolean;
  /** Gradient start color (CSS color value) */
  gradientFrom: string;
  /** Gradient end color (CSS color value) */
  gradientTo: string;
  /** Logo style: "default" (original colors) or "white" (inverted) */
  logoStyle: 'default' | 'white';
  /** Spinner/loading indicator color (CSS color value) */
  spinnerColor: string | null;
  /** Whether to show "Powered by OSS caipe.io" footer */
  showPoweredBy: boolean;
  /** Support email address for contact links */
  supportEmail: string;
  /**
   * When true and SSO is disabled, show Admin tab without login (dev only).
   * Set ALLOW_DEV_ADMIN_WHEN_SSO_DISABLED=true. Do not use in production.
   */
  allowDevAdminWhenSsoDisabled: boolean;
  /** Storage mode: 'mongodb' or 'localStorage' */
  storageMode: 'mongodb' | 'localStorage';
  /** Enabled integration icons on login page (comma-separated list, null = show all) */
  enabledIntegrationIcons: string[] | null;
  /** Favicon URL (relative or absolute) */
  faviconUrl: string;
}

// ---------------------------------------------------------------------------
// Defaults (single source of truth)
// ---------------------------------------------------------------------------

const DEFAULT_TAGLINE = 'Multi-Agent Workflow Automation';
const DEFAULT_DESCRIPTION = 'Where Humans and AI agents collaborate to deliver high quality outcomes.';
const DEFAULT_APP_NAME = 'CAIPE';
const DEFAULT_LOGO_URL = '/logo.svg';
const DEFAULT_GRADIENT_FROM = 'hsl(173,80%,40%)';
const DEFAULT_GRADIENT_TO = 'hsl(270,75%,60%)';
const DEFAULT_SUPPORT_EMAIL = 'support@example.com';

/** Default config used as client fallback before the layout script executes. */
const DEFAULT_CONFIG: Config = {
  caipeUrl: 'http://localhost:8000',
  ragUrl: 'http://localhost:9446',
  isDev: false,
  isProd: false,
  ssoEnabled: false,
  ragEnabled: true,
  mongodbEnabled: false,
  tagline: DEFAULT_TAGLINE,
  description: DEFAULT_DESCRIPTION,
  appName: DEFAULT_APP_NAME,
  logoUrl: DEFAULT_LOGO_URL,
  previewMode: false,
  gradientFrom: DEFAULT_GRADIENT_FROM,
  gradientTo: DEFAULT_GRADIENT_TO,
  logoStyle: 'default',
  spinnerColor: null,
  showPoweredBy: true,
  supportEmail: DEFAULT_SUPPORT_EMAIL,
  allowDevAdminWhenSsoDisabled: false,
  storageMode: 'localStorage',
  enabledIntegrationIcons: null,
  faviconUrl: '/favicon.ico',
};

// ---------------------------------------------------------------------------
// Server-side config (reads process.env)
// ---------------------------------------------------------------------------

/**
 * Read an env var by clean name, falling back to NEXT_PUBLIC_ prefix
 * for backward compatibility.
 */
function env(name: string): string | undefined {
  return process.env[name] || process.env[`NEXT_PUBLIC_${name}`] || undefined;
}

/**
 * Build the full Config from server-side process.env.
 *
 * MUST only be called on the server (Node.js runtime).
 */
export function getServerConfig(): Config {
  const isProduction = process.env.NODE_ENV === 'production';
  const isDev = process.env.NODE_ENV === 'development';

  const caipeUrl = env('A2A_BASE_URL')
    || (isProduction ? 'http://caipe-supervisor:8000' : 'http://localhost:8000');

  const ragUrl = env('RAG_URL')
    || process.env.RAG_SERVER_URL
    || (isProduction ? 'http://rag-server:9446' : 'http://localhost:9446');

  const ssoEnabled = env('SSO_ENABLED') === 'true';
  const ragEnabled = env('RAG_ENABLED') !== 'false';
  const mongodbEnabled = !!(process.env.MONGODB_URI && process.env.MONGODB_DATABASE)
    || env('MONGODB_ENABLED') === 'true';
  const previewMode = env('PREVIEW_MODE') === 'true';
  const allowDevAdminWhenSsoDisabled = env('ALLOW_DEV_ADMIN_WHEN_SSO_DISABLED') === 'true';

  const showPoweredByEnv = env('SHOW_POWERED_BY');
  const showPoweredBy = showPoweredByEnv !== undefined ? showPoweredByEnv !== 'false' : true;

  const logoStyleEnv = env('LOGO_STYLE');
  const logoStyle: 'default' | 'white' = logoStyleEnv === 'white' ? 'white' : 'default';

  return {
    caipeUrl,
    ragUrl,
    isDev,
    isProd: isProduction,
    ssoEnabled,
    ragEnabled,
    mongodbEnabled,
    tagline: env('TAGLINE') || DEFAULT_TAGLINE,
    description: env('DESCRIPTION') || DEFAULT_DESCRIPTION,
    appName: env('APP_NAME') || DEFAULT_APP_NAME,
    logoUrl: env('LOGO_URL') || DEFAULT_LOGO_URL,
    previewMode,
    gradientFrom: env('GRADIENT_FROM') || DEFAULT_GRADIENT_FROM,
    gradientTo: env('GRADIENT_TO') || DEFAULT_GRADIENT_TO,
    logoStyle,
    spinnerColor: env('SPINNER_COLOR') || null,
    showPoweredBy,
    supportEmail: env('SUPPORT_EMAIL') || DEFAULT_SUPPORT_EMAIL,
    allowDevAdminWhenSsoDisabled,
    storageMode: mongodbEnabled ? 'mongodb' : 'localStorage',
    enabledIntegrationIcons: (() => {
      const icons = env('ENABLED_INTEGRATION_ICONS');
      if (icons) {
        return icons.split(',').map((icon) => icon.trim().toLowerCase());
      }
      return null;
    })(),
    faviconUrl: env('FAVICON_URL') || '/favicon.ico',
  };
}

/**
 * Get the client-safe config as an XSS-safe JSON string.
 *
 * Called by the root layout to inject into <script>. Escapes < to \u003c
 * so a malicious env var value cannot break out of the script tag.
 */
export function getClientConfigScript(): string {
  const cfg = getServerConfig();
  return JSON.stringify(cfg).replace(/</g, '\\u003c');
}

// ---------------------------------------------------------------------------
// Universal config accessors (work on both server and client)
// ---------------------------------------------------------------------------

/**
 * Read the client config object from window.__APP_CONFIG__.
 * Returns DEFAULT_CONFIG as fallback if not yet injected.
 */
function getClientAppConfig(): Config {
  if (typeof window !== 'undefined') {
    const w = window as unknown as { __APP_CONFIG__?: Config };
    if (w.__APP_CONFIG__) return w.__APP_CONFIG__;
  }
  return DEFAULT_CONFIG;
}

/**
 * Get a single config value by key.
 *
 * - Server: reads process.env via getServerConfig().
 * - Client: reads window.__APP_CONFIG__ (injected by root layout).
 *
 * This is the primary API for all config access throughout the app.
 */
export function getConfig<K extends keyof Config>(key: K): Config[K] {
  if (typeof window !== 'undefined') {
    return getClientAppConfig()[key];
  }
  return getServerConfig()[key];
}

/**
 * Full config object.
 *
 * - Server: populated at module load time from process.env.
 * - Client: Proxy that reads from window.__APP_CONFIG__ on each access.
 */
export const config: Config = typeof window === 'undefined'
  ? getServerConfig()
  : new Proxy(DEFAULT_CONFIG, {
      get(_target, prop: string) {
        return getClientAppConfig()[prop as keyof Config];
      },
    });

// ---------------------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------------------

/**
 * Get the CSS class for the logo based on logoStyle.
 * Pass the style explicitly, or omit to read from current config.
 */
export function getLogoFilterClass(style?: 'default' | 'white'): string {
  const s = style ?? getConfig('logoStyle');
  return s === 'white' ? 'brightness-0 invert' : '';
}

export default config;
