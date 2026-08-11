---
sidebar_position: 2
---

# GRID Production SLO, SLA, and Detector Review

Last reviewed: 2026-08-11

This document defines the recommended service-level program for GRID production and the review checklist for the current critical detectors:

- GRID PROD MongoDB Heartbeat
- GRID PROD Tome Agent Heartbeat
- GRID PROD OIDC Heartbeat
- GRID PROD UI Heartbeat
- GRID PROD MCP Server Heartbeats
- CAIPE Prod core service availability

The detector names are known, but their live Splunk Observability definitions are not checked into this repository. Treat the detector review below as the standard each live detector must satisfy before the GRID SLO/SLA program is certified.

## Service Tier

GRID production is a critical production platform. Operate it as a Tier 0/Tier 1 service:

- User-impacting full outage: P1
- Loss of authentication, core service, persistence, or agent execution: P1
- Degraded latency, partial MCP outage, or non-critical feature outage: P2 unless the aggregate user journey is failing
- Observability blind spots on a critical detector: P2, escalated to P1 when no alternate signal exists

## Availability Targets

| Service surface | SLO | Monthly error budget | SLA candidate | Measurement source |
|---|---:|---:|---:|---|
| GRID end-to-end user journey | 99.95% | 21.6 min | 99.9% | External synthetic: UI load, OIDC, chat submit, first response |
| CAIPE core service API | 99.95% | 21.6 min | 99.9% | External and in-cluster HTTP readiness plus A2A agent card |
| GRID UI | 99.95% | 21.6 min | 99.9% | Browser synthetic and static asset checks |
| OIDC authentication path | 99.95% | 21.6 min | 99.9% | Discovery, JWKS, auth redirect, token exchange |
| MongoDB primary read/write path | 99.99% | 4.3 min | 99.9% | Synthetic read/write heartbeat and cluster health |
| Tome agent execution path | 99.9% | 43.2 min | 99.5% | Agent health plus canary prompt completion |
| Critical MCP server fleet | 99.9% per critical MCP; 99.95% aggregate for required set | 43.2 min per MCP; 21.6 min aggregate | 99.5% | MCP health, tool-list, and tool-call canaries |
| Observability and alert delivery | 99.9% | 43.2 min | Internal only | Detector evaluation, PagerDuty delivery, notification channel delivery |

SLA candidates must be approved by product, legal, support, and customer-facing stakeholders before publication. The SLOs above are the internal operating targets and should be stricter than any external SLA.

## Candidate SLA Commitments

The following SLA package is suitable for stakeholder review. Do not publish it externally until the ownership, exclusions, and remedies are approved.

| Commitment | Candidate target | Notes |
|---|---:|---|
| Monthly GRID production availability | 99.9% | Measured from the end-to-end user journey synthetic, excluding approved planned maintenance |
| P1 support initial response | &lt;= 15 minutes | Customer-impacting full outage or loss of auth/core/persistence |
| P2 support initial response | &lt;= 1 hour | Material degradation or partial loss of critical capability |
| P3 support initial response | &lt;= 1 business day | Non-critical defect, question, or minor degradation |
| P1 update cadence | Every 30 minutes | Continue until mitigation or clear next update time |
| Planned maintenance notice | At least 5 business days | Emergency security maintenance may use shorter notice |
| Planned maintenance window | &lt;= 4 hours | Prefer zero-downtime deploys and rolling maintenance |
| Full outage RTO | &lt;= 4 hours | Restore the platform or provide a business-accepted workaround |
| MongoDB RPO | &lt;= 15 minutes | Must be backed by backup/restore and replication evidence |
| Security incident escalation | Immediate P1 | Follow security incident process and legal/comms requirements |
| Service credits/remedies | TBD by business owner | Must not be defined by engineering alone |

Suggested SLA exclusions:

- Customer-side network, browser, device, or identity configuration failures
- Customer-managed credentials, expired secrets, or revoked access outside GRID control
- Third-party provider outages when no contracted redundancy exists
- Approved planned maintenance within the communicated window
- Force majeure, malicious traffic, or abuse requiring protective throttling
- Preview, development, staging, or explicitly beta features

## Latency And Quality SLOs

