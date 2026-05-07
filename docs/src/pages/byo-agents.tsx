import React from 'react';
import Link from '@docusaurus/Link';
import Layout from '@theme/Layout';
import Heading from '@theme/Heading';
import styles from './features.module.css';

const SECTIONS = [
  {
    title: 'A2A Agent Registry — Supervisor Helm Chart',
    icon: '🔗',
    color: '#0284c7',
    items: [
      'multiAgentConfig.agents — explicit list of external A2A agent endpoints to register with the supervisor',
      'Auto-discovery mode: leave agents empty and the supervisor discovers peers on the network',
      'multiAgentConfig.protocol — choose a2a (peer-to-peer) or slim (hub-based) transport',
      'multiAgentConfig.port — port advertised to peer agents for inbound connections',
      'Works with any A2A-compatible agent — CAIPE agents, custom FastAPI services, or third-party implementations',
    ],
  },
  {
    title: 'MCP Servers — Dynamic Agents Seed Config',
    icon: '🔌',
    color: '#7c3aed',
    items: [
      'seedConfig.mcp_servers — register external MCP server endpoints at chart install time',
      'Each MCP server entry specifies name, URL, and optional auth headers',
      'MCP servers are available to all custom agents built in the dynamic-agents service',
      'Hot-register new MCP servers from the Skills Gateway UI without redeployment',
      'Supports HTTP/SSE MCP transport — compatible with FastMCP and any spec-compliant server',
    ],
  },
  {
    title: 'Docker Compose — A2A Transport',
    icon: '🐳',
    color: '#0891b2',
    items: [
      'A2A_TRANSPORT env var — set to p2p for peer-to-peer or slim for hub-based routing',
      'Add any external A2A agent as a new service in docker-compose.yaml with the shared network',
      'NEXT_PUBLIC_A2A_BASE_URL — point the UI at your custom supervisor or gateway endpoint',
      'Each agent service exposes its A2A endpoint; the supervisor discovers and routes to it automatically',
      'Extend the default profiles: add --profile my-agent to compose up for optional agents',
    ],
  },
  {
    title: 'Supported Protocols',
    icon: '📡',
    color: '#059669',
    items: [
      'A2A (Agent-to-Agent) — Google-led open protocol for agent interoperability',
      'MCP (Model Context Protocol) — Anthropic-led standard for tool and resource exposure',
      'AG-UI / SSE streaming — real-time event streaming across all agent types',
      'SLIM transport — hub-based routing for firewall-friendly deployments',
      'OpenAI-compatible chat completions — any agent exposing /v1/chat/completions works',
    ],
  },
  {
    title: 'Bring Your Own LLM',
    icon: '🌐',
    color: '#d97706',
    items: [
      'Any OpenAI-compatible endpoint works — Claude (via Anthropic), GPT-4o, Gemini, Llama, Mistral',
      'Configure per-agent model endpoints in llmSecrets or seedConfig.models',
      'LiteLLM proxy support — route to any provider through a single unified endpoint',
      'Switch models without redeploying agents — update via Helm values or the UI',
    ],
  },
  {
    title: 'Backstage & External Integrations',
    icon: '🏗️',
    color: '#2563eb',
    items: [
      'Agent Forge Backstage plugin — surface CAIPE agents directly in your Internal Developer Portal',
      'Slack Bot and Webex Bot — expose the full supervisor as a conversational interface',
      'CLI access — invoke any agent from the terminal via the CAIPE CLI',
      'REST API — integrate agent execution into CI/CD pipelines or custom dashboards',
    ],
  },
];

export default function ByoAgentsPage() {
  return (
    <Layout
      title="BYO A2A Agents & MCP Servers · CAIPE"
      description="Plug your own A2A agents and MCP servers into CAIPE — agent registry via Helm, seedConfig for MCP servers, and Docker Compose A2A transport."
    >
      <main>
        <section className={styles.hero}>
          <div className={styles.heroInner}>
            <Heading as="h1" className={styles.heroTitle}>
              BYO A2A Agents & MCP Servers
            </Heading>
            <p className={styles.heroSubtitle}>
              CAIPE is the orchestration layer — plug in your own A2A-compatible agents and MCP
              servers via the supervisor agent registry, dynamic-agents seed config, or Docker
              Compose. Your protocols, your tools.
            </p>
            <div className={styles.heroCtas}>
              <Link
                className={styles.primaryBtn}
                to="/docs/installation/helm-charts/ai-platform-engineering/supervisor-agent"
              >
                Supervisor Chart Docs →
              </Link>
              <Link
                className={styles.secondaryBtn}
                to="/docs/installation/helm-charts/ai-platform-engineering/dynamic-agents"
              >
                Dynamic Agents Chart
              </Link>
            </div>
          </div>
        </section>

        <section className={styles.grid}>
          <div className={styles.gridInner}>
            {SECTIONS.map((s) => (
              <div key={s.title} className={styles.card}>
                <div
                  className={styles.cardHeader}
                  style={{'--card-color': s.color} as React.CSSProperties}
                >
                  <span className={styles.cardIcon}>{s.icon}</span>
                  <Heading as="h2" className={styles.cardTitle}>{s.title}</Heading>
                </div>
                <ul className={styles.cardList}>
                  {s.items.map((item) => (
                    <li key={item} className={styles.cardItem}>{item}</li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </section>

        <section className={styles.cta}>
          <Heading as="h2" className={styles.ctaTitle}>
            Ready to connect your agents?
          </Heading>
          <p className={styles.ctaSubtitle}>
            Register external A2A agents and MCP servers with the CAIPE supervisor in minutes.
          </p>
          <div className={styles.heroCtas}>
            <Link className={styles.primaryBtn} to="/docs/development/creating-mcp-server">
              MCP Server Guide →
            </Link>
            <Link className={styles.secondaryBtn} to="/docs/development/creating-an-agent">
              Agent Dev Guide
            </Link>
          </div>
        </section>
      </main>
    </Layout>
  );
}
