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
  /** Whether we're in development mode */
  isDev: boolean;
  /** Whether we're in production mode */
  isProd: boolean;
  /** Whether SSO authentication is enabled */
  ssoEnabled: boolean;
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
  // Client-side environment variable (must be prefixed with NEXT_PUBLIC_)
  if (typeof process !== 'undefined' && process.env.NEXT_PUBLIC_CAIPE_URL) {
    return process.env.NEXT_PUBLIC_CAIPE_URL;
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

  // In production (Docker), default to the service name
  // In development, default to localhost
  return isProduction ? 'http://caipe-supervisor:8000' : 'http://localhost:8000';
}

/**
 * Check if SSO is enabled
 * SSO is enabled when NEXT_PUBLIC_SSO_ENABLED is set to "true"
 */
function isSsoEnabled(): boolean {
  if (typeof process !== 'undefined' && process.env.NEXT_PUBLIC_SSO_ENABLED) {
    return process.env.NEXT_PUBLIC_SSO_ENABLED === 'true';
  }
  return false;
}

/**
 * Application configuration
 */
export const config: Config = {
  caipeUrl: getCaipeUrl(),
  isDev: typeof process !== 'undefined' && process.env.NODE_ENV === 'development',
  isProd: typeof process !== 'undefined' && process.env.NODE_ENV === 'production',
  ssoEnabled: isSsoEnabled(),
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
      isDev: config.isDev,
      isProd: config.isProd,
      ssoEnabled: config.ssoEnabled,
    });
  }
}

export default config;
