import React from 'react';
import Link from '@docusaurus/Link';
import useDocusaurusContext from '@docusaurus/useDocusaurusContext';
import Layout from '@theme/Layout';
import Heading from '@theme/Heading';
import styles from './index.module.css';

const FEATURES = [
  {
    icon: '🤖',
    title: 'Multi-Agent Orchestration',
    description:
      'A supervisor agent routes tasks to specialized sub-agents — ArgoCD, PagerDuty, GitHub, Jira, Kubernetes, and more — using the AG-UI protocol.',
  },
  {
    icon: '🔌',
    title: '15+ Platform Integrations',
    description:
      'Pre-built agents for the tools your team already uses: Slack, Webex, Backstage, Confluence, Splunk, VictorOps, Komodor, and growing.',
  },
  {
    icon: '⚡',
    title: 'Deploy in Minutes',
    description:
      'One-line install via Helm or Docker Compose. Bring your own LLM (OpenAI, Anthropic, Azure, or any OpenAI-compatible endpoint).',
  },
  {
    icon: '🏢',
    title: 'Enterprise Ready',
    description:
      'OIDC/SSO auth, RBAC, Kubernetes PSS Baseline security, ExternalSecrets integration, and multi-cluster support out of the box.',
  },
  {
    icon: '🧠',
    title: 'Skills & RAG',
    description:
      'Author custom Skills in plain Markdown. Built-in RAG server with vector search gives your agents context from internal docs and runbooks.',
  },
  {
    icon: '🌐',
    title: 'Open Source & Community',
    description:
      'CNOE Agentic AI SIG project. Weekly community meetings, CNCF Slack, and a growing ecosystem of contributors and integrations.',
  },
];

const AGENTS = [
  'ArgoCD', 'PagerDuty', 'GitHub', 'GitLab', 'Jira', 'Confluence',
  'Kubernetes', 'Slack', 'Webex', 'Splunk', 'VictorOps', 'Komodor',
  'Backstage', 'AWS', 'Weather',
];

function HeroSection() {
  return (
    <section className={styles.hero}>
      <div className={styles.heroInner}>
        <div className={styles.heroBadge}>
          ⛵ CNOE Agentic AI SIG · v0.4.8
        </div>
        <Heading as="h1" className={styles.heroTitle}>
          AI-powered{' '}
          <span className={styles.heroAccent}>Platform Engineering</span>
        </Heading>
        <p className={styles.heroSubtitle}>
          CAIPE is an open-source multi-agent system that automates platform
          operations — incident response, deployments, runbooks, and more —
          so your team can focus on building.
        </p>
        <div className={styles.heroButtons}>
          <Link className={styles.heroPrimary} to="/docs/getting-started/quick-start">
            Get Started →
          </Link>
          <Link className={styles.heroSecondary} to="/docs">
            Read the Docs
          </Link>
          <Link
            className={styles.heroSecondary}
            href="https://github.com/cnoe-io/ai-platform-engineering"
          >
            GitHub ↗
          </Link>
        </div>
        <div className={styles.heroStats}>
          <div className={styles.heroStat}>
            <span className={styles.heroStatNumber}>15+</span>
            <span className={styles.heroStatLabel}>Integrations</span>
          </div>
          <div className={styles.heroStat}>
            <span className={styles.heroStatNumber}>AG-UI</span>
            <span className={styles.heroStatLabel}>Protocol</span>
          </div>
          <div className={styles.heroStat}>
            <span className={styles.heroStatNumber}>OSS</span>
            <span className={styles.heroStatLabel}>Apache 2.0</span>
          </div>
          <div className={styles.heroStat}>
            <span className={styles.heroStatNumber}>CNCF</span>
            <span className={styles.heroStatLabel}>Sandbox Candidate</span>
          </div>
        </div>
      </div>
    </section>
  );
}

