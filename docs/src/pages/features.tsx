import React from 'react';
import Link from '@docusaurus/Link';
import Layout from '@theme/Layout';
import Heading from '@theme/Heading';
import styles from './features.module.css';

const DEEP_DIVES = [
  {
    title: 'Custom Agents',
    icon: '🛠️',
    description: 'Build agents with custom system prompts, tool access, and personas. Deploy via the no-code Agent Builder UI or the dynamic-agents Helm chart.',
    to: '/custom-agents',
  },
  {
    title: 'BYO A2A Agents & MCP Servers',
    icon: '🔌',
    description: 'Plug your own A2A agents and MCP servers into CAIPE via the supervisor agent registry, dynamic-agents seed config, or Docker Compose.',
    to: '/byo-agents',
  },
];

const FEATURES = [
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
      '[Middleware] Deterministic workflows with task builder',
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
      'Task Builder',
      'Custom Agent Builder',
      'Skills Gateway — AI Assist, API access, security scanner, GitHub crawling',
    ],
  },
  {
    title: 'Integrated Knowledge Bases',
    icon: '🧠',
    color: '#0891b2',
    items: [
      'Unified RAG (Unstructured and Graph RAG)',
      'Ingestors: Web, ArgoCD, AWS, Backstage, Confluence, Jira, GitHub, Webex, Slack',
      'Designed to support large volume of ingestion and querying across data sources',
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
      'A2A (Agent-to-Agent) protocol',
      'MCP (Model Context Protocol)',
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
    title: 'Integrations',
    icon: '🔌',
    color: '#7c3aed',
    items: [
      'Backstage (Agent Forge plugin)',
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
            </div>
          </div>
        </section>

        <section className={styles.grid} style={{paddingBottom: '1rem'}}>
          <div style={{maxWidth: '1200px', margin: '0 auto 2rem', padding: '0 1.5rem'}}>
            <p className={styles.cardTitle} style={{fontSize: '0.75rem', letterSpacing: '0.1em', textTransform: 'uppercase', marginBottom: '1rem', color: 'var(--ifm-color-primary)'}}>Feature Deep Dives</p>
            <div style={{display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: '1rem'}}>
              {DEEP_DIVES.map((d) => (
                <Link key={d.title} to={d.to} style={{textDecoration: 'none'}}>
                  <div className={styles.card} style={{height: '100%'}}>
                    <div className={styles.cardHeader} style={{'--card-color': '#0284c7'} as React.CSSProperties}>
                      <span className={styles.cardIcon}>{d.icon}</span>
                      <Heading as="h2" className={styles.cardTitle}>{d.title}</Heading>
                    </div>
                    <p className={styles.cardItem} style={{padding: '1rem 1.4rem', margin: 0}}>{d.description}</p>
                  </div>
                </Link>
              ))}
            </div>
          </div>
        </section>

        <section className={styles.grid}>
          <div className={styles.gridInner}>
            {FEATURES.map((f) => (
              <div key={f.title} className={styles.card}>
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
            ))}
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
          </div>
        </section>
      </main>
    </Layout>
  );
}
