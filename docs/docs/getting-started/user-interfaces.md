---
sidebar_position: 6
---
# 🖥️ User Interfaces

The CAIPE Multi-agent Systems provide robust user interfaces that facilitate seamless interaction between agents using the Agent-to-Agent (A2A) protocol. These interfaces are designed to support secure communication and collaboration among agents, leveraging OAuth for authentication to ensure data integrity and privacy.

These interfaces empower users to build and manage sophisticated multi-agent systems with ease and security.

> **Note:** Authorization and scope validation are currently handled by MCP servers. Additional details regarding this process will be provided in future updates.

## Agent Chat CLI

- [**agent-chat-cli - explore the complete docs, install guide, and examples**](https://github.com/cnoe-io/agent-chat-cli)

   ```bash
   docker run -it --network=host ghcr.io/cnoe-io/agent-chat-cli:stable
   ```

   *Or, clone and run the chat client:*

   ```bash
   uvx https://github.com/cnoe-io/agent-chat-cli.git a2a
   ```

## Agent Forge Backstage Plugin

- [**agent-forge - explore the complete docs, install guide, and examples**](https://github.com/backstage/community-plugins/tree/main/workspaces/agent-forge)

    ```bash
    # Once the container is started, open agent-forge in browser (in test mode)
    https://localhost:3000
    ```
