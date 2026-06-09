import React, { useState, useEffect, useCallback } from 'react';
import Link from '@docusaurus/Link';
import useDocusaurusContext from '@docusaurus/useDocusaurusContext';
import Layout from '@theme/Layout';
import Heading from '@theme/Heading';
import styles from './index.module.css';

const CURL_CMD = 'bash <(curl -fsSL https://raw.githubusercontent.com/cnoe-io/ai-platform-engineering/main/setup-caipe.sh)';
const HELM_CMD = 'helm upgrade --install ai-platform-engineering \\\n    oci://ghcr.io/cnoe-io/charts/ai-platform-engineering \\\n    --version 0.4.8 -f your-values.yaml';
const GIF_URL = 'https://github.com/cnoe-io/ai-platform-engineering/releases/download/0.4.8/caipe-setup.gif';

function DemoGif() {
  const [open, setOpen] = useState(false);
  const close = useCallback(() => setOpen(false), []);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') close(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, close]);

  return (
    <>
      <div className={styles.heroCenter}>
        <div className={styles.heroDemoFrame}>
          <div className={styles.heroDemoBar}>
            <span className={styles.heroDemoDot} style={{background:'#ff5f57'}} />
            <span className={styles.heroDemoDot} style={{background:'#ffbd2e'}} />
            <span className={styles.heroDemoDot} style={{background:'#28c840'}} />
            <span className={styles.heroDemoTitle}>CAIPE Setup</span>
            <button
              className={styles.heroDemoFullscreen}
              onClick={() => setOpen(true)}
              aria-label="View fullscreen"
              title="View fullscreen"
            >
              ⛶
            </button>
          </div>
          <img
            src={GIF_URL}
            alt="CAIPE setup walkthrough"
            className={styles.heroDemoGif}
            loading="eager"
          />
        </div>
      </div>

      {open && (
        <div className={styles.gifOverlay} onClick={close} role="dialog" aria-modal="true">
          <div className={styles.gifOverlayInner} onClick={(e) => e.stopPropagation()}>
            <button className={styles.gifOverlayClose} onClick={close} aria-label="Close">✕</button>
            <img src={GIF_URL} alt="CAIPE setup walkthrough" className={styles.gifOverlayImg} />
          </div>
        </div>
      )}
    </>
  );
}

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

const HOME_FEATURES = [
  {
    icon: '🤖',
    title: 'Multi-Agent Orchestration',
    description: '10+ agents and MCP servers with a deterministic task builder.',
    to: '/features',
  },
  {
    icon: '🎨',
    title: 'Rich Web UI',
    description: 'Streaming chat, agent builder, task builder, and skills gateway.',
    to: '/features',
  },
  {
    icon: '🧠',
    title: 'Integrated Knowledge Bases',
    description: 'RAG + Graph RAG across ArgoCD, AWS, Jira, GitHub, Slack, and more.',
    to: '/features',
  },
  {
    icon: '💾',
    title: 'Agent Memory',
    description: 'Cross-session fact extraction and per-user context persistence.',
    to: '/features',
  },
  {
    icon: '🔒',
    title: 'Enterprise Security',
    description: 'OIDC SSO, Okta RBAC, and policy-based tool restrictions.',
    to: '/features',
  },
  {
    icon: '🚀',
    title: 'Flexible Deployment',
    description: 'Helm, Docker Compose, Langfuse tracing — bring any OpenAI-compatible LLM.',
    to: '/features',
  },
  {
    icon: '⚙️',
    title: 'Deterministic Workflows',
    description: 'Sequential agent pipelines with no hallucinated steps.',
    to: '/features',
  },
  {
    icon: '🛠️',
    title: 'Custom Agents',
    description: 'Build agents with custom prompts, tools, and personas — no boilerplate.',
    to: '/features',
  },
  {
    icon: '🔌',
    title: 'BYO A2A & MCP',
    description: 'Plug in your own A2A agents or MCP servers as first-class participants.',
    to: '/features',
  },
  {
    icon: '🌐',
    title: 'Multi-Model Support',
    description: 'Claude, OpenAI, Gemini, or any compatible endpoint — swap without rewiring.',
    to: '/features',
  },
  {
    icon: '💻',
    title: 'Multiple Clients',
    description: 'Web UI, Backstage plugin, Chat CLI, Slack Bot, and Webex Bot.',
    to: '/features',
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
  const [stars, setStars] = useState<string | null>(null);
  useEffect(() => {
    fetch('https://api.github.com/repos/cnoe-io/ai-platform-engineering')
      .then((r) => r.json())
      .then((d) => {
        const n = d.stargazers_count;
        if (typeof n === 'number') {
          setStars(n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n));
        }
      })
      .catch(() => {});
  }, []);
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

          {/* Center: product demo GIF */}
          <DemoGif />

          {/* Right: Quick Install — two independently copyable blocks */}
          <div className={styles.heroRight}>
            <div className={styles.codeBlock}>
              <div className={styles.codeHeader}>
                <span className={styles.codeTab}>curl · Kind cluster or existing K8s</span>
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
            <div className={styles.codeBlock}>
              <div className={styles.codeHeader}>
                <span className={styles.codeTab}>Kubernetes · Helm</span>
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
          <a
            href="https://github.com/cnoe-io/ai-platform-engineering"
            target="_blank"
            rel="noopener noreferrer"
            className={styles.heroStat}
            style={{textDecoration: 'none'}}
          >
            <span className={styles.heroStatNumber}>⭐ {stars ?? '—'}</span>
            <span className={styles.heroStatLabel}>GitHub Stars</span>
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
          Built for platform teams
        </Heading>
        <p className={styles.sectionSubtitle}>
          From incident response to deployments — CAIPE turns manual platform ops into intelligent agentic workflows.
        </p>
      </div>
      <div className={styles.featuresGrid}>
        {HOME_FEATURES.map((f) => (
          <Link key={f.title} to={f.to} className={styles.featureCard}>
            <div className={styles.featureCardHeader}>
              <span className={styles.featureIcon}>{f.icon}</span>
              <Heading as="h3" className={styles.featureTitle}>{f.title}</Heading>
            </div>
            <p className={styles.featureDesc}>{f.description}</p>
          </Link>
        ))}
      </div>
      <div className={styles.featuresCta}>
        <Link className={styles.heroPrimary} to="/features">
          Explore all features →
        </Link>
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

function VisionSection() {
  return (
    <section className={styles.vision}>
      <div className={styles.visionInner}>
        <Heading as="h2" className={styles.visionTitle}>Our Mission</Heading>
        <p className={styles.visionBody}>
          To redefine platform engineering by creating{' '}
          <strong className={styles.visionHighlight}>
            intelligent, secure, and scalable multi-agent systems
          </strong>{' '}
          that empower teams to focus on innovation, seamlessly manage complex
          infrastructures, and shape the future of cloud-native operations
          through the Internet of Agents.
        </p>
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
        An open-source project built by platform engineers, for platform engineers.
        Governed under the{' '}
        <a
          href="https://github.com/cnoe-io/governance/tree/main/sigs/agentic-ai"
          target="_blank"
          rel="noopener noreferrer"
          className={styles.ctaLink}
        >
          CNOE Agentic AI SIG
        </a>
        {' '}— a community focused on platform engineering through shared guidance,
        tooling, and IDP reference architectures.
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
        <InTheWildSection />
        <VisionSection />
        <FeaturesSection />
        <AgentsSection />
        <CtaSection />
      </main>
    </Layout>
  );
}
