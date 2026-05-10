---
sidebar_position: 2
sidebar_label: Specification
title: "2026-03-03: Share with Everyone"
---

# Share with Everyone

**Date**: 2026-03-03  
**Status**: Implemented  
**Type**: Feature Addition

## Summary

Added a "Share with everyone" option to conversation sharing, completing the three-tier sharing model: individual users, teams, and everyone. Owners can toggle a conversation's visibility to make it accessible to all authenticated users in the organization with full read and write access (same access level as user/team sharing).

## Motivation

Conversation sharing was limited to specific users (by email) or teams (by team ID). There was no way to make a conversation broadly visible to the entire organization. The `is_public` field existed in the sharing schema but was not wired through the API or UI, leaving it permanently `false`.

Common use cases that required this:
- Sharing best practices and solutions organization-wide
- Incident post-mortem conversations
- Onboarding materials and reference conversations
- Cross-team knowledge sharing without managing individual access

## Testing Strategy

- **19 new tests** in `chat-sharing-public.test.ts`:
  - Access control: public grant, deny, owner bypass, skip-teams optimization (5 tests)
  - API POST: toggle on/off, standalone, combined with users, validation, owner-only, response, auth (9 tests)
  - API GET: returns is_public state true/false (2 tests)
  - Query inclusion: conversations listing, shared listing with exclusions (3 tests)
- **2 updated tests** in existing `chat-sharing-teams.test.ts` for new query conditions

## Related

- Spec: [share-with-everyone](../088-share-with-everyone/spec.md)
- Related ADR: [2026-01-30-admin-dashboard-teams-management](../052-admin-dashboard-teams-management/architecture.md)
- Branch: `prebuild/feat/share-with-everyone`

- Architecture: [architecture.md](./architecture.md)
