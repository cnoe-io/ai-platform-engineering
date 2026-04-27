---
sidebar_position: 2
---

# Agent Forge Backstage Plugin

**Agent Forge** is a Backstage community plugin that adds an AI chat interface to your Internal Developer Portal, connecting to any [A2A (Agent-to-Agent) protocol](https://a2a-protocol.org/latest/) compatible agent — including CAIPE.

Published on npm: [`@caipe/plugin-agent-forge`](https://www.npmjs.com/package/@caipe/plugin-agent-forge)

Source: [cnoe-io/community-plugins — agent-forge workspace](https://github.com/cnoe-io/community-plugins/tree/main/workspaces/agent-forge)

## Key Features

- **A2A Protocol Support** — works with CAIPE or any A2A-compatible agent
- **OpenID Connect Authentication** — secure token-based auth with automatic expiration handling
- **Streaming Responses** — real-time agent response streaming
- **Session Management** — persistent chat sessions with context preservation
- **Multi-Agent Compatible** — configurable agent routing
- **Customizable UI** — branding, colors, bot name, initial suggestions

## Installation

From your Backstage root directory:

```bash
yarn --cwd packages/app add @caipe/plugin-agent-forge
```

### Configure App.tsx (New Frontend System)

```tsx
import agentForgePlugin from '@caipe/plugin-agent-forge/alpha';

const app = createApp({
  features: [
    // ... other features
    agentForgePlugin,
  ],
});
```

### Add Navigation

```tsx
import ChatIcon from '@material-ui/icons/Chat';

<SidebarItem icon={ChatIcon} to="agent-forge" text="Agent Forge" />;
```

## Configuration

Add to your Backstage `app-config.yaml`:

```yaml
agentForge:
  showOptions: true
  botName: Agent Forge
  botIcon: https://your-icon-url
  initialSuggestions:
    - 'What can you do?'
    - 'How do I configure agents?'
    - 'Help me with platform engineering tasks'
    - 'Show me the latest deployments'
```

## Connecting to CAIPE

Point the plugin to your running CAIPE supervisor endpoint. The plugin uses the A2A protocol for all agent communication. See [Getting Started](/getting-started/quick-start) for how to stand up a CAIPE instance.

## Resources

- [npm package](https://www.npmjs.com/package/@caipe/plugin-agent-forge)
- [community-plugins workspace](https://github.com/cnoe-io/community-plugins/tree/main/workspaces/agent-forge)
- [Example Backstage integration](https://github.com/suwhang-cisco/backstage-app/commit/9d33ad6175e2ed30a23310ccc9d44594d6b63a07)
