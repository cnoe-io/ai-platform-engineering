---
sidebar_position: 6
---
# 🖥️ User Interfaces

The CAIPE Multi-agent Systems provide robust user interfaces that facilitate seamless interaction between agents using the Agent-to-Agent (A2A) protocol. These interfaces are designed to support secure communication and collaboration among agents, leveraging OAuth for authentication to ensure data integrity and privacy.

These interfaces empower users to build and manage sophisticated multi-agent systems with ease and security.

> **Note:** Authorization and scope validation are currently handled by MCP servers. Additional details regarding this process will be provided in future updates.

## CAIPE CLI

CAIPE CLI is a dedicated TypeScript/Bun terminal client for interactive chat with CAIPE server agents via the A2A and AG-UI streaming protocols.

**Install:**

```bash
curl -fsSL https://raw.githubusercontent.com/cnoe-io/ai-platform-engineering/main/cli/install.sh | sh
```

**Or via npm:**

```bash
npm install -g caipe
```

**Quick start:**

```bash
caipe config set server.url https://your-caipe-server.example.com
caipe auth login
caipe
```

See the full [CAIPE CLI documentation](../../cli/README.md) for commands, configuration, and development instructions.



## CAIPE UI (Standalone UI)

<div style={{paddingBottom: '56.25%', position: 'relative', display: 'block', width: '100%'}}>
	<iframe src="https://app.vidcast.io/share/embed/ea0b5c51-2d25-4e6b-904d-d13dc0d2fb92?mute=1&autoplay=1&disableCopyDropdown=1" width="100%" height="100%" title="CAIPE UI Demo" loading="lazy" allow="fullscreen *;autoplay *;" style={{position: 'absolute', top: 0, left: 0, border: 'solid', borderRadius: '12px'}}></iframe>
</div>

- [**CAIPE UI Documentation - explore the complete features, configuration, and development guide**](../ui/index.md)

The CAIPE UI is a modern React-based web interface for visualizing A2A (Agent-to-Agent) protocol messages with real-time streaming support. It provides:

- **3-Panel Layout**: Use Cases Gallery, Interactive Chat, and A2A Message Visualization
- **Real-time Streaming**: Server-Sent Events (SSE) for live agent communication
- **A2UI Widget Support**: Interactive forms, buttons, and structured UI components
- **Knowledge Graph**: Visual representation using Sigma.js
- **Authentication**: NextAuth.js with OAuth 2.0 support

**Run with Docker Compose:**

```bash
COMPOSE_PROFILES=caipe-ui docker compose -f docker-compose.dev.yaml up
```

**Or use Make target:**

```bash
make caipe-ui
```

Once the container is started, open the UI in your browser:
```
http://localhost:3000
```

**View Documentation Site:**
```
http://localhost:3001/ai-platform-engineering/ui/
```