/**
 * Storage Configuration
 * 
 * Determines storage mode based on MongoDB configuration.
 * This ensures exclusive storage mode - no hybrid confusion.
 * 
 * - If MongoDB is configured → MongoDB mode (no localStorage)
 * - If MongoDB is not configured → localStorage mode only
 * 
 * Client-side: reads from window.__RUNTIME_ENV__ (injected by PublicEnvScript)
 * Server-side: reads from process.env (Node.js runtime)
 */

import { getConfig } from './config';

export type StorageMode = 'mongodb' | 'localStorage';

const IS_SERVER = typeof window === 'undefined';

/**
 * Check if MongoDB is configured.
 * 
 * Server-side: Check actual MONGODB_URI env var (available at runtime in Node.js)
 * Client-side: Use getConfig('mongodbEnabled') which reads window.__RUNTIME_ENV__
 */
function isMongoDBConfigured(): boolean {
  if (IS_SERVER) {
    return !!(process.env.MONGODB_URI && process.env.MONGODB_DATABASE);
  }
  // Client-side: use the runtime-aware config system
  return getConfig('mongodbEnabled');
}

/**
 * Get the storage mode for the application
 * Evaluates dynamically on each call to pick up runtime config changes
 */
export function getStorageMode(): StorageMode {
  return isMongoDBConfigured() ? 'mongodb' : 'localStorage';
}

/**
 * Check if localStorage persistence should be enabled
 * Only enable localStorage when MongoDB is NOT configured
 */
export function shouldUseLocalStorage(): boolean {
  return !isMongoDBConfigured();
}

/**
 * Get storage mode display name for UI
 */
export function getStorageModeDisplay(): string {
  return isMongoDBConfigured() 
    ? '🗄️  MongoDB (Persistent)' 
    : '💾 LocalStorage (Browser-only)';
}

// Log storage mode on initialization (server-side only)
if (IS_SERVER) {
  const mode = getStorageMode();
  console.log(`📦 Storage Mode: ${mode}`);
  if (mode === 'mongodb') {
    console.log('   ✅ MongoDB configured - using persistent storage');
  } else {
    console.log('   ⚠️  MongoDB not configured - using localStorage only');
    console.log('   💡 Set MONGODB_URI and MONGODB_DATABASE to enable persistent storage');
  }
}
