---
name: incident-postmortem-report
description: Produce a thorough incident post-mortem report after an outage or customer-impacting event. Covers executive summary, impact, detailed timeline, root cause, contributing factors, corrective and preventive actions, and lessons learned. Use when the user asks to write, draft, or complete a post-mortem, blameless review, or incident review document.
---

# Incident Post-Mortem Report

Guide the user through producing a **blameless**, audit-ready post-mortem suitable for engineering leadership, compliance, and future incident prevention.

## Instructions

### Phase 1: Scope and audience
1. Confirm **what incident** is in scope (ticket ID, time window, service, or free-text summary).
2. Identify **audience** (internal engineering only vs. includes executives or customers) and adjust depth of business impact language.
3. List **facts already known** vs. **gaps** that need research (logs, metrics, deploys, comms).

### Phase 2: Structure the report
Use the sections below in order unless the organization mandates a different template. Fill each section with concrete data; avoid vague statements.

1. **Executive summary** — 2–4 sentences: what broke, who was affected, how long, current status.
2. **Impact** — Quantify: duration, error rates, revenue/users affected if known, SLA breach yes/no.
3. **Timeline** — UTC timestamps, short event labels. Include detection, escalation, mitigation, full recovery.
4. **Root cause** — Single primary cause, explained clearly. Use **5 Whys** or equivalent if helpful.
5. **Contributing factors** — Environment, process, tooling, or communication issues that amplified impact (not blame).
6. **What went well** — Detection, runbooks, teamwork, rollback, comms.
7. **What went wrong** — Gaps in monitoring, deploy process, testing, on-call routing, documentation.
8. **Corrective actions** — Short-term fixes with owners and dates.
9. **Preventive actions** — Longer-term hardening (tests, SLOs, chaos, capacity).
10. **Lessons learned** — 2–5 bullet takeaways for the org.
11. **References** — Links to incidents, PRs, dashboards, chat threads (no secrets).

### Phase 3: Tone and quality bar
- **Blameless:** describe systems and processes, not individuals.
- **Specific:** numbers, tool names, versions, ticket keys.
- **Actionable:** every action item has an owner and a target date when possible.

## Output Format

Deliver the post-mortem as **Markdown** using this skeleton:

```markdown
# Post-Mortem: [short title]

| Field | Value |
|-------|-------|
| **Status** | Draft / Final |
| **Date** | YYYY-MM-DD |
| **Author(s)** | |
| **Incident ID(s)** | |

## Executive summary
[2–4 sentences]

## Impact
- **Duration:** …
- **Scope:** …
- **Customer / business impact:** …

## Timeline (UTC)
| Time | Event |
|------|-------|
| … | … |

## Root cause
[Clear explanation]

## Contributing factors
- …

## What went well
- …

## What went wrong
- …

## Action items
| Action | Type (corrective / preventive) | Owner | Target date |
|--------|--------------------------------|-------|-------------|
| … | … | … | … |

## Lessons learned
- …

## References
- …
```

## Examples

- "Write a post-mortem for yesterday's API outage from 14:00–16:30 UTC affecting checkout."
- "Draft a blameless incident review for INC-4521; we rolled back service X at 09:45."
- "Turn these notes from the war room into a formal post-mortem document."

## Guidelines

- If information is missing, **state assumptions explicitly** or list **open questions** instead of inventing facts.
- Align severity and customer-impact language with the org’s incident taxonomy if the user provides it.
- Do not include credentials, full PII, or unreleased security details in the body; redact or summarize.
- Prefer **UTC** for all times unless the user requests a specific timezone.
