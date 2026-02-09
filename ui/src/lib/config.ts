/**
 * CAIPE UI Configuration
 *
 * Runtime environment variable resolution:
 *
 * Client-side (browser):
 *   window.__RUNTIME_ENV__[key] — injected by PublicEnvScript server component
 *   in layout.tsx. The server component reads process.env at request time and
 *   renders an inline <script> tag, so values are always fresh.
 *
 * Server-side (Node.js):
 *   process.env[key] — read at runtime by Node.js, always fresh.
 *
 * No build-time inlining is used. No manual variable listing required.
 * Adding a new NEXT_PUBLIC_* variable? Just set it in your environment.
 *
 * SSO Configuration:
 * - NEXT_PUBLIC_SSO_ENABLED: "true" to enable SSO, otherwise disabled
 * - OIDC_ISSUER, OIDC_CLIENT_ID, OIDC_CLIENT_SECRET: Set on server side
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
}

/**
 * Get a NEXT_PUBLIC_* environment variable at runtime.
 *
 * Resolution order:
 * 1. Client: window.__RUNTIME_ENV__[key] (injected by PublicEnvScript)
 * 2. Server: process.env[key] (Node.js reads env vars at runtime)
 *
 * Unlike the old approach, there is no switch statement or manual variable list.
 * Both paths use dynamic key access which works because:
 * - window.__RUNTIME_ENV__ is a plain object (dynamic access always works)
 * - Server-side process.env[key] works at runtime in Node.js
 *   (only NEXT_PUBLIC_* in client bundles gets static-replaced by Next.js)
 */
function getRuntimeEnv(key: string): string | undefined {
  // Client-side: read from window.__RUNTIME_ENV__ (injected by PublicEnvScript)
  if (typeof window !== 'undefined') {
    const runtimeEnv = (window as any).__RUNTIME_ENV__ as Record<string, string> | undefined;
    if (runtimeEnv) {
      const value = runtimeEnv[key];
      if (value !== undefined && value !== null && value !== '') {
        return value;
      }
    }
    // On client, if not in __RUNTIME_ENV__, the value is not available
    // (process.env.NEXT_PUBLIC_* would be build-time stale, so we skip it)
    return undefined;
  }

  // Server-side: read process.env directly (Node.js runtime -- always fresh)
  if (typeof process !== 'undefined') {
    const value = process.env[key];
    return value || undefined;
  }

  return undefined;
}

/**
 * Get the CAIPE A2A endpoint URL
 *
 * Priority:
 * 1. Runtime/Build-time: NEXT_PUBLIC_A2A_BASE_URL
 * 2. Default: http://localhost:8000 (dev) or http://caipe-supervisor:8000 (prod/docker)
 */
function getCaipeUrl(): string {
  // Check for NEXT_PUBLIC_A2A_BASE_URL (runtime or build-time)
  const envUrl = getRuntimeEnv('NEXT_PUBLIC_A2A_BASE_URL');
  if (envUrl) {
    return envUrl;
  }

  // Default based on environment
  const isProduction = typeof process !== 'undefined' && process.env.NODE_ENV === 'production';
  return isProduction ? 'http://caipe-supervisor:8000' : 'http://localhost:8000';
}

/**
 * Get the RAG Server URL
 *
 * Priority:
 * 1. NEXT_PUBLIC_RAG_URL via getRuntimeEnv (runtime → build-time fallback)
 * 2. RAG_SERVER_URL (server-side only, available at runtime in Node.js)
 * 3. Default: http://localhost:9446 (dev) or http://rag-server:9446 (prod/docker)
 */
function getRagUrl(): string {
  // Client-side: use runtime env (window.__RUNTIME_ENV__)
  const runtimeUrl = getRuntimeEnv('NEXT_PUBLIC_RAG_URL');
  if (runtimeUrl) {
    return runtimeUrl;
  }

  // Server-side environment variable (not exposed to client)
  if (typeof process !== 'undefined' && process.env.RAG_SERVER_URL) {
    return process.env.RAG_SERVER_URL;
  }

  // Default based on environment
  const isProduction = typeof process !== 'undefined' && process.env.NODE_ENV === 'production';

  // In production (Docker), default to the service name
  // In development, default to localhost
  return isProduction ? 'http://rag-server:9446' : 'http://localhost:9446';
}

/**
 * Check if SSO is enabled
 * SSO is enabled when NEXT_PUBLIC_SSO_ENABLED is set to "true"
 * Priority: window.__RUNTIME_ENV__ (client) > process.env (server)
 */
function isSsoEnabled(): boolean {
  const ssoEnv = getRuntimeEnv('NEXT_PUBLIC_SSO_ENABLED');
  if (ssoEnv !== undefined) {
    return ssoEnv === 'true';
  }
  return false;
}

/**
 * Check if RAG is enabled
 * RAG is enabled by default - set NEXT_PUBLIC_RAG_ENABLED=false to disable
 * Priority: window.__RUNTIME_ENV__ (client) > process.env (server)
 */
