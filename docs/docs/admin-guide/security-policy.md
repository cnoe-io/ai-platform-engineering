---
title: Security & Policy
description: Administer CAIPE access policy, approvals, audits, diagnostics, and migrations.
---

# Security & Policy

![Access-before-sign-in policy administration](/img/features/security-policy.svg)

Security & Policy contains governance and diagnostic workflows. Visibility is
authorization-gated, and most destinations have their own action checks.

## Policy

### Access Before Sign-in

Control the minimal starting behavior for unlinked Slack and Webex callers.
Prefer no access or narrowly scoped public agents. Linking an identity should
transition the caller to their normal CAIPE policy relationships.

### AI Review

Configure review policies applied to AI-generated changes. Review policy is a
guardrail; it does not replace provider permissions, repository protections, or
human accountability.

## Authorization

### RBAC Audit

Review authorization mutations and administrative actions. Use it to answer
who changed a relationship, what changed, and when.

### Approvals

Review pending publication requests and request history. Approval should be
based on the proposed audience, ownership, and content risk—not solely on the
requester's platform role.

### Access Explorer

Inspect effective relationships and run action checks for a user, team, and
resource. This is the preferred first stop for an unexpected permission result.

### Self Check

Validate baseline authorization configuration and run focused tests. Self-check
is diagnostic and should not silently rewrite policy.

## Audit

Chat Audit provides retained conversation activity and message records when
the audit backend is enabled. Access to audit content should be narrower than
ordinary platform administration and follow the deployment's retention policy.

## Identity and Maintenance

### Keycloak

Review identity-provider migration and compatibility health when Keycloak
migration support is configured.

### Migrations

Plan, apply, and monitor schema and relationship migrations. Review the plan
before applying it, preserve backups, and do not run multiple migration writers
against the same environment.

## Related Documentation

- [Security overview](../security/index.md)
- [RBAC feature guide](../security/rbac/feature-guide.md)
- [RBAC architecture](../security/rbac/architecture.md)
- [Authentication flow](../security/auth-flow.md)
