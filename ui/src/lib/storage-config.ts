/**
 * Storage Configuration
 *
 * Determines storage mode based on MongoDB configuration.
 * This ensures exclusive storage mode - no hybrid confusion.
 *
 * - If MongoDB is configured → MongoDB mode (no localStorage)
 * - If MongoDB is not configured → localStorage mode only
 *
 * Server-side: reads from process.env (Node.js runtime).
 * Client-side: uses the storageMode from ConfigContext (fetched from /api/config).
 */

export type StorageMode = 'mongodb' | 'localStorage';

const IS_SERVER = typeof window === 'undefined';

/**
 * Check if MongoDB is configured (server-side only).
 */
function isMongoDBConfigured(): boolean {
  return !!(process.env.MONGODB_URI && process.env.MONGODB_DATABASE);
}

/**
 * Get the storage mode for the application (server-side).
 * Client-side code should use getConfig('storageMode') instead.
 */
export function getStorageMode(): StorageMode {
  if (IS_SERVER) {
    return isMongoDBConfigured() ? 'mongodb' : 'localStorage';
  }
  // Client-side fallback — shouldn't normally be called;
  // use getConfig('storageMode') instead.
  console.warn('[storage-config] getStorageMode() called on client — use getConfig("storageMode")');
  return 'localStorage';
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