function FeaturesSection() {
  return (
    <section className={styles.features}>
      <div className={styles.sectionHeader}>
        <p className={styles.sectionLabel}>Why CAIPE</p>
        <Heading as="h2" className={styles.sectionTitle}>
          Everything you need to automate platform ops
        </Heading>
        <p className={styles.sectionSubtitle}>
          Purpose-built for Platform Engineering, SRE, and DevOps teams who
          want to move from manual, task-driven processes to intelligent
          agentic workflows.
        </p>
      </div>
      <div className={styles.featuresGrid}>
        {FEATURES.map((f) => (
          <div key={f.title} className={styles.featureCard}>
            <span className={styles.featureIcon}>{f.icon}</span>
            <Heading as="h3" className={styles.featureTitle}>{f.title}</Heading>
            <p className={styles.featureDesc}>{f.description}</p>
          </div>
        ))}
      </div>
    </section>
  );
}

function AgentsSection() {
  return (
    <section className={styles.integrations}>
      <p className={styles.integrationsTitle}>
        Pre-built agents for your platform stack
      </p>
      <div className={styles.integrationsList}>
        {AGENTS.map((a) => (
          <span key={a} className={styles.integrationChip}>{a}</span>
        ))}
      </div>
    </section>
  );
}

function QuickStartSection() {
  return (
    <section className={styles.quickstart}>
      <div className={styles.quickstartInner}>
        <div className={styles.sectionHeader} style={{textAlign: 'left', marginBottom: '1.5rem'}}>
          <p className={styles.sectionLabel}>Quick Install</p>
          <Heading as="h2" className={styles.sectionTitle}>
            Up and running in minutes
          </Heading>
          <p className={styles.sectionSubtitle} style={{margin: 0}}>
            Install via the setup script or Helm. Bring your own LLM — any
            OpenAI-compatible endpoint works.
          </p>
        </div>

        <div className={styles.codeBlock}>
          <div className={styles.codeHeader}>
            <span className={styles.codeTab}>curl · Quickstart</span>
          </div>
          <pre className={styles.codePre}>
            <code>
              <span className={styles.codeComment}># Install CAIPE via setup script</span>{'\n'}
              <span className={styles.codePrompt}>$</span>{' '}
              {'bash <(curl -fsSL https://raw.githubusercontent.com/cnoe-io/ai-platform-engineering/main/setup-caipe.sh)'}{'\n\n'}
              <span className={styles.codeComment}># Or via Helm</span>{'\n'}
              <span className={styles.codePrompt}>$</span>{' '}
              {'helm upgrade --install ai-platform-engineering \\'}{'\n'}
              {'    oci://ghcr.io/cnoe-io/charts/ai-platform-engineering \\'}{'\n'}
              {'    --version 0.4.8 -f your-values.yaml'}
            </code>
          </pre>
        </div>

        <div style={{marginTop: '1.5rem', display: 'flex', gap: '1rem', flexWrap: 'wrap'}}>
          <Link className={styles.heroPrimary} to="/docs/installation">
            Full Install Guide →
          </Link>
          <Link className={styles.heroSecondaryDark} to="/docs/getting-started/quick-start">
            Quick Start
          </Link>
        </div>
      </div>
    </section>
  );
}

function CtaSection() {
  return (
    <section className={styles.cta}>
      <Heading as="h2" className={styles.ctaTitle}>
        Built by the platform engineering community, for the community
      </Heading>
      <p className={styles.ctaSubtitle}>
        CAIPE is an open-source project under the CNOE Agentic AI SIG.
        Join weekly meetings, contribute agents, or share your deployment.
      </p>
      <div className={styles.ctaButtons}>
        <Link className={styles.heroPrimary} to="/community">
          Join the Community
        </Link>
        <Link
          className={styles.heroSecondary}
          href="https://github.com/cnoe-io/ai-platform-engineering"
        >
          Star on GitHub ↗
        </Link>
      </div>
    </section>
  );
}

export default function Home() {
  const {siteConfig} = useDocusaurusContext();
  return (
    <Layout
      title={siteConfig.title}
      description="Open-source multi-agent system for AI-powered platform engineering. Automate deployments, incidents, runbooks, and more."
    >
      <main>
        <HeroSection />
        <FeaturesSection />
        <AgentsSection />
        <QuickStartSection />
        <CtaSection />
      </main>
    </Layout>
  );
}
