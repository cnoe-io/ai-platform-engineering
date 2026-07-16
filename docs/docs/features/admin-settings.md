---
sidebar_position: 3
---

# Settings Center and Admin Settings

CAIPE keeps personal preferences and platform configuration in one routed
Settings Center while clearly separating their scope.

Open it from:

- **Profile picture → Settings** for personal settings.
- The **Appearance** shortcut in the application header.
- The **Platform** group inside the Settings Center for admin-only settings.

## Settings Map

| Scope | Route | Purpose |
|---|---|---|
| Personal | `/settings/appearance` | Theme, typography, and accent gradient |
| Personal | `/settings/chat` | Per-surface default agents and chat behavior |
| Personal | `/settings/notifications` | Personal release-note notifications |
| Personal | `/settings/access` | Your identity, platform role, and teams |
| Personal | `/settings/developer` | Debug preferences and session diagnostics |
| Platform | `/settings/platform/defaults` | Fallback agent for users without a personal choice |
| Platform | `/settings/platform/access` | Starting access before Slack or Webex identity linking |
| Platform | `/settings/platform/announcements` | Platform-wide release announcements |
| Platform | `/settings/platform/ai-review` | AI review policies |

Platform routes and their navigation group are visible only to admins. The
Admin Dashboard manages resources such as users, teams, agents, skills,
credentials, integrations, metrics, health, and policy; it does not duplicate
Settings Center controls or show redirect panels.

## Saving Changes

Single-setting controls save when you interact with them:

- The control updates immediately.
- An inline status reports **Saving**, **Saved**, or an actionable error.
- Failed server-authoritative changes roll back and can be retried.
- Web, Slack, and Webex default-agent choices save independently.

Multi-field policy and access forms keep an explicit review/apply action. A
quiet inline status replaces repetitive success notifications.

## Platform Default Agent

The platform default applies only when a person has not chosen a personal
default. Choosing one makes that agent available to every signed-in user, so
CAIPE explains the consequence and asks for confirmation before persisting it.

Resolution order:

1. A person's default for the current surface.
2. The persisted platform default.
3. The `DEFAULT_AGENT_ID` deployment fallback.
4. No default agent; the user chooses an accessible agent.

If the configured agent is missing or no longer visible, the Settings Center
shows a warning. Choose another agent or remove the platform default.

## Access Control

- Any signed-in user can manage personal preferences and inspect their own
  account and access information.
- Only admins can open or change platform settings.
- Read-only admin simulation does not expose platform editing actions.
- Sensitive session and token values remain concealed until explicitly opened.

## Related Pages

- [UI customization and branding](../ui/customization.md)
- [Custom agents](./custom-agents.md)
- [RBAC architecture](../security/rbac/architecture.md)
