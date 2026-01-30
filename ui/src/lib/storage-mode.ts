/**
 * Storage mode detection and configuration
 * 
 * Determines whether the app should use MongoDB (persistent) or localStorage (local-only)
 * Provides graceful fallback when MongoDB is unavailable
 */

let mongoDBAvailable: boolean | null = null;
let lastCheck: number = 0;
const CHECK_INTERVAL = 60000; // Re-check every 60 seconds

/**
 * Check if MongoDB backend is available
 * Caches the result to avoid excessive API calls
 */
export async function isMongoDBAvailable(): Promise<boolean> {
  const now = Date.now();
  
  // Return cached result if recent (within 60s)
  if (mongoDBAvailable !== null && (now - lastCheck) < CHECK_INTERVAL) {
    return mongoDBAvailable;
  }

  try {
    // Try to ping the health endpoint
    const response = await fetch('/api/chat/conversations?page=1&page_size=1', {
      method: 'GET',
      headers: { 'Cache-Control': 'no-cache' },
    });

    // Check if response is successful AND contains valid data
    if (response.ok) {
      try {
        const data = await response.json();
        // Validate response structure - MongoDB backend should return { success: true, data: [...] }
        mongoDBAvailable = data && data.success !== false;
      } catch (jsonError) {
        // If JSON parsing fails, assume MongoDB is unavailable
        console.warn('[StorageMode] Invalid JSON response from backend:', jsonError);
        mongoDBAvailable = false;
      }
    } else if (response.status === 503) {
      // 503 Service Unavailable - MongoDB not configured
      try {
        const data = await response.json();
        if (data.code === 'MONGODB_NOT_CONFIGURED') {
          console.log('[StorageMode] MongoDB not configured - using localStorage mode');
        }
      } catch {
        // Ignore JSON parsing errors for 503
      }
      mongoDBAvailable = false;
    } else {
      mongoDBAvailable = false;
    }

    lastCheck = now;

    if (!mongoDBAvailable) {
      console.warn('[StorageMode] MongoDB backend unavailable, using localStorage only');
    }

    return mongoDBAvailable;
  } catch (error) {
    console.warn('[StorageMode] Failed to check MongoDB availability:', error);
    mongoDBAvailable = false;
    lastCheck = now;
    return false;
  }
}

/**
 * Get the current storage mode
 */
export async function getStorageMode(): Promise<'mongodb' | 'localStorage'> {
  const available = await isMongoDBAvailable();
  return available ? 'mongodb' : 'localStorage';
}

/**
 * Force re-check of MongoDB availability on next call
 */
export function invalidateStorageModeCache(): void {
  mongoDBAvailable = null;
  lastCheck = 0;
}

/**
 * Get cached storage mode without async check
 * Returns null if not yet checked
 */
export function getCachedStorageMode(): 'mongodb' | 'localStorage' | null {
  if (mongoDBAvailable === null) return null;
  return mongoDBAvailable ? 'mongodb' : 'localStorage';
}