function isRagEnabled(): boolean {
  const ragEnv = getRuntimeEnv('NEXT_PUBLIC_RAG_ENABLED');
  if (ragEnv !== undefined) {
    return ragEnv === 'true';
  }
  // Default: enabled (for backward compatibility)
  return true;
}

/**
 * Check if MongoDB persistence is enabled
 * Disabled by default - set NEXT_PUBLIC_MONGODB_ENABLED=true to enable
 * Priority: window.__RUNTIME_ENV__ (client) > process.env (server)
 */
function isMongodbEnabled(): boolean {
  const mongoEnv = getRuntimeEnv('NEXT_PUBLIC_MONGODB_ENABLED');
  if (mongoEnv !== undefined) {
    return mongoEnv === 'true';
  }
  return false;
}

/**
 * Check if sub-agent cards are enabled (experimental feature)
 * Disabled by default - set NEXT_PUBLIC_ENABLE_SUBAGENT_CARDS=true to enable
 * Priority: window.__RUNTIME_ENV__ (client) > process.env (server)
 */
function isSubAgentCardsEnabled(): boolean {
  const cardsEnv = getRuntimeEnv('NEXT_PUBLIC_ENABLE_SUBAGENT_CARDS');
  if (cardsEnv !== undefined) {
    return cardsEnv === 'true';
  }
  return false;
}

/** Default branding values */
const DEFAULT_TAGLINE = 'Multi-Agent Workflow Automation';
const DEFAULT_DESCRIPTION = 'Where Humans and AI agents collaborate to deliver high quality outcomes.';
const DEFAULT_APP_NAME = 'CAIPE';
const DEFAULT_LOGO_URL = '/logo.svg';
const DEFAULT_GRADIENT_FROM = 'hsl(173,80%,40%)';
const DEFAULT_GRADIENT_TO = 'hsl(270,75%,60%)';

/**
 * Get the main tagline displayed throughout the UI
 * Priority: window.__RUNTIME_ENV__ (client) > process.env (server) > default
 */
function getTagline(): string {
  const tagline = getRuntimeEnv('NEXT_PUBLIC_TAGLINE');
  return tagline || DEFAULT_TAGLINE;
}

/**
 * Get the description text displayed throughout the UI
 * Priority: window.__RUNTIME_ENV__ (client) > process.env (server) > default
 */
function getDescription(): string {
  const description = getRuntimeEnv('NEXT_PUBLIC_DESCRIPTION');
  return description || DEFAULT_DESCRIPTION;
}

/**
 * Get the application name displayed throughout the UI
 * Priority: window.__RUNTIME_ENV__ (client) > process.env (server) > default
 */
function getAppName(): string {
  const appName = getRuntimeEnv('NEXT_PUBLIC_APP_NAME');
  return appName || DEFAULT_APP_NAME;
}

/**
 * Get the logo URL
 * Priority: window.__RUNTIME_ENV__ (client) > process.env (server) > default
 */
function getLogoUrl(): string {
  const logoUrl = getRuntimeEnv('NEXT_PUBLIC_LOGO_URL');
  return logoUrl || DEFAULT_LOGO_URL;
}

/**
 * Check if preview mode is enabled
 * Priority: window.__RUNTIME_ENV__ (client) > process.env (server)
 */
function isPreviewMode(): boolean {
  const previewEnv = getRuntimeEnv('NEXT_PUBLIC_PREVIEW_MODE');
  if (previewEnv !== undefined) {
    return previewEnv === 'true';
  }
  return false;
}

/**
 * Get the gradient start color
 * Priority: window.__RUNTIME_ENV__ (client) > process.env (server) > default
 */
function getGradientFrom(): string {
  const gradientFrom = getRuntimeEnv('NEXT_PUBLIC_GRADIENT_FROM');
  return gradientFrom || DEFAULT_GRADIENT_FROM;
}

/**
 * Get the gradient end color
 * Priority: window.__RUNTIME_ENV__ (client) > process.env (server) > default
 */
function getGradientTo(): string {
  const gradientTo = getRuntimeEnv('NEXT_PUBLIC_GRADIENT_TO');
  return gradientTo || DEFAULT_GRADIENT_TO;
}

/**
 * Get the logo style
 * Priority: window.__RUNTIME_ENV__ (client) > process.env (server) > default
 * Returns "default" (original colors) or "white" (inverted)
 */
function getLogoStyle(): 'default' | 'white' {
  const logoStyle = getRuntimeEnv('NEXT_PUBLIC_LOGO_STYLE');
  if (logoStyle === 'white') {
    return 'white';
  }
  return 'default';
}

/**
 * Get the spinner color
 * Priority: window.__RUNTIME_ENV__ (client) > process.env (server) > null (uses theme primary)
 */
