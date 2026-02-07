/**
 * CAIPE UI Configuration
 *
 * Environment variables no longer use the NEXT_PUBLIC_ prefix.
 * They are read server-side from process.env and served to the client
 * via GET /api/config (unauthenticated).
 *
 * Client components consume config through the React ConfigContext
 * (see components/config-provider.tsx and the useConfig() hook).
 *
 * Server components and API routes use getServerConfig() directly.
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
  /** Whether to show sub-agent streaming cards in chat (experimental) */
  enableSubAgentCards: boolean;
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
   * When true and SSO is disabled, show Admin tab and allow admin API access without login (dev/local only).
   * Set ALLOW_DEV_ADMIN_WHEN_SSO_DISABLED=true. Do not use in production.
   */
  allowDevAdminWhenSsoDisabled: boolean;
  /** Storage mode: 'mongodb' or 'localStorage' */
  storageMode: 'mongodb' | 'localStorage';
}

/** Default branding values */
const DEFAULT_TAGLINE = 'Multi-Agent Workflow Automation';
const DEFAULT_DESCRIPTION = 'Where Humans and AI agents collaborate to deliver high quality outcomes.';
const DEFAULT_APP_NAME = 'CAIPE';
const DEFAULT_LOGO_URL = '/logo.svg';
const DEFAULT_GRADIENT_FROM = 'hsl(173,80%,40%)';
const DEFAULT_GRADIENT_TO = 'hsl(270,75%,60%)';
const DEFAULT_SUPPORT_EMAIL = 'support@example.com';

/**
 * Helper to read an env var. Checks both non-prefixed and NEXT_PUBLIC_ prefixed
 * for backward compatibility during migration.
 */
function env(name: string): string | undefined {
  // Prefer the new non-prefixed name, fall back to NEXT_PUBLIC_ for backward compat
  return process.env[name] || process.env[`NEXT_PUBLIC_${name}`] || undefined;
}

/**
 * Build the full Config object from server-side process.env.
 *
 * This MUST only be called on the server (Node.js runtime).
 * Client components should use useConfig() from ConfigContext.
 */
export function getServerConfig(): Config {
  const isProduction = process.env.NODE_ENV === 'production';
  const isDev = process.env.NODE_ENV === 'development';

  // CAIPE A2A URL
  const caipeUrl = env('A2A_BASE_URL')
    || (isProduction ? 'http://caipe-supervisor:8000' : 'http://localhost:8000');

  // RAG URL
  const ragUrl = env('RAG_URL')
    || process.env.RAG_SERVER_URL
    || (isProduction ? 'http://rag-server:9446' : 'http://localhost:9446');

  // Boolean flags
  const ssoEnabled = env('SSO_ENABLED') === 'true';
  const ragEnabled = env('RAG_ENABLED') !== 'false'; // default true
  const mongodbEnabled = !!(process.env.MONGODB_URI && process.env.MONGODB_DATABASE)
    || env('MONGODB_ENABLED') === 'true';
  const enableSubAgentCards = env('ENABLE_SUBAGENT_CARDS') === 'true';
  const previewMode = env('PREVIEW_MODE') === 'true';
  const allowDevAdminWhenSsoDisabled = env('ALLOW_DEV_ADMIN_WHEN_SSO_DISABLED') === 'true';

  // Show powered by (default true)
  const showPoweredByEnv = env('SHOW_POWERED_BY');
  const showPoweredBy = showPoweredByEnv !== undefined ? showPoweredByEnv !== 'false' : true;

  // Logo style
  const logoStyleEnv = env('LOGO_STYLE');
  const logoStyle: 'default' | 'white' = logoStyleEnv === 'white' ? 'white' : 'default';

  // Spinner color
  const spinnerColor = env('SPINNER_COLOR') || null;

  // Storage mode
  const storageMode: 'mongodb' | 'localStorage' = mongodbEnabled ? 'mongodb' : 'localStorage';

  return {
    caipeUrl,
    ragUrl,
    isDev,
    isProd: isProduction,
    ssoEnabled,
    ragEnabled,
    mongodbEnabled,
    enableSubAgentCards,
    tagline: env('TAGLINE') || DEFAULT_TAGLINE,
    description: env('DESCRIPTION') || DEFAULT_DESCRIPTION,
    appName: env('APP_NAME') || DEFAULT_APP_NAME,
    logoUrl: env('LOGO_URL') || DEFAULT_LOGO_URL,
    previewMode,
    gradientFrom: env('GRADIENT_FROM') || DEFAULT_GRADIENT_FROM,
    gradientTo: env('GRADIENT_TO') || DEFAULT_GRADIENT_TO,
    logoStyle,
    spinnerColor,
    showPoweredBy,
    supportEmail: env('SUPPORT_EMAIL') || DEFAULT_SUPPORT_EMAIL,
    allowDevAdminWhenSsoDisabled,
    storageMode,
  };
}

/**
 * Get the CSS class for the logo based on logoStyle config.
 * Works on both server and client (reads from the provided config or defaults).
 */
export function getLogoFilterClass(style?: 'default' | 'white'): string {
  const s = style ?? 'default';
  return s === 'white' ? 'brightness-0 invert' : '';
}

// ---- Client-side config cache ----

/**
 * Module-level cache populated by ConfigProvider after fetching /api/config.
 * This allows getConfig() and the `config` export to work on the client
 * without requiring a React hook, keeping import diffs minimal.
 */
let _clientConfig: Config | null = null;

/**
 * Called by ConfigProvider once the /api/config fetch completes.
 * Do NOT call this directly — it is an internal API.
 */
export function _setClientConfig(c: Config): void {
  _clientConfig = c;
}

// ---- Universal config accessors ----

/**
 * Get a single config value by key.
 *
 * Works on both server (reads process.env via getServerConfig) and client
 * (reads the cached Config populated by ConfigProvider).
 *
 * On the client, this returns defaults until ConfigProvider has loaded.
 */
export function getConfig<K extends keyof Config>(key: K): Config[K] {
  if (typeof window !== 'undefined') {
    // Client: use the cache populated by ConfigProvider
    if (_clientConfig) return _clientConfig[key];
    // Fallback to defaults before ConfigProvider has finished loading
    return DEFAULT_CLIENT_CONFIG[key];
  }
  // Server: read from process.env
  return getServerConfig()[key];
}

/**
 * Default client-side config (mirrors config-provider defaults).
 * Used only as a brief fallback before ConfigProvider populates the cache.
 */
const DEFAULT_CLIENT_CONFIG: Config = {
  caipeUrl: 'http://localhost:8000',
  ragUrl: 'http://localhost:9446',
  isDev: false,
  isProd: false,
  ssoEnabled: false,
  ragEnabled: true,
  mongodbEnabled: false,
  enableSubAgentCards: false,
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
};

/**
 * Full config object.
 * On the server this is populated at module load time.
 * On the client it returns the cached config (or defaults before ConfigProvider loads).
 */
export const config: Config = typeof process !== 'undefined' && typeof window === 'undefined'
  ? getServerConfig()
  : new Proxy(DEFAULT_CLIENT_CONFIG, {
      get(_target, prop: string) {
        if (_clientConfig && prop in _clientConfig) {
          return _clientConfig[prop as keyof Config];
        }
        return DEFAULT_CLIENT_CONFIG[prop as keyof Config];
      },
    });

export default config;
