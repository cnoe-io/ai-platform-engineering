# Release Notes: External Agentic Apps

## Highlights

- Added a generic Agentic Apps host for manifest-driven package import, installation, discovery, and proxied launch.
- Added PDP decisions, CAIPE-issued app-scoped tokens, and token grant metadata for proxied app and app-owned authorization requests.
- Added a generic webhook gateway with raw body preservation, header allowlists, body limits, PDP checks, and delivery records.
- Added a host-owned assistant context bridge for embedded apps.
- Added framework-neutral SDK helpers and a small React UI kit for external app developers.
- Externalized FinOps, Weather, and Agentic SDLC reference app manifests and added a generic external app seed/import script for local validation.
- Added health snapshots and admin audit filtering for operator traceability.

## Operator Notes

Set `AGENTIC_APPS_INSTALL_ENABLED=true`, configure MongoDB, add app IDs to `AGENTIC_APPS_ENABLED`, and set `AGENTIC_APP_<ID>_ORIGIN` per runtime. Use a dedicated `AGENTIC_APP_TOKEN_SECRET` in production.

## Compatibility

Legacy Agentic SDLC bookmarks remain available while the external reference runtime is adopted. Manifests are public and secret-free; runtime-specific configuration moves to environment variables or installation overrides.
