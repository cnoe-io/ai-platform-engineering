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
  /** Whether to show sub-agent streaming cards in chat (experimental) */
  enableSubAgentCards: boolean;
}

/**
 * Get runtime environment variable from window.__ENV__ (injected at container startup)
 * Falls back to process.env for build-time values
 */
function getRuntimeEnv(key: string): string | undefined {
  // Client-side: check window.__ENV__ first (runtime injection)
  if (typeof window !== 'undefined' && (window as any).__ENV__) {
    return (window as any).__ENV__[key];
  }
  
  // Fallback to process.env (build-time or server-side)
  if (typeof process !== 'undefined') {
    return process.env[key];
  }
  
  return undefined;
}

/**
 * Get the CAIPE A2A endpoint URL
 *
 * Priority:
 * 1. NEXT_PUBLIC_CAIPE_URL (client-side accessible)
 * 2. CAIPE_URL (server-side only)
 * 3. Default: http://localhost:8000 (dev) or http://caipe-supervisor:8000 (prod/docker)
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
 */
function isSsoEnabled(): boolean {
  const ssoEnv = getRuntimeEnv('NEXT_PUBLIC_SSO_ENABLED');
  if (ssoEnv !== undefined) {
    return ssoEnv === 'true';
  }
  return false;
}

/**
 * Check if sub-agent cards are enabled (experimental feature)
 * Disabled by default - set NEXT_PUBLIC_ENABLE_SUBAGENT_CARDS=true to enable
 */
function isSubAgentCardsEnabled(): boolean {
  const cardsEnv = getRuntimeEnv('NEXT_PUBLIC_ENABLE_SUBAGENT_CARDS');
  if (cardsEnv !== undefined) {
    return cardsEnv === 'true';
  }
  return false;
}

/**
 * Application configuration
 */
export const config: Config = {
  caipeUrl: getCaipeUrl(),
  ragUrl: getRagUrl(),
  isDev: typeof process !== 'undefined' && process.env.NODE_ENV === 'development',
  isProd: typeof process !== 'undefined' && process.env.NODE_ENV === 'production',
  ssoEnabled: isSsoEnabled(),
  enableSubAgentCards: isSubAgentCardsEnabled(),
};

/**
 * Get configuration value by key
 */
export function getConfig<K extends keyof Config>(key: K): Config[K] {
  return config[key];
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
      enableSubAgentCards: config.enableSubAgentCards,
    });
  }
}

export default config;