| SLI | Target | Bad event definition |
|---|---:|---|
| UI first load p95 | &lt;= 3 seconds | Initial page cannot render or main bundle/API bootstrap exceeds threshold |
| Chat first-token p95 | &lt;= 8 seconds | User submits prompt but no streamed or visible response begins in time |
| Chat completion p95 | &lt;= 60 seconds for standard triage prompts | Final answer exceeds threshold or the stream stalls |
| Core API p95 latency | &lt;= 500 ms for health and metadata endpoints | HTTP 5xx/timeout or p95 breach |
| Core API p99 latency | &lt;= 2 seconds for non-LLM control-plane calls | HTTP 5xx/timeout or p99 breach |
| OIDC token exchange p95 | &lt;= 2 seconds | Token exchange, JWKS lookup, or discovery exceeds threshold |
| MongoDB heartbeat p95 | &lt;= 250 ms for read; &lt;= 500 ms for write | Probe succeeds but latency exceeds threshold |
| MCP tool-list p95 | &lt;= 2 seconds per MCP | Tool-list request fails or times out |
| Critical canary success rate | &gt;= 99.5% | Canary prompt/tool call returns error, timeout, malformed output, or auth failure |

## Reliability And Recovery SLOs

| Area | SLO | Notes |
|---|---:|---|
| P1 detection time | &lt;= 5 minutes | A critical synthetic or burn-rate detector must page within 5 minutes |
| P1 acknowledgement time | &lt;= 10 minutes | Measured from PagerDuty trigger to human acknowledgement |
| P1 mitigation target | &lt;= 60 minutes | Restore service or deploy a workaround |
| P1 customer/internal update cadence | Every 30 minutes | Continue until mitigated |
| RTO for full GRID outage | &lt;= 4 hours | Includes restore from infrastructure or dependency failure |
| MongoDB RPO | &lt;= 15 minutes | Validate from backup/replication policy, not assumed |
| Failed deployment rollback | &lt;= 30 minutes | Applies to production deploys causing P1/P2 impact |
| Change failure rate | &lt;= 10% monthly | Count prod deploys causing incident, rollback, or hotfix |
| Detector coverage | 100% of critical user journey components | UI, OIDC, core, agent, MCP, MongoDB |

## SLI Rules

Availability must be computed from valid probes:

```text
availability = good_events / valid_events * 100
```

Good events require the user-visible action to succeed within the SLO latency threshold. For heartbeat detectors, a TCP connection or pod liveness alone is not enough. The probe must validate the dependency behavior that GRID users need.

Planned maintenance may be excluded from SLA reporting only when it is announced, bounded, and approved. Planned maintenance should remain visible in internal SLO burn charts so reliability cost is still obvious.

## Detector Standards

Every GRID production detector must include:

- Exact owner team and escalation route
- Service, component, environment, and criticality tags
- SLI and SLO mapping
- Runbook link
- Dashboard link
- Alert severity policy
- No-data behavior
- Auto-resolution behavior
- Suppression or dependency policy to avoid duplicate pages during known upstream failures
- Evidence that the signal comes from at least one path outside the failing component

Recommended tags:

```text
service:grid
environment:prod
criticality:tier0
platform:caipe
slo:<slo-name>
component:<ui|oidc|core|agent|mcp|mongodb>
detector_type:<synthetic|heartbeat|burn-rate|latency|error-rate>
```

## Alert Policy

Use multi-window alerting for SLO burn and short-window alerting for hard-down dependencies:

| Severity | Trigger | Route | Expected action |
|---|---|---|---|
| Critical/P1 | End-to-end journey down for 2 consecutive probes, core/OIDC/MongoDB hard down, or fast burn &gt;= 14.4x over 5 minutes and &gt;= 6x over 30 minutes | PagerDuty primary on-call | Acknowledge in 10 minutes, mitigate in 60 minutes |
| High/P2 | Partial MCP outage, agent canary failure, slow burn &gt;= 3x over 2 hours, or repeated latency SLO breach | PagerDuty or urgent operations channel | Triage same business hour or on-call if user impact is active |
| Warning/P3 | Single missed heartbeat, latency warning, certificate expiry, nearing error-budget burn | Operations channel and backlog issue | Investigate before it becomes user-impacting |

