import type {SidebarsConfig} from '@docusaurus/plugin-content-docs';

// This runs in Node.js - Don't use client-side code here (browser APIs, JSX...)

/**
 * Creating a sidebar enables you to:
 - create an ordered group of docs
 - render a sidebar for each doc of that group
 - provide next/previous navigation

 The sidebars can be generated from the filesystem, or explicitly defined here.

 Create as many sidebars as you want.
 */
const sidebars: SidebarsConfig = {
  // By default, Docusaurus generates a sidebar from the docs folder structure
  docsSidebar: [
    {
      type: 'doc',
      id: 'index', // docs/index.md
      label: 'Introduction',
    },
    {
      type: 'category',
      label: 'Getting Started',
      items: [
        {
          type: 'doc',
          id: 'getting-started/quick-start',
        },
        {
          type: 'doc',
          id: 'getting-started/local-development',
        },
        {
          type: 'doc',
          id: 'getting-started/user-interfaces',
        },
        {
          type: 'doc',
          id: 'getting-started/next-steps',
        }
      ],
    },
    {
      type: 'category',
      label: 'Setup',
      items: [
        {
          type: 'category',
          label: 'Docker',
          items: [
            {
              type: 'doc',
              id: 'getting-started/docker-compose/setup',
            },
            {
              type: 'doc',
              id: 'getting-started/docker-compose/configure-llms',
            },
            {
              type: 'doc',
              id: 'getting-started/docker-compose/configure-agent-secrets',
            },
          ],
        },
        {
          type: 'category',
          label: 'KinD',
          items: [
            {
              type: 'doc',
              id: 'getting-started/kind/setup',
            },
            {
              type: 'doc',
              id: 'getting-started/kind/configure-llms',
            },
            {
              type: 'doc',
              id: 'getting-started/kind/configure-agent-secrets',
            },
          ],
        },
        {
          type: 'category',
          label: 'Helm',
          items: [
            {
              type: 'doc',
              id: 'getting-started/helm/setup',
            },
          ],
        },
        {
          type: 'category',
          label: 'IDP Builder',
          items: [
            {
              type: 'doc',
              id: 'getting-started/idpbuilder/setup',
            },
            {
              type: 'doc',
              id: 'getting-started/idpbuilder/ubuntu-prerequisites',
            },
            {
              type: 'doc',
              id: 'getting-started/idpbuilder/manual-vault-secret-setup',
              label: 'Manual Vault Secret Setup',
            },
          ],
        },
        {
          type: 'category',
          label: 'EKS',
          items: [
            {
              type: 'doc',
              id: 'getting-started/eks/setup',
            },
            {
              type: 'doc',
              id: 'getting-started/eks/configure-agent-secrets',
            },
            {
              type: 'doc',
              id: 'getting-started/eks/configure-llms',
            },
          ],
        },
      ],
    },
    {
      type: 'category',
      label: 'Architecture',
      items: [
        {
          type: 'doc',
          id: 'architecture/index',
        },
        {
          type: 'doc',
          id: 'architecture/gateway',
        }
      ],
    },
    {
      type: 'category',
      label: 'Security',
      items: [
        {
          type: 'doc',
          id: 'security/index',
          label: 'Overview',
        },
        {
          type: 'doc',
          id: 'security/a2a-auth',
          label: 'A2A Authentication',
        }
      ],
    },
    {
      type: 'category',
      label: 'Agents & MCP Servers',
      items: [
        {
          type: 'doc',
          id: 'agents/README',
          label: 'Overview',
        },
        {
          type: 'doc',
          id: 'agents/argocd',
        },
        {
          type: 'doc',
          id: 'agents/aws',
        },
        {
          type: 'doc',
          id: 'agents/backstage',
        },
        {
          type: 'doc',
          id: 'agents/confluence',
        },
        {
          type: 'doc',
          id: 'agents/github',
        },
        {
          type: 'doc',
          id: 'agents/jira',
        },
        {
          type: 'doc',
          id: 'agents/komodor',
        },
        {
          type: 'doc',
          id: 'agents/pagerduty',
        },
        {
          type: 'doc',
          id: 'agents/slack',
        },
        {
          type: 'doc',
          id: 'agents/splunk',
        },
        {
          type: 'doc',
          id: 'agents/template',
        },
        {
          type: 'doc',
          id: 'agents/weather',
        },
        {
          type: 'doc',
          id: 'agents/webex',
        }
      ],
    },
    {
      type: 'category',
      label: 'Knowledge Bases',
      items: [
        {
          type: 'doc',
          id: 'knowledge_bases/index',
          label: 'Overview',
        },
      ],

    },
    {
      type: 'category',
      label: 'Use Cases',
      items: [
        {
          type: 'doc',
          id: 'usecases/platform-engineer',
        },
        {
          type: 'doc',
          id: 'usecases/incident-engineer',
        },
        {
          type: 'doc',
          id: 'usecases/product-owner',
        },
      ],
    },
    {
      type: 'doc',
      id: 'prompt-library/index',
      label: 'Prompt Library',
    },
    {
      type: 'category',
      label: 'Tracing & Evaluations',
      items: [
        {
          type: 'doc',
          id: 'evaluations/index',
          label: 'Overview',
        },
        {
          type: 'doc',
          id: 'evaluations/distributed-tracing-info',
          label: 'Distributed Tracing Architecture',
        },
        {
          type: 'doc',
          id: 'evaluations/tracing-implementation-guide',
          label: 'Tracing Implementation Guide',
        },
      ],
    },
    {
      type: 'category',
      label: 'Tools & Utilities',
      items: [
        {
          type: 'doc',
          id: 'tools-utils/openapi-mcp-codegen',
        },
        {
          type: 'doc',
          id: 'tools-utils/cnoe-agent-utils',
        },
        {
          type: 'doc',
          id: 'tools-utils/agent-chat-cli',
        },
        {
          type: 'doc',
          id: 'tools-utils/agent-forge-backstage-plugin',
        },
        {
          type: 'doc',
          id: 'tools-utils/jira-mcp-implementations-comparison',
        }
      ],
    },
    {
      type: 'doc',
      id: 'agent-ops/index',
      label: 'AgentOps',
    },
    {
      type: 'doc',
      id: 'contributing/index',
      label: 'Contributing',
    },
    {
      type: 'category',
      label: 'Changes & Features',
      items: [
        {
          type: 'doc',
          id: 'changes/2024-10-25-sub-agent-tool-message-streaming',
          label: '2024-10-25: Sub-Agent Tool Message Streaming',
        },
        {
          type: 'doc',
          id: 'changes/2024-10-23-platform-engineer-streaming-architecture',
          label: '2024-10-23: Platform Engineer Streaming Architecture',
        },
        {
          type: 'doc',
          id: 'changes/2024-10-23-prompt-templates-readme',
          label: '2024-10-23: Prompt Templates',
        },
        {
          type: 'doc',
          id: 'changes/2024-10-22-enhanced-streaming-feature',
          label: '2024-10-22: Enhanced Streaming Feature',
        },
        {
          type: 'doc',
          id: 'changes/2024-10-22-implementation-summary',
          label: '2024-10-22: Implementation Summary',
        },
        {
          type: 'doc',
          id: 'changes/2024-10-22-base-agent-refactor',
          label: '2024-10-22: Base Agent Refactor',
        },
        {
          type: 'doc',
          id: 'changes/2024-10-22-agent-refactoring-summary',
          label: '2024-10-22: Agent Refactoring Summary',
        },
        {
          type: 'doc',
          id: 'changes/2024-10-22-streaming-architecture',
          label: '2024-10-22: Streaming Architecture',
        },
        {
          type: 'doc',
          id: 'changes/2024-10-22-a2a-intermediate-states',
          label: '2024-10-22: A2A Intermediate States',
        },
        {
          type: 'doc',
          id: 'changes/2024-10-22-prompt-configuration',
          label: '2024-10-22: Prompt Configuration',
        },
      ],
    },
    {
      type: 'category',
      label: 'Workshop - Mars Colony',
      items: [
        {
          type: 'doc',
          id: 'workshop/flyer',
          label: 'Register',
        },
        {
          type: 'doc',
          id: 'workshop/README',
          label: 'Workshop Overview',
        },
        {
          type: 'doc',
          id: 'workshop/overview',
          label: 'Mission Overview',
        },
        {
          type: 'doc',
          id: 'workshop/mission1',
          label: 'Mission 1: Start Ignition',
        },
        {
          type: 'doc',
          id: 'workshop/mission2',
          label: 'Mission 2: Run Standalone Petstore Agent',
        },
        {
          type: 'doc',
          id: 'workshop/mission3',
          label: 'Mission 3: Multi-Agent System',
        },
        {
          type: 'doc',
          id: 'workshop/mission4',
          label: 'Mission 4: Reconnaissance & Reporting',
        },
        {
          type: 'doc',
          id: 'workshop/mission6',
          label: 'Mission 6: Deploy CAIPE with IDPBuilder',
        },
        {
          type: 'doc',
          id: 'workshop/mission7',
          label: 'Mission 7: Tracing and Evaluation',
        }
      ],
    },

  ],
  communitySidebar: [
    {
      type: 'category',
      label: 'Community',
      items: [
        {
          type: 'doc',
          id: 'community/index',
          label: 'Community Overview',
        },
        {
          type: 'doc',
          id: 'community/meeting-recordings',
          label: 'Meeting Recordings',
        },
      ],
    },
  ]
};

export default sidebars;
