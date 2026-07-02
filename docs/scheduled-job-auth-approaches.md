# Scheduled Job Auth Approaches

## Problem

Scheduled Dynamic Agent runs need to behave like the schedule owner ran the agent, while still being clearly identifiable as automated scheduled jobs.

The runner authenticates with a shared scheduler token and deliberately sends no trusted owner identity. That is enough for the UI/BFF to recognize the request, but Dynamic Agents still requires a validated user bearer. Without the BFF token-exchange step, the failure appears as:

```text
Bearer token is required
code=missing_bearer
```

## Constraints

- Schedule ownership is immutable.
- The schedule owner must be loaded from the schedule record, not trusted from the runner request.
- If the owner loses agent/team/tool access, the scheduled run should fail just like an interactive user run would fail.
- The run must remain auditable as a scheduled job, with schedule id and run id.
- We should avoid DA-side auth bypasses if a cleaner identity model fits the existing stack.

## Approach 1: First-Class Delegated Execution

In this model, the scheduler service account is the authenticated actor, and the schedule owner is the effective subject.

Conceptual decision shape:

```text
actor: service_account:caipe-scheduler-runner
delegation: schedule:sched_x
effective_subject: user:<owner_sub>
resource: agent:<agent_id>
action: use
```

The authz service would explicitly answer: "Can this service account execute this schedule on behalf of this owner for this agent/tool?"

### Pros

- Most precise audit model: actor and effective user are both first-class.
- Least ambiguous security model for automation.
- Does not require minting user tokens.
- Gives us a real `schedule` authorization resource for future controls like pause, transfer, team-owned schedules, or admin delegation.
- Makes it clear that the scheduler service account is allowed to execute schedules, not broadly use every agent/tool.

### Cons

- This concept does not really exist today for schedules.
- CAS currently enforces subject binding: callers normally evaluate only their own subject. A scheduler service account cannot naturally ask "can user X use agent Y?" without a new delegated decision path.
- DA currently expects a bearer token whose subject is the user being authorized. This model would require DA/CAS to understand actor vs effective subject.
- Tool and credential resolution would need to consistently use the effective user, while audit still records the service account actor.
- Larger implementation and migration surface.

### Best Fit

This is the cleanest long-term model if scheduled automation becomes a broad platform primitive with its own RBAC, shared/team schedules, transfer workflows, and rich audit requirements.

## Approach 2: Keycloak OBO / Impersonation User Token

In this model, the scheduler authenticates as a Keycloak service account, then the platform mints a valid owner-user bearer token for the scheduled run.

Flow:

1. Cron runner authenticates to the BFF with the shared scheduler token.
2. Runner sends `schedule_id`, a generated conversation id, and run metadata.
3. The BFF loads the schedule from DB and resolves its immutable owner and agent.
4. The BFF authenticates to Keycloak as `caipe-scheduler-runner` and requests an owner-user token using token exchange / impersonation.
5. The BFF proxies to DA with `Authorization: Bearer <owner-user-token>`.
6. The BFF stamps `client_context.source=scheduler`, `schedule_id`, `run_id`, and `actor_client_id`.
7. DA and CAS run existing checks as the owner user.

### Pros

- Matches the desired semantics: scheduled run behaves like the owner ran it.
- Fits the existing DA/CAS subject-binding model, because the bearer subject is the effective user.
- Existing `agent#use` checks continue to work without a DA auth bypass.
- Existing tool and credential paths are more likely to work naturally, because they already expect user-scoped identity.
- If the owner loses team/agent/tool access, the run fails at the same gates as an interactive run.
- Smaller change than inventing schedule delegation in CAS/DA.

### Cons

- Keycloak impersonation/token-exchange is powerful and must be tightly scoped.
- The scheduler service account must not be allowed to impersonate arbitrary users for arbitrary reasons.
- Audit can become misleading unless we always persist scheduled-run metadata and ideally include an actor claim such as `act.sub=scheduler-service-account`.
- We must ensure the target user always comes from the schedule record, never from runner-supplied request fields.
- User disable/deprovision cases must fail closed.
- Keycloak setup and chart values become more important: client permissions, token exchange, audience, and secrets all need to be correct.

### Best Fit

This is the best fit for the current codebase if the product requirement is "run exactly as the schedule owner, with current owner permissions." It preserves existing DA/CAS checks and avoids adding a partial delegated-authz model.

## Rejected Variant: Trusted Header Pretending

This would mean the runner or UI sends `X-CAIPE-User` / `X-User-Context` and DA accepts that as the user without a valid user bearer.

### Why Not

- It already fails against the current DA bearer-required authz path.
- It weakens the identity boundary between UI and DA.
- It encourages bypass logic in DA for scheduled jobs.
- It can drift away from normal user-run behavior, especially for AgentGateway and MCP credential flows that rely on bearer identity.

## Final Verdict

Use **Approach 2: Keycloak OBO / impersonation user token** as the best architecture for the stated product semantics.

It is the most architecturally consistent design because the intended behavior is owner-runs-as-self: the scheduled run should exercise the schedule owner's current permissions exactly like an interactive owner run. Scheduled runs should authenticate the machine actor first, resolve the immutable owner from the schedule record, mint a valid owner-user token, and then run through the same DA/CAS/tool checks as an interactive user run.

Required guardrails:

- The runner sends `schedule_id`; runner-supplied owner and agent identity are ignored.
- The owner and agent are resolved only from the schedule DB record.
- The scheduler service account is scoped only for scheduled execution token exchange.
- All runs persist `source=scheduler`, `schedule_id`, `run_id`, and the actor client id.
- If token exchange fails, owner is disabled, or owner lacks current access, the run fails closed.
- Do not add a DA scheduled-run auth bypass; it would create a parallel authorization path instead of preserving normal user-run semantics.

Approach 1 remains the better future model if schedule RBAC grows beyond "immutable owner runs as self."
