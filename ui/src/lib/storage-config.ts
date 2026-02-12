/**
 * Storage Configuration
 *
 * Determines storage mode based on MongoDB configuration.
 * This ensures exclusive storage mode — no hybrid confusion.
 *
 * - If MongoDB is configured → MongoDB mode (no localStorage)
 * - If MongoDB is not configured → localStorage mode only
 *
 * Server-side: reads from process.env (Node.js runtime).
 * Client-side: reads from window.__APP_CONFIG__ (injected by root layout).
 */

import { getConfig } from './config';

export type StorageMode = 'mongodb' | 'localStorage';

const IS_SERVER = typeof window === 'undefined';

/**
 * Get the storage mode for the application.
 *
 * - Server: reads process.env.MONGODB_URI + MONGODB_DATABASE directly.
 * - Client: reads storageMode from window.__APP_CONFIG__ (via getConfig).
 */
export function getStorageMode(): StorageMode {
  if (IS_SERVER) {
    return !!(process.env.MONGODB_URI && process.env.MONGODB_DATABASE)
      ? 'mongodb'
      : 'localStorage';
  }
  // Client: use the config injected by the server
  return getConfig('storageMode');
}

/**
 * Check if localStorage persistence should be enabled.
 *
 * - Server: checks process.env directly.
 * - Client: reads from injected config.
 */
export function shouldUseLocalStorage(): boolean {
  return getStorageMode() !== 'mongodb';
}

/**
 * Get storage mode display name for UI.
 */
export function getStorageModeDisplay(mode?: StorageMode): string {
  const m = mode ?? getStorageMode();
  return m === 'mongodb'
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
