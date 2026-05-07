import React, { useState } from 'react';
import Link from '@docusaurus/Link';
import useDocusaurusContext from '@docusaurus/useDocusaurusContext';
import Layout from '@theme/Layout';
import Heading from '@theme/Heading';
import styles from './index.module.css';

const CURL_CMD = 'bash <(curl -fsSL https://raw.githubusercontent.com/cnoe-io/ai-platform-engineering/main/setup-caipe.sh)';
const HELM_CMD = 'helm upgrade --install ai-platform-engineering \\\n    oci://ghcr.io/cnoe-io/charts/ai-platform-engineering \\\n    --version 0.4.8 -f your-values.yaml';

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      className={styles.copyBtn}
      onClick={() => {
        navigator.clipboard.writeText(text);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      }}
    >
      {copied ? '✓ Copied' : 'Copy'}
    </button>
  );
}

const FEATURES = [
  {
    icon: '🤖',
    title: 'Multi-Agent Orchestration',
    description:
      '10+ first-party sub-agents and MCP servers. Create custom agents, customize system prompts, and chain workflows with the deterministic task builder.',
    to: '/docs/architecture',
  },
  {
    icon: '🎨',
    title: 'Rich Web UI',
    description:
      'Live streaming chat, custom agent builder, task builder, and Skills Gateway with AI-assisted skill authoring, security scanning, and GitHub crawling.',
    to: '/docs/ui',
  },
  {
    icon: '🧠',
    title: 'Integrated Knowledge Bases',
    description:
      'Unified RAG (unstructured and Graph RAG) with ingestors for Web, ArgoCD, AWS, Backstage, Confluence, Jira, GitHub, Webex, and Slack.',
    to: '/docs/knowledge_bases',
  },
  {
    icon: '💾',
    title: 'Agent Memory',
    description:
      'Multi-turn chat persistence and cross-session fact extraction — agents remember context across conversations for each user.',
    to: '/docs/architecture',
  },
  {
    icon: '🔒',
    title: 'Enterprise Security',
    description:
      'OAuth 2.0 / OIDC SSO, OIDC/Okta group-based RBAC, team-based access control, and policy-based tool restrictions.',
    to: '/docs/security',
  },
  {
    icon: '🚀',
    title: 'Flexible Deployment',
    description:
      'Kubernetes Helm charts, Docker Compose, ExternalSecrets, LLM tracing via Langfuse, and Prometheus metrics — bring any OpenAI-compatible LLM.',
    to: '/docs/installation',
  },
  {
    icon: '⚙️',
    title: 'Deterministic Workflows',
    description:
      'Task Builder lets you define sequential, reliable agent pipelines — no hallucinated steps, just structured execution you can audit and repeat.',
    to: '/docs/architecture',
  },
  {
    icon: '🛠️',
    title: 'Custom Agents',
    description:
      'Build and deploy your own agents with the Agent Builder UI. Customize system prompts, tool access, and personas without writing boilerplate.',
    to: '/docs/features/custom-agents',
  },
  {
    icon: '🔌',
    title: 'BYO A2A Agents & MCP Servers',
    description:
      'Plug in your own A2A-compatible agents or MCP servers. CAIPE acts as the orchestration layer — your tools, your protocols.',
    to: '/docs/features/byo-agents',
  },
  {
    icon: '🌐',
    title: 'Multi-Model Support',
    description:
      'Works with Claude (Anthropic), OpenAI GPT models, Google Vertex AI Gemini, and any OpenAI-compatible endpoint — switch models without rewiring agents.',
    to: '/docs/getting-started/quick-start',
  },
];

