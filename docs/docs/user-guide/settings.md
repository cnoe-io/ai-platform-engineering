---
title: Personal Settings
description: Configure CAIPE appearance, chat defaults, notifications, account access, and diagnostics.
---

# Personal Settings

Open **Settings** from the application navigation. Personal settings save to
the signed-in account when persistent storage is available and can use a local
browser cache while the server loads.

![Appearance and theme preferences](/img/features/settings.svg)

## Appearance

Choose:

- Font size
- Font family
- System or named color theme
- Accent gradient

Changes apply immediately and save independently. A load failure leaves the
device-cached appearance active and displays a warning.

## Chat & Agents

Choose a default agent independently for supported surfaces such as Web, Slack,
and Webex. CAIPE resolves a new conversation in this order:

1. The user's default for the current surface
2. The persisted platform default
3. The deployment's `DEFAULT_AGENT_ID`
4. Manual selection of an accessible agent

Conversation preferences in this section control optional chat behavior
exposed by the deployment.

## Notifications

The released Notifications section controls release-note announcements shown
after sign-in and provides a way to reopen the current release notes.

Browser completion alerts and sounds are not part of the current released
notification settings.

## Account & Access

Review:

- Platform role
- Connected identity and Slack-link status
- Team memberships and team roles
- Identity-provider and realm-role diagnostics

This page is read-only. Administrators change membership and policy from the
Admin workspace or the configured identity directory.

## Developer

Developer settings expose debug logging, OIDC session lifetime, token refresh,
identity claims, and runtime diagnostics.

Access tokens are sensitive. Copy one only for a trusted local diagnostic
workflow, never into an issue, chat, recording, or screenshot.
