# Production safety

## Preconditions

- The operator explicitly approved the target and test scope.
- Admin and non-admin identities are distinct and authenticated.
- Both subjects are confirmed members of the configured shared team through OpenFGA. Resolve an OIDC group/display name through the Teams API and use its canonical `slug` in tuple objects.
- System health is green and OpenFGA tuple reads plus CAS decisions are available.
- A harmless MCP endpoint is supplied when tool invocation is enabled.
- The run can delete every resource type it creates, including TOME pages,
  gists, generated ingest pages, projects, and document tuples.

## Fixture rules

- Prefix every resource with `grid-tap-<release>-<run-id>`.
- Generate neutral fixture content; keep deployment identities in runtime environment only.
- Store created IDs in test attachments and the cross-mode run manifest before
  making dependent writes.
- Never mutate an object absent from the current manifest.
- Use a marker credential that grants no access to an external system.
- Do not connect or disconnect an existing OAuth provider.
- Make global fixtures last and revoke global access immediately.

## Stop conditions

Return `BLOCKED` before writes when identity, team, OpenFGA, safe endpoint, or cleanup checks fail. Return `FAIL` and start cleanup immediately for:

- an unauthorized ALLOW decision;
- a missing required tuple or surviving stale tuple;
- a raw secret appearing in UI/API output;
- a private object visible to the non-owner;
- a cleanup operation that cannot be verified.

## Cleanup

Cleanup runs in reverse dependency order: chats, TOME gists/pages, TOME
projects, agents, MCP tools, data sources/KBs, MCP servers, credentials. For
TOME, discover agent-generated pages before deleting the project. After
deletion, assert that resource reads fail, run-prefixed project discovery is
empty, and object-scoped OpenFGA tuple queries return no fixture tuples.
