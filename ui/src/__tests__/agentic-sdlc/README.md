# Ship Loop Tests

Jest tests for the Agentic SDLC Ship Loop feature.

Run only this suite: `npm test -- ship-loop` from `ui/`.

Coverage focus per `tasks.md`:

- **Security/correctness seams**: toggle gate, HMAC verify, stage resolver, async worker idempotency, authz failure modes, sanitizer, assistant read-only enforcement.
- **Integration**: onboarding flow, per-Epic view + SSE, portfolio aggregation, HITL action round-trips, velocity math + cost masking.
