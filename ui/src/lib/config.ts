/**
 * CAIPE UI Configuration
 *
 * Configuration is resolved in the following order (highest priority first):
 * 1. Runtime environment variables (NEXT_PUBLIC_CAIPE_URL)
 * 2. Build-time environment variables (CAIPE_URL)
 * 3. Default values based on environment
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
}

/**
 * Get runtime environment variable from window.__ENV__ (injected at container startup)
 * Falls back to process.env for build-time values
 *
 * Note: In Next.js, process.env.NEXT_PUBLIC_* cannot be accessed dynamically.
 * We must map each variable explicitly.
 */
function getRuntimeEnv(key: string): string | undefined {
  // Client-side: check window.__ENV__ first (runtime injection)
  if (typeof window !== 'undefined' && (window as any).__ENV__) {
    return (window as any).__ENV__[key];
  }

  // Fallback to process.env (build-time replacements by Next.js)
  // Next.js replaces these at build time, so we must access them directly
  if (typeof process !== 'undefined') {
    switch (key) {
      case 'NEXT_PUBLIC_A2A_BASE_URL':
        return process.env.NEXT_PUBLIC_A2A_BASE_URL;
      case 'NEXT_PUBLIC_CAIPE_URL':
        return process.env.NEXT_PUBLIC_CAIPE_URL;
      case 'NEXT_PUBLIC_SSO_ENABLED':
        return process.env.NEXT_PUBLIC_SSO_ENABLED;
      case 'NEXT_PUBLIC_MONGODB_ENABLED':
        return process.env.NEXT_PUBLIC_MONGODB_ENABLED;
      case 'NEXT_PUBLIC_ENABLE_SUBAGENT_CARDS':
        return process.env.NEXT_PUBLIC_ENABLE_SUBAGENT_CARDS;
      case 'NEXT_PUBLIC_TAGLINE':
        return process.env.NEXT_PUBLIC_TAGLINE;
      case 'NEXT_PUBLIC_DESCRIPTION':
        return process.env.NEXT_PUBLIC_DESCRIPTION;
      case 'NEXT_PUBLIC_APP_NAME':
        return process.env.NEXT_PUBLIC_APP_NAME;
      case 'NEXT_PUBLIC_LOGO_URL':
        return process.env.NEXT_PUBLIC_LOGO_URL;
      case 'NEXT_PUBLIC_PREVIEW_MODE':
        return process.env.NEXT_PUBLIC_PREVIEW_MODE;
      case 'NEXT_PUBLIC_GRADIENT_FROM':
        return process.env.NEXT_PUBLIC_GRADIENT_FROM;
      case 'NEXT_PUBLIC_GRADIENT_TO':
        return process.env.NEXT_PUBLIC_GRADIENT_TO;
      case 'NEXT_PUBLIC_LOGO_STYLE':
        return process.env.NEXT_PUBLIC_LOGO_STYLE;
      case 'NEXT_PUBLIC_SPINNER_COLOR':
        return process.env.NEXT_PUBLIC_SPINNER_COLOR;
      case 'NEXT_PUBLIC_SHOW_POWERED_BY':
        return process.env.NEXT_PUBLIC_SHOW_POWERED_BY;
      default:
        return undefined;
    }
  }

  return undefined;
}

/**
 * Get the CAIPE A2A endpoint URL
 *
 * Priority:
 * 1. Runtime: window.__ENV__.NEXT_PUBLIC_A2A_BASE_URL (injected at container start)
 * 2. Build-time: NEXT_PUBLIC_CAIPE_URL or NEXT_PUBLIC_A2A_BASE_URL
 * 3. Server-side: CAIPE_URL or A2A_ENDPOINT
 * 4. Default: http://localhost:8000 (dev) or http://caipe-supervisor:8000 (prod/docker)
 */
function getCaipeUrl(): string {
  // Runtime or build-time environment variable
  const envUrl = getRuntimeEnv('NEXT_PUBLIC_A2A_BASE_URL') || getRuntimeEnv('NEXT_PUBLIC_CAIPE_URL');
  if (envUrl) {
    return envUrl;
  }

  // Server-side environment variable
  if (typeof process !== 'undefined' && process.env.CAIPE_URL) {
    return process.env.CAIPE_URL;
  }

  // Legacy support for A2A_ENDPOINT
  if (typeof process !== 'undefined' && process.env.A2A_ENDPOINT) {
    return process.env.A2A_ENDPOINT;
  }

  // Default based on environment
  const isProduction = typeof process !== 'undefined' && process.env.NODE_ENV === 'production';
  return isProduction ? 'http://caipe-supervisor:8000' : 'http://localhost:8000';
}