function getSpinnerColor(): string | null {
  const spinnerColor = getRuntimeEnv('NEXT_PUBLIC_SPINNER_COLOR');
  return spinnerColor || null;
}

/**
 * Check if "Powered by" footer should be shown
 * Priority: window.__RUNTIME_ENV__ (client) > process.env (server) > true (default)
 */
function showPoweredBy(): boolean {
  const showPoweredByEnv = getRuntimeEnv('NEXT_PUBLIC_SHOW_POWERED_BY');
  if (showPoweredByEnv !== undefined) {
    return showPoweredByEnv !== 'false';
  }
  return true;
}

const DEFAULT_SUPPORT_EMAIL = 'support@example.com';

/**
 * Get the support email address
 * Priority: window.__RUNTIME_ENV__ (client) > process.env (server) > default
 */
function getSupportEmail(): string {
  const email = getRuntimeEnv('NEXT_PUBLIC_SUPPORT_EMAIL');
  return email || DEFAULT_SUPPORT_EMAIL;
}

/**
 * Application configuration (static - evaluated at module load)
 * For client components, use getConfig() for dynamic values
 */
export const config: Config = {
  caipeUrl: getCaipeUrl(),
  ragUrl: getRagUrl(),
  isDev: typeof process !== 'undefined' && process.env.NODE_ENV === 'development',
  isProd: typeof process !== 'undefined' && process.env.NODE_ENV === 'production',
  ssoEnabled: isSsoEnabled(),
  ragEnabled: isRagEnabled(),
  mongodbEnabled: isMongodbEnabled(),
  enableSubAgentCards: isSubAgentCardsEnabled(),
  tagline: getTagline(),
  description: getDescription(),
  appName: getAppName(),
  logoUrl: getLogoUrl(),
  previewMode: isPreviewMode(),
  gradientFrom: getGradientFrom(),
  gradientTo: getGradientTo(),
  logoStyle: getLogoStyle(),
  spinnerColor: getSpinnerColor(),
  showPoweredBy: showPoweredBy(),
  supportEmail: getSupportEmail(),
};

/**
 * Get configuration value by key (dynamic - evaluates on each call)
 * Use this in client components to get fresh values
 */
export function getConfig<K extends keyof Config>(key: K): Config[K] {
  switch (key) {
    case 'caipeUrl':
      return getCaipeUrl() as Config[K];
    case 'ragUrl':
      return getRagUrl() as Config[K];
    case 'ssoEnabled':
      return isSsoEnabled() as Config[K];
    case 'ragEnabled':
      return isRagEnabled() as Config[K];
    case 'mongodbEnabled':
      return isMongodbEnabled() as Config[K];
    case 'enableSubAgentCards':
      return isSubAgentCardsEnabled() as Config[K];
    case 'tagline':
      return getTagline() as Config[K];
    case 'description':
      return getDescription() as Config[K];
    case 'appName':
      return getAppName() as Config[K];
    case 'logoUrl':
      return getLogoUrl() as Config[K];
    case 'previewMode':
      return isPreviewMode() as Config[K];
    case 'gradientFrom':
      return getGradientFrom() as Config[K];
    case 'gradientTo':
      return getGradientTo() as Config[K];
    case 'logoStyle':
      return getLogoStyle() as Config[K];
    case 'spinnerColor':
      return getSpinnerColor() as Config[K];
    case 'showPoweredBy':
      return showPoweredBy() as Config[K];
    case 'supportEmail':
      return getSupportEmail() as Config[K];
    case 'isDev':
      return (typeof process !== 'undefined' && process.env.NODE_ENV === 'development') as Config[K];
    case 'isProd':
      return (typeof process !== 'undefined' && process.env.NODE_ENV === 'production') as Config[K];
    default:
      return config[key];
  }
}

/**
 * Get the CSS class for the logo based on logoStyle config
 * Returns filter classes to make logo white, or empty string for default
 */
export function getLogoFilterClass(): string {
  return getLogoStyle() === 'white' ? 'brightness-0 invert' : '';
}

/**
 * Debug: Log current configuration (only in development)
 */
export function logConfig(): void {
  if (config.isDev) {
    console.log('[CAIPE Config]', {
      caipeUrl: config.caipeUrl,
      ragUrl: config.ragUrl,
      isDev: config.isDev,
      isProd: config.isProd,
      ssoEnabled: config.ssoEnabled,
      ragEnabled: config.ragEnabled,
      mongodbEnabled: config.mongodbEnabled,
      enableSubAgentCards: config.enableSubAgentCards,
      tagline: config.tagline,
      description: config.description,
      appName: config.appName,
      logoUrl: config.logoUrl,
      previewMode: config.previewMode,
      gradientFrom: config.gradientFrom,
      gradientTo: config.gradientTo,
      logoStyle: config.logoStyle,
      spinnerColor: config.spinnerColor,
      showPoweredBy: config.showPoweredBy,
      supportEmail: config.supportEmail,
    });
  }
}

export default config;
