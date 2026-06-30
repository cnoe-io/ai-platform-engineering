import React from 'react';
import Link from '@docusaurus/Link';
import Layout from '@theme/Layout';
import Heading from '@theme/Heading';
import styles from './features.module.css';

const FEATURES = [
  {
    title: 'Custom Agents',
    icon: '🛠️',
    color: '#0284c7',
    to: '/docs/features/custom-agents',
    items: [
      'No-code Agent Builder UI — configure identity, owner team, system prompt, model, tools, skills, subagents, middleware, approvals, and workflow access',
      'dynamic-agents Helm chart — deploy the agent runtime independently',
      'App config bootstrap: pre-wire models, MCP servers, agents, and workflows at chart install time',
      'Team/global ownership with RBAC-managed sharing',
      'MongoDB-backed persistence, Prometheus metrics, ExternalSecrets integration',
    ],
  },
  {
    title: 'Workflows',
    icon: '🔁',
    color: '#0d9488',
    to: '/docs/features/workflows',
    items: [
      'Visual workflow builder for chaining dynamic agents into multi-step automations',
      'Step prompts support Jinja2 templates with previous outputs and user context',
      'Per-step error handling: abort, skip, or retry with configurable attempts',
      'MongoDB-backed workflow configs, run history, event timelines, and artifacts',
      'Custom agents can trigger and monitor approved workflows as built-in tools',
    ],
  },
  {
    title: 'BYO Agents & MCP Servers',
    icon: '🔌',
    color: '#7c3aed',
    to: '/docs/features/custom-agents',
    items: [
      'No-code Agent Builder UI — create agents without writing code',
      'appConfig.mcp_servers — plug in external MCP servers at chart install time',
      'Per-tool MCP servers for each integration',
      'Supported MCP transports: stdio, SSE, and Streamable HTTP',
      'Credential sources: secret refs, caller tokens, and provider connections',
      'LiteLLM proxy support — any LLM provider through a single endpoint',
    ],
  },
  {
    title: 'Multi-Agent Orchestration',
    icon: '🤖',
    color: '#0284c7',
    items: [
      'Multi-agent and deep agent interactions with access to multiple tools and sub-agents based on customizable system prompts',
      '10+ first-party curated sub-agents and MCP servers',
      'Ability to create custom Agents',
      'Ability to customize system prompts',
      '[Middleware] Custom Skills Integration',
    ],
  },
  {
    title: 'Rich Web UI',
    icon: '🎨',
    color: '#7c3aed',
    items: [
      'Rich/Contextual Home Page',
      'Rich Chat Interface with live agent/tool status via streaming',
      'Share chat with teams · Archive/Delete chats',
      'Custom Agent Builder',
      'Skills Gateway — AI Assist, API access, security scanner, GitHub crawling',
    ],
  },
  {
    title: 'Integrated Knowledge Bases',
    icon: '🧠',
    color: '#0891b2',
    items: [
      'Unified RAG with hybrid vector search and optional Graph RAG',
      'Ingestors: Web, AWS, Kubernetes, Backstage, ArgoCD, GitHub, Jira, Confluence, Slack, Webex',
      'MCP tools for search, fetch, datasource discovery, and graph exploration',
      'OAuth2/RBAC-aware ingestion and querying across data sources',
    ],
  },
  {
    title: 'Agent Memory',
    icon: '💾',
    color: '#059669',
    items: [
      'Chat persistence memory with multi-turn conversation',
      'Fact extraction across chats for a user',
    ],
  },
  {
    title: 'Agent and Tool Communications',
    icon: '🔗',
    color: '#d97706',
    items: [
      'MCP (Model Context Protocol)',
      'Dynamic Agents API',
      'AG-UI / SSE streaming — real-time event handling across all agent types',
      'CLI access',
    ],
  },
  {
    title: 'Enterprise Security',
    icon: '🔒',
    color: '#dc2626',
    items: [
      'OAuth 2.0 integration with OIDC compatible IdPs',
      'OIDC/Okta groups base RBAC',
      'Team based access',
      'Policy based tool restrictions',
    ],
  },
  {
    title: 'Deployment',
    icon: '🚀',
    color: '#2563eb',
    items: [
      'Kubernetes based Helm charts',
      'Docker/Containerized Agents and MCP servers',
      'Docker Compose support',
      'Secrets management using ExternalSecrets',
      'LLM Tracing integration (Langfuse)',
      'Prometheus Metrics and Analytics',
    ],
  },
  {
    title: 'Multiple Clients',
    icon: '💻',
    color: '#0891b2',
    items: [
      'Web UI — rich chat interface with live agent/tool status via streaming',
      'Chat CLI — invoke any agent from the terminal',
      'Slack Bot — conversational interface for your team\'s existing workflow',
      'Webex Bot — enterprise messaging integration',
    ],
  },
  {
    title: 'Integrations',
    icon: '🔌',
    color: '#7c3aed',
    items: [
      'Slack Bot',
      'Webex Bot',
      'CLI',
    ],
  },
];