/**
 * Get the RAG Server URL
 *
 * Priority:
 * 1. NEXT_PUBLIC_RAG_URL (client-side accessible)
 * 2. RAG_URL (server-side only)
 * 3. Default: http://localhost:9446 (dev) or http://rag-server:9446 (prod/docker)
 */
function getRagUrl(): string {
  // Client-side environment variable (must be prefixed with NEXT_PUBLIC_)
  if (typeof process !== 'undefined' && process.env.NEXT_PUBLIC_RAG_URL) {
    return process.env.NEXT_PUBLIC_RAG_URL;
  }

  // Server-side environment variable
  if (typeof process !== 'undefined' && process.env.RAG_URL) {
    return process.env.RAG_URL;
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
 * Priority: window.__ENV__ (runtime) > process.env (build-time)
 */
function isSsoEnabled(): boolean {
  const ssoEnv = getRuntimeEnv('NEXT_PUBLIC_SSO_ENABLED');
  if (ssoEnv !== undefined) {
    return ssoEnv === 'true';
  }
  return false;
}

/**
 * Check if MongoDB persistence is enabled
 * Disabled by default - set NEXT_PUBLIC_MONGODB_ENABLED=true to enable
 * Priority: window.__ENV__ (runtime) > process.env (build-time)
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
 * Priority: window.__ENV__ (runtime) > process.env (build-time)
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
 * Priority: window.__ENV__ (runtime) > process.env (build-time) > default
 */
function getTagline(): string {
  const tagline = getRuntimeEnv('NEXT_PUBLIC_TAGLINE');
  return tagline || DEFAULT_TAGLINE;
}

/**
 * Get the description text displayed throughout the UI
 * Priority: window.__ENV__ (runtime) > process.env (build-time) > default
 */
function getDescription(): string {
  const description = getRuntimeEnv('NEXT_PUBLIC_DESCRIPTION');
  return description || DEFAULT_DESCRIPTION;
}

/**
 * Get the application name displayed throughout the UI
 * Priority: window.__ENV__ (runtime) > process.env (build-time) > default
 */
function getAppName(): string {
  const appName = getRuntimeEnv('NEXT_PUBLIC_APP_NAME');
  return appName || DEFAULT_APP_NAME;
}

/**
 * Get the logo URL
 * Priority: window.__ENV__ (runtime) > process.env (build-time) > default
 */
function getLogoUrl(): string {
  const logoUrl = getRuntimeEnv('NEXT_PUBLIC_LOGO_URL');
  return logoUrl || DEFAULT_LOGO_URL;
}

/**
 * Check if preview mode is enabled
 * Priority: window.__ENV__ (runtime) > process.env (build-time)
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
 * Priority: window.__ENV__ (runtime) > process.env (build-time) > default
 */
function getGradientFrom(): string {
  const gradientFrom = getRuntimeEnv('NEXT_PUBLIC_GRADIENT_FROM');
  return gradientFrom || DEFAULT_GRADIENT_FROM;
}

/**
 * Get the gradient end color
 * Priority: window.__ENV__ (runtime) > process.env (build-time) > default
 */
function getGradientTo(): string {
  const gradientTo = getRuntimeEnv('NEXT_PUBLIC_GRADIENT_TO');
  return gradientTo || DEFAULT_GRADIENT_TO;
}

/**
 * Get the logo style
 * Priority: window.__ENV__ (runtime) > process.env (build-time) > default
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
 * Priority: window.__ENV__ (runtime) > process.env (build-time) > null (uses theme primary)
 */
function getSpinnerColor(): string | null {
  const spinnerColor = getRuntimeEnv('NEXT_PUBLIC_SPINNER_COLOR');
  return spinnerColor || null;
}

/**
 * Check if "Powered by" footer should be shown
 * Priority: window.__ENV__ (runtime) > process.env (build-time) > true (default)
 */
function showPoweredBy(): boolean {
  const showPoweredByEnv = getRuntimeEnv('NEXT_PUBLIC_SHOW_POWERED_BY');
  if (showPoweredByEnv !== undefined) {
    return showPoweredByEnv !== 'false';
  }
  return true;
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
    });
  }
}

export default config;
