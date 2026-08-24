---
title: Teams & Users
description: Manage CAIPE identities, roles, team membership, and shared resource access.
---

# Teams & Users

![Privacy-safe Teams and Users administration preview](/img/features/teams-users.svg)

Teams provide the primary ownership and sharing boundary for CAIPE resources.
User identity originates from the configured identity provider; CAIPE stores
the platform relationships needed for authorization.

## Users

The Users page supports:

- Search and paginated user discovery
- User and activity summaries
- Platform and resource-role inspection
- Team membership review and management
- Effective resource access review
- Identity details and account resolution

Use the user detail view to diagnose access. Do not add an organization-wide
role when a team relationship or individual resource grant is sufficient.

## Teams

The Teams page supports:

- Create, inspect, update, and archive teams
- Add or remove members and team administrators
- Review owned and shared agents, skills, workflows, tools, and knowledge bases
- Grant knowledge search, ingest, and automation capabilities
- Assign Slack channels and Webex spaces
- Reconcile team relationships with OpenFGA

Archived teams grant no access. Archiving preserves history while removing
active grants; confirm downstream ownership before archiving a team.

## Membership Sources

Membership can be managed manually or synchronized from an identity source.
The UI identifies synchronized teams and their source when that information is
available. Avoid manually fighting a directory-managed membership: the next
sync can restore the directory state.

## Identity Sync

The Identity Sync page appears when a supported directory connector is
configured and the current admin has the identity-sync gate. It provides:

- Connector status and settings
- Manual synchronization trigger
- Run history and outcomes
- Directory-backed team and membership reconciliation

Treat removal carefully. A missing directory group can archive the mapped team
and remove the access granted through it.

## Troubleshooting Access

If a user can sign in but cannot use a resource:

1. Confirm the canonical user identity.
2. Confirm team membership and whether it is manual or synchronized.
3. Inspect the resource's owner and sharing relationships.
4. Check the specific action in Access Explorer.
5. Run the relevant self-check or reconciliation only after identifying drift.
