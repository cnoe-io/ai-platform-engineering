---
sidebar_position: 3
---

# Settings and Admin

CAIPE separates configuration from platform operations:

- **Settings** opens as a dialog over the current page. It contains personal
  preferences and the small set of platform-wide preferences available to
  admins.
- **Admin** is a routed workspace for managing people, resources,
  integrations, operations, and security policy.

Open Settings from **Profile picture → Settings**. The Appearance shortcut in
the application header opens the same dialog directly at Appearance. Closing
the dialog returns you to the page where you opened it.

## Settings map

### Personal

- **Appearance** — theme, typography, and accent gradient.
- **Chat & agents** — per-surface default agents and conversation behavior.
- **Notifications** — personal release-note notifications.
- **Account & access** — your identity, platform role, and teams.
- **Developer** — debug preferences and session diagnostics.

### Platform settings

Admins also see:

- **Defaults** — fallback agent for people without a personal choice.
- **Announcements** — platform-wide release announcements.

AI Review and access-before-sign-in policy remain in **Admin → Security &
Policy** because they are governance and access-management workflows.

## Admin map

Admin opens at **Teams & Users → Users**. Its category buttons disclose their
destinations without navigating, allowing an administrator to choose the exact
page before leaving the current one.

- **Resources** — agent configuration, Skill Hubs, service accounts, and
  credential administration.
- **Teams & Users** — users, teams, and identity sync.
- **Integrations** — Slack and Webex administration.
- **Insights** — statistics and feedback.
- **Metrics & Health** — operational metrics, health, and authorization
  insights.
- **Security & Policy** — access policy, AI Review, authorization tools,
  audits, identity health, and migrations.

## Saving changes

Single-setting controls save when you interact with them:

- The control updates immediately.
- An inline status reports **Saving**, **Saved**, or an actionable error.
- Failed server-authoritative changes roll back and can be retried.
- Web, Slack, and Webex default-agent choices save independently.

Multi-field policy and access forms retain an explicit review/apply action.

## Platform default agent

The platform default applies only when a person has not chosen a personal
default. Choosing one makes that agent available to every signed-in user, so
CAIPE explains the consequence and asks for confirmation before persisting it.

Resolution order:

1. A person's default for the current surface.
2. The persisted platform default.
3. The `DEFAULT_AGENT_ID` deployment fallback.
4. No default agent; the user chooses an accessible agent.

If the configured agent is missing or no longer visible, Settings shows a
warning. Choose another agent or remove the platform default.

## Access control

- Any signed-in user can manage personal preferences and inspect their own
  account and access information.
- Only admins can see or change Platform settings.
- Admin View as remains read-only for operational and policy controls.
- Sensitive session and token values remain concealed until explicitly opened.

## Related pages

- [UI customization and branding](../ui/customization.md)
- [Custom agents](./custom-agents.md)
- [RBAC architecture](../security/rbac/architecture.md)
