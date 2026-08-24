---
title: Metrics & Health
description: Monitor CAIPE services, dependencies, runtime metrics, and build information.
---

# Metrics & Health

![CAIPE build information and platform capability health](/img/features/operations.svg)

The Metrics & Health area provides a shared operational view for authorized
administrators.

## Metrics

The Metrics page can combine BFF statistics, agent and workflow counters,
authorization metrics, and Prometheus-backed charts. Prometheus sections appear
only when `PROMETHEUS_URL` is configured and reachable by the server.

Use metrics for trend and saturation analysis. Use logs, traces, and health
details to diagnose an individual failure.

## Health

The Health page probes configured platform services and dependencies. A result
can be:

- **Healthy** — the probe completed successfully
- **Degraded** — the service responded but reported a partial problem
- **Down** — the configured service failed its probe
- **Disabled** — the component is intentionally not configured

Disabled is not equivalent to down and should not make optional deployments
appear unhealthy.

Health can cover the UI/BFF, Dynamic Agents, database, identity, authorization,
AgentGateway, RAG, ingestion, audit, and integration services, depending on the
deployment.

## Build Information

Build information identifies the running UI version, commit, and build time
when supplied by the image build. If a semantic release version is unavailable,
the UI should use the commit SHA without adding a `v` prefix.

Component versions can differ during a rolling deployment. Verify the relevant
component row before concluding that a fix is present.

## Response Workflow

1. Refresh once to rule out a transient client error.
2. Identify the first required component that is degraded or down.
3. Confirm configuration and network reachability from the probing service.
4. Correlate logs, metrics, traces, and recent deployments.
5. Apply remediation and wait for the automatic or manual health refresh.
