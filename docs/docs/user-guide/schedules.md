---
title: Schedules
description: Manage recurring and one-time Dynamic Agent jobs.
---

# Schedules

Schedules send a saved message to a Dynamic Agent at a recurring cron time or
through a one-time run. The navigation item requires:

![Scheduled Dynamic Agent jobs](/img/features/schedules.svg)

- MongoDB-compatible persistent storage
- Dynamic Agents enabled
- `SCHEDULER_ENABLED=true`
- User eligibility when `SCHEDULER_ADMIN_ONLY=true`

## Scheduled Job Contents

Each scheduled job records:

- Target agent
- Display title
- Message template and optional attributes
- Cron expression and timezone
- Enabled or paused state
- Version and change history
- Recent run status
- Associated one-time runs

## Manage a Job

From **Schedules**, you can:

- Inspect the next recurring behavior in human-readable form
- Pause or restart future scheduled runs
- Change the title, cron expression, timezone, or message
- Review changes and restore an earlier version
- Open a chat with the configured schedule-editor agent
- Inspect one-time execution status and retry information
- Delete a schedule

Pausing the parent schedule also prevents active one-time work that depends on
the parent being enabled.

## Timezones and Cron

Use an explicit IANA timezone such as `Etc/UTC` or `America/New_York`. Confirm
daylight-saving behavior before scheduling operational changes. The displayed
next-run description is a convenience; the stored cron and timezone are the
authoritative values.

## Access

Users see schedules owned by their account or otherwise exposed by policy.
The target agent must remain usable at execution time. Disabling or unsharing
the target agent can cause later scheduled runs to fail.
