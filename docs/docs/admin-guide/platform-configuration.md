---
title: Platform Configuration
description: Set CAIPE defaults and platform-wide release announcements.
---

# Platform Configuration

![Platform default configuration](/img/features/platform-configuration.svg)

Platform configuration provides defaults for users who have not made a
personal choice. It should not be used to override valid user preferences.

## Defaults

The Defaults page controls supported platform fallback values, including
default agents for connected surfaces.

Default-agent resolution is:

1. User default for the current surface
2. Persisted platform default
3. `DEFAULT_AGENT_ID` deployment fallback
4. No default; the user selects an accessible agent

Before choosing an agent as a platform default, confirm that intended users can
invoke it. A default does not grant `agent#use` access.

## Announcements

The Announcements page controls platform-wide release-note behavior. Users can
independently choose whether the release dialog opens after sign-in.

Keep announcement content deployment-neutral and free of secrets, private URLs,
user data, or internal incident details.

## Personal Versus Platform Settings

| Setting | Owner |
|---|---|
| Theme, typography, and gradient | Individual user |
| User default agents | Individual user |
| Release-note preference | Individual user |
| Platform fallback agent | Platform administrator |
| Platform announcement state | Platform administrator |