const USE_CASES = [
  {
    title: 'How Splunk Built Forge on CAIPE',
    description:
      'Splunk Cloud Platform team used CAIPE to build an always-on internal AI assistant, cutting engineer response times by 99% and automating support triage across 90+ channels.',
    image: 'https://outshift-headless-cms-s3.s3.us-east-2.amazonaws.com/ai-default-img-1.png',
    href: 'https://outshift.cisco.com/blog/ai-ml/how-splunk-built-forge-on-caipe',
    label: 'Splunk',
    external: true,
  },
  {
    title: 'JARVIS: Multi-Agent System Design Deep Dive',
    description:
      "A technical deep dive into how JARVIS — Cisco's internal platform AI assistant — is architected as a multi-agent system using CAIPE for superior performance and scalability.",
    image: 'https://outshift-headless-cms-s3.s3.us-east-2.amazonaws.com/CREA-989.png',
    href: 'https://outshift.cisco.com/blog/ai-ml/jarvis-technical-deep-dive-multi-agent-design',
    label: 'Cisco Outshift',
    external: true,
  },
  {
    title: 'CAIPE Hands-On Workshop',
    description:
      'Step-by-step labs covering single-agent design, multi-agent orchestration, RAG knowledge bases, and distributed tracing — learn by building.',
    image: 'https://outshift-headless-cms-s3.s3.us-east-2.amazonaws.com/INSIDEOUTSHIFT_1.png',
    href: '/docs/workshop/caipeintro',
    label: 'CAIPE Labs',
    external: false,
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
        <div className={styles.heroGrid}>
          {/* Left: copy + CTAs */}
          <div className={styles.heroLeft}>
            <div className={styles.heroBadge}>
              Community AI Platform Engineering
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
            <p className={styles.heroPronunciation}>
              💡 Pronounced like <strong>cape</strong> 🦸 — just as a cape empowers a superhero, CAIPE empowers platform engineers with 🤖 agentic AI automation.
            </p>
            <div className={styles.heroButtons}>
              <Link className={styles.heroPrimary} to="/docs/getting-started/quick-start">
                Get Started →
              </Link>
              <Link className={styles.heroSecondary} to="/docs">
                Read the Docs
              </Link>
              <Link className={styles.heroSecondary} href="https://github.com/cnoe-io/ai-platform-engineering">
                GitHub ↗
              </Link>
            </div>
          </div>

          {/* Right: Quick Install — two independently copyable blocks */}
          <div className={styles.heroRight}>
            <div className={styles.codeBlock}>
              <div className={styles.codeHeader}>
                <span className={styles.codeTab}>Script · curl</span>
                <CopyButton text={CURL_CMD} />
              </div>
              <pre className={styles.codePre}>
                <code>
                  <span className={styles.codeComment}># Install CAIPE via setup script</span>{'\n'}
                  <span className={styles.codePrompt}>$</span>{' '}
                  {'bash <(curl -fsSL https://raw.githubusercontent.com/cnoe-io/'}{'\n'}
                  {'    ai-platform-engineering/main/setup-caipe.sh)'}
                </code>
              </pre>
            </div>
            <div className={styles.codeBlock} style={{marginTop: '0.75rem'}}>
              <div className={styles.codeHeader}>
                <span className={styles.codeTab}>Helm</span>
                <CopyButton text={HELM_CMD} />
              </div>
              <pre className={styles.codePre}>
                <code>
                  <span className={styles.codeComment}># Or via Helm</span>{'\n'}
                  <span className={styles.codePrompt}>$</span>{' '}
                  {'helm upgrade --install ai-platform-engineering \\'}{'\n'}
                  {'    oci://ghcr.io/cnoe-io/charts/ai-platform-engineering \\'}{'\n'}
                  {'    --version 0.4.8 -f your-values.yaml'}
                </code>
              </pre>
            </div>
          </div>
        </div>

        {/* Stats row — full width below both columns */}
        <div className={styles.heroStats}>
          <div className={styles.heroStat}>
            <span className={styles.heroStatNumber}>15+</span>
            <span className={styles.heroStatLabel}>Integrations</span>
          </div>
          <div className={styles.heroStat}>
            <span className={styles.heroStatNumber}>Multi</span>
            <span className={styles.heroStatLabel}>Agent System</span>
          </div>
          <div className={styles.heroStat}>
            <span className={styles.heroStatNumber}>OSS</span>
            <span className={styles.heroStatLabel}>Apache 2.0</span>
          </div>
          <a
            href="https://github.com/cncf/sandbox/issues/475"
            target="_blank"
            rel="noopener noreferrer"
            className={styles.heroStat}
            style={{textDecoration: 'none'}}
          >
            <span className={styles.heroStatNumber}>CNCF</span>
            <span className={styles.heroStatLabel}>Sandbox Candidate</span>
          </a>
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
          <Link key={f.title} to={f.to} className={styles.featureCard}>
            <span className={styles.featureIcon}>{f.icon}</span>
            <Heading as="h3" className={styles.featureTitle}>{f.title}</Heading>
            <p className={styles.featureDesc}>{f.description}</p>
          </Link>
        ))}
      </div>
    </section>
  );
}

function InTheWildSection() {
  return (
    <section className={styles.inTheWild}>
      <div className={styles.sectionHeader}>
        <p className={styles.sectionLabel}>Real World Usage</p>
        <Heading as="h2" className={styles.sectionTitle}>
          Used in production
        </Heading>
        <p className={styles.sectionSubtitle}>
          Teams building with CAIPE — from always-on AI assistants to
          enterprise-scale multi-agent platform automation.
        </p>
      </div>
      <div className={styles.useCasesGrid}>
        {USE_CASES.map((uc) => {
          const inner = (
            <>
              <div className={styles.useCaseImg}>
                <img src={uc.image} alt={uc.title} loading="lazy" />
              </div>
              <div className={styles.useCaseBody}>
                <span className={styles.useCaseCompany}>{uc.label}</span>
                <h3 className={styles.useCaseTitle}>{uc.title}</h3>
                <p className={styles.useCaseDesc}>{uc.description}</p>
                <span className={styles.useCaseLink}>{uc.external ? 'Read more ↗' : 'Start learning →'}</span>
              </div>
            </>
          );
          return uc.external ? (
            <a key={uc.title} href={uc.href} target="_blank" rel="noopener noreferrer" className={styles.useCaseCard}>
              {inner}
            </a>
          ) : (
            <Link key={uc.title} to={uc.href} className={styles.useCaseCard}>
              {inner}
            </Link>
          );
        })}
      </div>
    </section>
  );
}

function AgentsSection() {
  return (
    <section className={styles.integrations}>
      <p className={styles.integrationsTitle}>
        Pre-built agents for your platform stack — or bring your own A2A agent, MCP server, and build custom agents
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
        CAIPE is an open-source project by CAIPE.io OSS Contributors.
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
        <InTheWildSection />
        <AgentsSection />
        <CtaSection />
      </main>
    </Layout>
  );
}
