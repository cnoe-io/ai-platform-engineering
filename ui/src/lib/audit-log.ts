/**
 * Audit Logging
 *
 * Append-only structured logging for all credential and security operations.
 * Meets NIS2 Art.21 incident handling and ISO 27001 A.8.15 monitoring requirements.
 *
 * Rules:
 * - Secrets, passwords, and tokens are NEVER written to audit log fields
 * - The audit_log collection is append-only (no update/delete routes exposed)
 * - TTL index expires records after AUDIT_LOG_RETENTION_DAYS (default: 90)
 */

import { ObjectId } from 'mongodb';
import { getCollection } from '@/lib/mongodb';
import type { AuditLogEntry, AuditAction } from '@/types/mongodb';

export type { AuditAction };

/**
 * Write a single audit log entry.
 * Failures are caught and logged to console — audit failures must never
 * crash the primary operation.
 */
export async function writeAuditLog(
  entry: Omit<AuditLogEntry, '_id' | 'timestamp'>,
): Promise<void> {
  try {
    const collection = await getCollection<AuditLogEntry>('audit_log');
    await collection.insertOne({
      _id: new ObjectId() as any,
      timestamp: new Date(),
      ...entry,
    } as any);
  } catch (error) {
    // Audit failures must not disrupt primary operations
    console.error('[AuditLog] Failed to write audit entry:', error);
  }
}

/**
 * Extract the client IP address from a Next.js request.
 * Respects X-Forwarded-For for deployments behind a proxy/load balancer.
 */
export function getClientIp(request: Request): string {
  const forwarded = (request.headers as any).get?.('x-forwarded-for');
  if (forwarded) {
    return forwarded.split(',')[0].trim();
  }
  return 'unknown';
}

// Re-export for convenience
export type { AuditLogEntry };
