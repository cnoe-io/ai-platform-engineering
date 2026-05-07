import React from 'react';
import Link from '@docusaurus/Link';
import Layout from '@theme/Layout';
import Heading from '@theme/Heading';
import styles from './features.module.css';

const SECTIONS = [
  {
    title: 'Dynamic Agents Service',
    icon: '⚡',
    color: '#0284c7',
    items: [
      'Standalone agent-builder service — deploy independently of the main supervisor',
      'Each custom agent gets its own system prompt, tool access, and persona',
      'Built-in MCP tool support: mount any MCP server into your agent at deploy time',
      'REST + SSE API compatible with A2A and AG-UI protocols',
      'Deploy via Helm: oci://ghcr.io/cnoe-io/charts/dynamic-agents',
    ],
  },
  {
    title: 'Agent Builder UI',
    icon: '🎨',
    color: '#7c3aed',
    items: [
      'No-code agent creation directly from the CAIPE web UI',
      'Configure system prompt, model, temperature, and allowed tools interactively',
      'Attach MCP servers to agents from the Skills Gateway catalog',
      'Instantly test agents in the chat UI without redeployment',
      'Share agents across teams with RBAC-controlled access',
    ],
  },
  {
    title: 'Seed Config — Pre-wire Agents & MCP Servers',
    icon: '🌱',
    color: '#059669',
    items: [
      'seedConfig.enabled — bootstrap agents and MCP servers at chart install time',
      'seedConfig.agents — list of agent definitions (name, system prompt, model, tools)',
      'seedConfig.mcp_servers — list of MCP server endpoints to register at startup',
      'seedConfig.models — declare available LLM endpoints for agent selection',
      'Idempotent: safe to apply on upgrades without duplicating entries',
    ],
  },
  {
    title: 'Customizable System Prompts',
    icon: '✏️',
    color: '#d97706',
    items: [
      'Per-agent system prompts — different personas for Platform Engineer, SRE, Developer',
      'Prompt library: curated, evaluated prompts for common platform workflows',
      'Override prompts at runtime via UI without redeploying the chart',
      'Prompt versioning tied to Helm chart version for reproducibility',
    ],
  },
  {
    title: 'Multi-Model Support per Agent',
    icon: '🌐',
    color: '#0891b2',
    items: [
      'Each custom agent can target a different LLM — Claude, GPT-4o, Gemini, or any OpenAI-compatible endpoint',
      'Model selection per agent in seedConfig.models',
      'Switch models at runtime from the Agent Builder UI',
      'LLM secrets managed via Kubernetes Secrets or ExternalSecrets Operator',
    ],
  },
  {
    title: 'Production Deployment',
    icon: '🚀',
    color: '#2563eb',
    items: [
      'Kubernetes Helm chart with configurable replicas, resources, and HPA',
      'AGENT_RUNTIME_TTL_SECONDS — auto-expire idle agent runtimes',
      'MongoDB-backed persistence for agent state and conversation history',
      'ExternalSecrets integration for secrets management in GitOps workflows',
      'Prometheus metrics endpoint at /metrics for observability',
    ],
  },
];

export default function CustomAgentsPage() {
  return (
    <Layout
      title="Custom Agents · CAIPE"
      description="Build and deploy custom AI agents with CAIPE — no-code Agent Builder, Helm-based deployment, MCP tool support, and multi-model targeting."
    >
      <main>
        <section className={styles.hero}>
          <div className={styles.heroInner}>
            <Heading as="h1" className={styles.heroTitle}>
              Custom Agents
            </Heading>
            <p className={styles.heroSubtitle}>
              Build your own agents with custom system prompts, tool access, and personas — deploy
              via the no-code Agent Builder UI or the{' '}
              <code>dynamic-agents</code> Helm chart with full MCP server support.
            </p>
            <div className={styles.heroCtas}>
              <Link
                className={styles.primaryBtn}
                to="/docs/installation/helm-charts/ai-platform-engineering/dynamic-agents"
              >
                Helm Chart Docs →
              </Link>
              <Link className={styles.secondaryBtn} to="/docs/development/creating-an-agent">
                Developer Guide
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
          <Heading as="h2" className={styles.ctaTitle}>Ready to build your first agent?</Heading>
          <p className={styles.ctaSubtitle}>
            Deploy the dynamic-agents service and create your first custom agent in minutes.
          </p>
          <div className={styles.heroCtas}>
            <Link className={styles.primaryBtn} to="/docs/installation">
              Installation Guide →
            </Link>
            <Link
              className={styles.secondaryBtn}
              href="https://github.com/cnoe-io/ai-platform-engineering"
            >
              GitHub ↗
            </Link>
          </div>
        </section>
      </main>
    </Layout>
  );
}