export default function FeaturesPage() {
  return (
    <Layout
      title="Features · CAIPE"
      description="Full feature list for CAIPE — multi-agent orchestration, rich web UI, knowledge bases, enterprise security, and more."
    >
      <main>
        <section className={styles.hero}>
          <div className={styles.heroInner}>
            <Heading as="h1" className={styles.heroTitle}>
              CAIPE Features
            </Heading>
            <p className={styles.heroSubtitle}>
              Everything you need to run AI-powered platform engineering at
              enterprise scale — from multi-agent orchestration to RAG knowledge
              bases, skills, and production-grade deployment.
            </p>
            <div className={styles.heroCtas}>
              <Link className={styles.primaryBtn} to="/docs/getting-started/quick-start">
                Get Started →
              </Link>
              <Link className={styles.secondaryBtn} to="/roadmap">
                View Roadmap
              </Link>
              <Link
                className={styles.secondaryBtn}
                href="https://github.com/cnoe-io/ai-platform-engineering/issues/new?labels=enhancement&template=feature_request.md"
              >
                Submit a Feature Request ↗
              </Link>
            </div>
          </div>
        </section>

        <section className={styles.grid}>
          <div className={styles.gridInner}>
            {FEATURES.map((f) => {
              const card = (
                <div key={f.title} className={styles.card} style={f.to ? {cursor: 'pointer'} : undefined}>
                  <div className={styles.cardHeader} style={{'--card-color': f.color} as React.CSSProperties}>
                    <span className={styles.cardIcon}>{f.icon}</span>
                    <Heading as="h2" className={styles.cardTitle}>{f.title}</Heading>
                  </div>
                  <ul className={styles.cardList}>
                    {f.items.map((item) => (
                      <li key={item} className={styles.cardItem}>{item}</li>
                    ))}
                  </ul>
                </div>
              );
              return f.to
                ? <Link key={f.title} to={f.to} style={{textDecoration: 'none', color: 'inherit'}}>{card}</Link>
                : card;
            })}
          </div>
        </section>

        <section className={styles.cta}>
          <Heading as="h2" className={styles.ctaTitle}>Ready to get started?</Heading>
          <p className={styles.ctaSubtitle}>Deploy CAIPE in your environment in minutes.</p>
          <div className={styles.heroCtas}>
            <Link className={styles.primaryBtn} to="/docs/installation">
              Installation Guide →
            </Link>
            <Link className={styles.secondaryBtn} href="https://github.com/cnoe-io/ai-platform-engineering">
              GitHub ↗
            </Link>
            <Link
              className={styles.secondaryBtn}
              href="https://github.com/cnoe-io/ai-platform-engineering/issues/new?labels=enhancement&template=feature_request.md"
            >
              Submit a Feature Request ↗
            </Link>
          </div>
        </section>
      </main>
    </Layout>
  );
}
