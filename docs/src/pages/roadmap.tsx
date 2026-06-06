import React from 'react';
import Link from '@docusaurus/Link';
import Layout from '@theme/Layout';
import Heading from '@theme/Heading';
import styles from './roadmap.module.css';

const ROADMAP = [
  {
    title: 'Dynamic Agents Platform',
    description: 'YAML-based dynamic agent configuration — domain-centric personas (SRE, code review, incident), dynamic skills integration, and full Custom Agent infrastructure replacing hardcoded configurations.',
    status: 'in-progress',
    subItems: [
      'YAML-based agent configuration and runtime',
      'Dynamic skills & task builder integration',
      'Domain-centric personas: SRE Agent, Code Review Agent',
      'Dynamic agent visibility & access control',
      'Custom Agents as the default supervisor type',
    ],
    issueRefs: ['#963', '#964', '#965', '#966', '#967', '#968', '#970'],
  },
  {
    title: 'Comprehensive RBAC/TBAC',
    description: 'Role and team-based access control touching all features — OAuth 2.1, audit logs, and channel-to-agent assignment.',
    status: 'planned',
    subItems: [
      'OAuth 2.1 features: DCR, Token Exchange, three-legged auth for remote MCP servers',
      'Manage RBAC user/teams/roles from UI',
      'Assign Slack/Webex channels ↔ Custom agents',
      'Detailed authorization audit logs (OBO agent actor logs)',
      'Two-tier policy system for self-service workflow tool authorization',
    ],
  },
  {
    title: 'LLM Budget & Quota Management',
    description: 'Per-user and per-agent LLM token budget enforcement using LiteLLM keys — track spend, set quotas, and prevent runaway inference costs.',
    status: 'planned',
    subItems: [
      'LiteLLM key integration for per-agent token tracking',
      'Dynamic LLM key creation for dynamic agents',
      'Budget dashboards and quota alerts in the admin UI',
    ],
  },
  {
    title: 'Agent Evaluation & Sandboxing',
    description: 'Sandboxed agent execution environments for safe testing, plus a deepeval-based evaluation pipeline for RAG precision/recall and agent response quality.',
    status: 'planned',
    subItems: [
      'Sandbox environment for agent testing without production impact',
      'deepeval pipeline: RAG precision, recall, F1 scoring',
      'Self-improving architecture feedback loop',
    ],
  },
  {
    title: 'Autonomous Agents',
    description: 'Self-directed agents that proactively monitor, detect, and act on platform events without explicit user prompts.',
    status: 'planned',
  },
  {
    title: 'Agentic SDLC',
    description: 'AI agents integrated throughout the software development lifecycle — from planning and coding to review, testing, and deployment.',
    status: 'planned',
  },
];

const STATUS_LABELS: Record<string, {label: string; className: string}> = {
  planned: { label: 'Planned', className: styles.statusPlanned },
  'in-progress': { label: 'In Progress', className: styles.statusInProgress },
  done: { label: 'Done', className: styles.statusDone },
};

export default function RoadmapPage() {
  return (
    <Layout
      title="Roadmap · CAIPE"
      description="CAIPE planned roadmap — upcoming features and improvements for the community AI platform engineering project."
    >
      <main>
        <section className={styles.hero}>
          <div className={styles.heroInner}>
            <Heading as="h1" className={styles.heroTitle}>
              CAIPE Roadmap
            </Heading>
            <p className={styles.heroSubtitle}>
              What we're working on next. The roadmap is driven by the community —
              vote on issues, open feature requests, or join the weekly meeting to
              influence priorities.
            </p>
            <div className={styles.heroCtas}>
              <Link
                className={styles.primaryBtn}
                href="https://github.com/orgs/cnoe-io/projects/9"
              >
                View on GitHub Projects ↗
              </Link>
              <Link className={styles.secondaryBtn} to="/community">
                Join the Community
              </Link>
            </div>
          </div>
        </section>

        <section className={styles.list}>
          <div className={styles.listInner}>
            {ROADMAP.map((item, i) => {
              const status = STATUS_LABELS[item.status];
              return (
                <div key={item.title} className={styles.item}>
                  <div className={styles.itemNumber}>{String(i + 1).padStart(2, '0')}</div>
                  <div className={styles.itemContent}>
                    <div className={styles.itemHeader}>
                      <Heading as="h2" className={styles.itemTitle}>{item.title}</Heading>
                      <span className={`${styles.statusBadge} ${status.className}`}>
                        {status.label}
                      </span>
                    </div>
                    <p className={styles.itemDesc}>{item.description}</p>
                    {item.subItems && (
                      <ul className={styles.subItems}>
                        {item.subItems.map((s) => (
                          <li key={s} className={styles.subItem}>{s}</li>
                        ))}
                      </ul>
                    )}
                    {(item as any).issueRefs && (
                      <div className={styles.issueRefs}>
                        {(item as any).issueRefs.map((ref: string) => (
                          <a
                            key={ref}
                            href={`https://github.com/cnoe-io/ai-platform-engineering/issues/${ref.replace('#', '')}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className={styles.issueRef}
                          >
                            {ref}
                          </a>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </section>

        <section className={styles.contribute}>
          <div className={styles.contributeInner}>
            <Heading as="h2" className={styles.contributeTitle}>
              Shape the roadmap
            </Heading>
            <p className={styles.contributeDesc}>
              CAIPE is community-driven. Open a GitHub issue to suggest a feature,
              comment on existing issues to upvote, or join the weekly Monday
              community meeting to discuss priorities directly.
            </p>
            <div className={styles.heroCtas}>
              <Link
                className={styles.primaryBtn}
                href="https://github.com/cnoe-io/ai-platform-engineering/issues/new?template=feature_request.yml"
              >
                Request a Feature ↗
              </Link>
              <Link className={styles.secondaryBtn} to="/community">
                Weekly Meeting →
              </Link>
            </div>
          </div>
        </section>
      </main>
    </Layout>
  );
}
