# Database Migration: Configurable Audit Log Storage Backend

## Status: No-op

This feature does **not** require any MongoDB schema changes, index creation, data movement, or DDL.

## What changes

When `AUDIT_LOG_BACKEND=local` or `AUDIT_LOG_BACKEND=s3` is set, new audit events stop flowing into MongoDB. Existing documents in `audit_events`, `authorization_decision_records`, and `credential_audit_events` are untouched.

## Migration path (operator-driven, out of scope for this feature)

Once the new backend is live and operators wish to remove historical audit data from MongoDB, the following steps apply:

1. Verify the new backend is receiving events (check local path or S3 objects).
2. Export any audit records needed for compliance using the existing CSV export UI.
3. Drop the audit collections:
   ```js
   db.audit_events.drop()
   db.authorization_decision_records.drop()
   db.credential_audit_events.drop()
   ```
4. Optionally remove the indexes created by `audit_logger.py` and `mongodb.ts`.

## Rollback

To revert to MongoDB: unset `AUDIT_LOG_BACKEND` (or set it to `mongodb`) and restart. MongoDB write-path resumes immediately. No data is lost in MongoDB — it was never deleted by this feature.
