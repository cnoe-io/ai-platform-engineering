/**
 * Storage Configuration
 * 
 * Determines storage mode at build time based on MongoDB configuration.
 * This ensures exclusive storage mode - no hybrid confusion.
 * 
 * - If MONGODB_URI is set → MongoDB mode (no localStorage)
 * - If MONGODB_URI is not set → localStorage mode only
 */

// Check if MongoDB is configured
// Server-side: Check actual MONGODB_URI (never exposed to client)
// Client-side: Check NEXT_PUBLIC_MONGODB_ENABLED flag
const IS_SERVER = typeof window === 'undefined';

export const IS_MONGODB_CONFIGURED = IS_SERVER
  ? !!(process.env.MONGODB_URI && process.env.MONGODB_DATABASE)
  : process.env.NEXT_PUBLIC_MONGODB_ENABLED === 'true';

export type StorageMode = 'mongodb' | 'localStorage';

/**
 * Get the storage mode for the application
 * This is determined at build/runtime based on env variables
 */
export function getStorageMode(): StorageMode {
  return IS_MONGODB_CONFIGURED ? 'mongodb' : 'localStorage';
}

/**
 * Check if localStorage persistence should be enabled
 * Only enable localStorage when MongoDB is NOT configured
 */
export function shouldUseLocalStorage(): boolean {
  return !IS_MONGODB_CONFIGURED;
}

/**
 * Get storage mode display name for UI
 */
export function getStorageModeDisplay(): string {
  return IS_MONGODB_CONFIGURED 
    ? '🗄️  MongoDB (Persistent)' 
    : '💾 LocalStorage (Browser-only)';
}

// Log storage mode on initialization (server-side only)
if (typeof window === 'undefined') {
  console.log(`📦 Storage Mode: ${getStorageMode()}`);
  if (IS_MONGODB_CONFIGURED) {
    console.log('   ✅ MongoDB configured - using persistent storage');
  } else {
    console.log('   ⚠️  MongoDB not configured - using localStorage only');
    console.log('   💡 Set MONGODB_URI and MONGODB_DATABASE to enable persistent storage');
  }
}
