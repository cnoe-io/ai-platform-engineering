---
title: Integrations
description: Configure and govern CAIPE Slack and Webex integrations.
---

# Integrations

![Messaging integration administration](/img/features/integrations.svg)

CAIPE can deliver agent experiences through Slack and Webex in addition to the
Web UI and CLI. Integration administration controls where the bot operates,
which team owns the space, and which resources callers can use.

## Slack

Depending on integration mode and authorization, administrators can:

- Discover available channels and linked users
- Onboard or remove configured channels
- Assign an owning CAIPE team
- Select service-account and routing behavior
- Grant channel resources
- Configure defaults and emoji behavior
- Inspect channel access diagnostics
- Inspect runtime status, synchronize configuration, and request reload

## Webex

The Webex administration surface provides corresponding operations for spaces,
bots, direct users, routing, team ownership, resource grants, diagnostics, and
runtime synchronization.

## Identity Linking

Linked users act with their CAIPE identity and policy relationships. Unlinked
callers use the explicitly configured pre-sign-in policy and should receive
minimal initial access.

## Safe Onboarding

1. Create or select the owning team.
2. Onboard the channel or space.
3. Confirm service-account and route configuration.
4. Grant only the required agents and resources.
5. Run the access diagnostic as a representative caller.
6. Review audit events after the first production interaction.

## Related Documentation

- [Slack Bot](../integrations/slack-bot.md)
- [Slack authorization](../architecture/slack-bot-authorization.md)
- [Webex Bot](../integrations/webex-bot.md)
- [Webex integration API](../api/webex-integration.md)
