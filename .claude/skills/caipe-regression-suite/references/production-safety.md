# Production safety

## Preconditions

- The operator explicitly approved the target and test scope.
- Admin and non-admin identities are distinct and authenticated.
- Both subjects are confirmed members of the configured shared team through OpenFGA. Resolve an OIDC group/display name through the Teams API and use its canonical `slug` in tuple objects.
- System health is green and OpenFGA tuple reads plus CAS decisions are available.
- A harmless MCP endpoint is supplied when tool invocation is enabled.
- The run can delete every resource type it creates.

## Fixture rules

- Do not deploy or upgrade components, synchronize deployment controllers, publish authorization models, run migrations, or modify environment configuration. Treat incompatibility as a test result.
- Prefix every resource with `caipe-regression-suite-<release>-<run-id>`.
- Generate neutral fixture content; keep deployment identities in runtime environment only.
- Store created IDs in test attachments and the run manifest.
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

Cleanup runs in reverse dependency order: chats, agents, MCP tools, data sources/KBs, MCP servers, credentials. After deletion, assert that resource reads fail and object-scoped OpenFGA tuple queries return no fixture tuples.