Hard-down heartbeat pages should require consecutive failed evaluations to avoid flapping, but the total page delay for P1 paths must remain &lt;= 5 minutes.

## Detector Review Matrix

| Detector | SLO protected | Required live behavior | Review status |
|---|---|---|---|
| GRID PROD MongoDB Heartbeat | MongoDB primary read/write availability and RPO risk | Validate authenticated read and write against the production MongoDB path. Include replication/primary health, backup freshness, and latency thresholds. Page P1 if write path or primary availability fails for &lt;= 5 minutes. | Needs live detector export. A process-only or port-only heartbeat is insufficient. |
| GRID PROD Tome Agent Heartbeat | Tome agent execution availability and first-token SLO | Validate health endpoint and a low-cost canary prompt or agent-card request. Distinguish agent unavailable, LLM dependency failure, auth failure, and slow response. Page P1 only when the agent blocks the critical GRID journey; otherwise P2. | Needs live detector export. Heartbeat should prove functional execution, not just container liveness. |
| GRID PROD OIDC Heartbeat | Login and token issuance availability | Validate `.well-known/openid-configuration`, JWKS, authorization redirect, token exchange, and certificate expiry. Page P1 on failed token path; warn before certificate or metadata expiry. | Needs live detector export. Discovery-only checks do not cover user login. |
| GRID PROD UI Heartbeat | User-facing UI availability | Use browser synthetic from outside the cluster. Validate HTTP 2xx, JS/CSS assets, no fatal console errors, and chat input visibility. Include authenticated path when feasible. | Needs live detector export. Static homepage checks are partial coverage only. |
| GRID PROD MCP Server Heartbeats | Critical tool execution availability | Enumerate each critical MCP server, validate `/health` or equivalent, tool-list response, and one safe tool-call canary where possible. Aggregate fleet health without paging separately for every downstream failure. | Needs live detector export. Fleet detector must expose which MCP failed. |
| CAIPE Prod core service availability | End-to-end GRID and CAIPE API availability | Validate `/healthz`, `/readyz`, A2A agent card, streaming endpoint, and one low-cost request path. Page P1 on consecutive failures. Track 5xx rate, timeout rate, and latency burn. | Needs live detector export. Health-only checks do not prove chat path availability. |

## Detector Review Procedure

1. Export each detector by exact name from Splunk Observability.
2. Save detector JSON, SignalFlow program text, alert rules, teams, tags, and notification routes as review evidence.
3. Verify the detector with the Splunk MCP detector tools:
   - `retrieve__detectors__query` by exact name
   - `retrieve__detector_id` for the full definition
   - `validate__detector__definition` for program/rule validity
   - `retrieve__incidents__single__detector` for current incident state
4. Confirm each detector maps to one SLO row above.
5. Confirm alert rules page only for user-impacting conditions or fast SLO burn.
6. Confirm no-data handling is explicit and does not silently hide outages.
7. Confirm each alert has a runbook, dashboard, owner, and escalation route.
8. Run a controlled failure or synthetic dry-run where safe.
9. Record pass/fail and file follow-up work for every gap.

## Required Follow-Up Work

File these as `bd` issues when the CLI is available:

- Export the six GRID production detector definitions from Splunk Observability and commit sanitized review evidence.
- Add or update runbooks for UI, OIDC, core service, Tome agent, MCP fleet, and MongoDB failure modes.
- Add functional canaries where any detector is currently only checking liveness.
- Add SLO burn-rate detectors for the GRID end-to-end journey and CAIPE core service.
- Define the approved customer-facing SLA with product/legal/support stakeholders.
- Validate MongoDB backup freshness, restore test cadence, RPO, and RTO evidence.
- Add dashboard panels for SLO burn, detector coverage, incident MTTA/MTTR, and dependency health.

## Certification Gate

GRID production SLO/SLA readiness is complete only when:

- All six named detectors pass the review matrix.
- Every critical detector has an owner, runbook, dashboard, and notification route.
- End-to-end synthetic availability and SLO burn-rate alerting are live.
- MongoDB RPO/RTO evidence is documented from backup and restore tests.
- P1/P2 incident workflow is tested through PagerDuty.
- The external SLA is approved and published through the appropriate business process.
