# JWT and OpenFGA in CAIPE

This is the short version of how authentication and authorization fit together.

## The Split

**Keycloak issues JWTs.** A JWT proves who the caller is, who issued the token, when it expires, and which coarse bootstrap roles or request context apply.

**OpenFGA answers relationship questions.** OpenFGA decides whether a subject can use, manage, read, call, or administer a resource by checking stored relationship tuples.

The JWT does not carry the OpenFGA relationship graph. OpenFGA does not mint JWT claims.

## What the JWT Carries

A Keycloak access token is a signed identity badge. Services validate it with Keycloak's JWKS public keys and reject it if the signature, issuer, audience, or expiry is wrong.

Important claims:

| Claim | Purpose |
|---|---|
| `iss` | Keycloak realm that issued the token. |
| `sub` | Stable Keycloak user ID. This becomes the OpenFGA subject as `user:<sub>`. |
| `email` / `name` | Display and audit identity. |
| `realm_access.roles` | Coarse bootstrap/global roles such as `chat_user`, `admin`, or `admin_user`. |
| `active_team` | Current team context selected for the request, usually a team slug or `__personal__` for personal mode. |
| `act.sub` | Delegation actor on OBO tokens, for example Slack bot acting on behalf of a user. |

The `active_team` claim is added by Keycloak only when the caller requests a matching optional client scope such as `team-platform` or `team-personal`. That claim tells downstream services which team context is active; it is not itself proof of every resource grant.

## What OpenFGA Stores

OpenFGA stores tuples such as:

```text
user:alice-sub member team:platform
team:platform#member can_use agent:incident-agent
team:platform#member can_call tool:jira_*
slack_channel:T123:C456 can_use agent:incident-agent
```

When a request arrives, CAIPE builds a check from the verified JWT and request context:

```text
subject:  user:<jwt.sub> or team:<active_team>#member
relation: can_use / can_manage / can_call / can_read
object:   agent:<id> / tool:<prefix> / knowledge_base:<id>
```

OpenFGA validates that check against stored tuples. It does not trust role names inside the JWT as resource grants.

## Why We Are Removing Resource Roles

Older CAIPE paths encoded resource grants as Keycloak realm roles, for example:

```text
agent_user:incident-agent
tool_user:jira_*
kb_admin:some-kb
task_user:daily-report
skill_admin:publisher
```

Those are now migration artifacts. They are hard to scale, noisy in user management, and duplicate OpenFGA. New and migrated flows should write OpenFGA relationships instead.

Keep only coarse Keycloak roles for identity and bootstrap:

- `chat_user` for baseline product access.
- `admin` / `admin_user` for platform administration.
- Temporary compatibility roles only where an older code path still needs them.

Team membership is also moving to OpenFGA:

```text
user:<sub> member team:<slug>
```

The temporary `team_member:<slug>` realm role should disappear after all older team-context checks read OpenFGA or Mongo-backed membership sources instead of JWT roles.

## Request Flow

1. User signs in through Keycloak.
2. Keycloak issues a signed JWT.
3. CAIPE services validate the JWT locally with JWKS.
4. The service derives an OpenFGA subject from `sub` or from `active_team`.
5. AgentGateway, the Web UI backend, Slack bot, or RAG server asks OpenFGA for the resource decision.
6. OpenFGA allows only if a matching tuple path exists.

In short: **JWT proves identity; OpenFGA proves access.**
