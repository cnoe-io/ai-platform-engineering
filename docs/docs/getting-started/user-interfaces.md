---
sidebar_position: 6
---
# 🖥️ User Interfaces

The CAIPE Multi-agent Systems provide robust user interfaces that facilitate seamless interaction between agents using the Agent-to-Agent (A2A) protocol. These interfaces are designed to support secure communication and collaboration among agents, leveraging OAuth for authentication to ensure data integrity and privacy.

These interfaces empower users to build and manage sophisticated multi-agent systems with ease and security.

> **Note:** Authorization and scope validation are currently handled by MCP servers. Additional details regarding this process will be provided in future updates.

## Agent Chat CLI

<div style={{paddingBottom: '56.25%', position: 'relative', display: 'block', width: '100%'}}>
	<iframe src="https://app.vidcast.io/share/embed/c8d0fdf0-5337-4c96-aae1-62a2eb660643?mute=1&autoplay=1&disableCopyDropdown=1" width="100%" height="100%" title="CAIPE Agent Chat CLI v0.2.0 Nov 15th 2025" loading="lazy" allow="fullscreen *;autoplay *;" style={{position: 'absolute', top: 0, left: 0, border: 'solid', borderRadius: '12px'}}></iframe>
</div>

- [**agent-chat-cli - explore the complete docs, install guide, and examples**](https://github.com/cnoe-io/agent-chat-cli)

   ```bash
   docker run -it --network=host ghcr.io/cnoe-io/agent-chat-cli:stable
   ```

   *Or, clone and run the chat client:*

   ```bash
   uvx --no-cache git+https://github.com/cnoe-io/agent-chat-cli.git a2a
   ```



## Agent Forge Backstage Plugin

<div style={{paddingBottom: '56.25%', position: 'relative', display: 'block', width: '100%'}}>
	<iframe src="https://app.vidcast.io/share/embed/5fe2d177-24b5-46e6-819d-2b63438f48c3?mute=1&autoplay=1&disableCopyDropdown=1" width="100%" height="100%" title="CAIPE Agent Forge Demo v0.2.0 Nov 15th 2025" loading="lazy" allow="fullscreen *;autoplay *;" style={{position: 'absolute', top: 0, left: 0, border: 'solid', borderRadius: '12px'}}></iframe>
</div>

- [**@caipe/plugin-agent-forge - explore the complete docs, install guide, and examples**](https://www.npmjs.com/package/@caipe/plugin-agent-forge)

**Run with Docker:**

```bash
docker run -d \
  --name backstage-agent-forge \
  -p 13000:3000 \
  -e NODE_ENV=development \
  ghcr.io/cnoe-io/backstage-plugin-agent-forge:latest
```

**Or with Docker Compose:**

```bash
COMPOSE_PROFILES="agentforge" docker compose up
```

Once the container is started, open agent-forge in your browser (in test mode):
```
http://localhost:13000
```