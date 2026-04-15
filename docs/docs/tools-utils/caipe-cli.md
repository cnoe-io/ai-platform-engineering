# CAIPE CLI

A **CNOE Agentic SIG maintained, dedicated TypeScript/Bun CLI** for interactive chat with CAIPE server agents via the A2A and AG-UI streaming protocols. It provides an Ink 5 TUI with readline-style keybindings, slash commands, skill management, headless mode for CI/CD, and encrypted credential storage.

**Install:**

```bash
curl -fsSL https://raw.githubusercontent.com/cnoe-io/ai-platform-engineering/main/cli/install.sh | sh
```

**Quick start:**

```bash
caipe config set server.url https://your-caipe-server.example.com
caipe auth login
caipe
```

[**Explore the complete docs, install guide, and examples**](../getting-started/user-interfaces.md#caipe-cli)
