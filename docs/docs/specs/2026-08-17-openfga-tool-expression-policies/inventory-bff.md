---
sidebar_label: BFF Inventory
title: Current BFF Authorization Inventory
description: Frozen behavior and ownership inventory used for caipe-authz migration comparisons.
---

# Current BFF Authorization Inventory

## Enforcement boundary

| Item | Current behavior | Migration owner |
|---|---|---|
| Public API | `ui/src/lib/authz/index.ts` | BFF migration router |
| Runtime engine | In-process TypeScript OpenFGA adapter | `caipe-authz` HTTP |
| Policy writes | In-process OpenFGA admin adapter | `caipe-authz` policy API |
| Audit | BFF emits `cas_decision` and `cas_grant` | Authz outbox and Audit Service |
| Subject binding | BFF session/service-account identity | BFF PEP; Authz revalidates |

## Decision semantics

- Requests are `(subject, resource, action, trusted context)`.
- `ALLOW` uses reason `OK`; a missing tuple uses `NO_CAPABILITY`.
- OpenFGA errors, an open circuit, and excess half-open probes fail closed as
  `AUTHZ_UNAVAILABLE`.
- Workflow delegation is a server-owned pre-check before OpenFGA.
- Batch evaluation uses ten workers and emits one audit record per item.
- Reads are cached for 15 seconds; writes for 2 seconds; transient failures are
  never cached. Grant and revoke clear the whole decision cache.
- Store discovery is cached until an OpenFGA 404. `OPENFGA_STORE_ID` bypasses
  discovery.

## Action mapping

| Action | Check relation | Write relation |
|---|---|---|
| discover | can_discover | reader |
| read | can_read | reader |
| use | can_use | user |
| write | can_write | writer |
| create | can_manage | owner |
| delete | can_delete | manager |
| manage | can_manage | manager |
| administer | can_admin | manager |
| audit | can_audit | auditor |
| approve | can_approve | approver |
| share | can_share | sharer |
| call | can_call | caller |
| invoke | can_invoke | invoker |
| map | can_map | manager |
| ingest | can_ingest | ingestor |
| read-metadata | can_read_metadata | metadata_reader |

## Migration invariants

- `LEGACY` and `SHADOW` return the existing BFF result.
- `CANARY`, `AUTHZ`, and `AUTHZ_ONLY` never fall back from Authz failure to a
  legacy allow.
- Public request bodies cannot choose provider, mode, cohort, or revision.
- Existing `/api/authz/v1` endpoint contracts remain stable through retention.
