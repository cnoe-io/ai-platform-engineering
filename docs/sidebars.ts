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
          label: 'IDP Builder',
          items: [
            {
              type: 'doc',
              id: 'getting-started/idpbuilder/setup',
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
        }
      ],
    },
    {
      type: 'doc',
      id: 'security/index',
      label: 'Security',
    },
    {
      type: 'category',
      label: 'Agents & MCP Servers',
      items: [
        {
          type: 'doc',
          id: 'agents/index',
          label: 'Overview',
        },
        {
          type: 'doc',
          id: 'agents/argocd',
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
          id: 'agents/kubernetes',
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
          id: 'agents/template',
        },
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
        {
          type: 'doc',
          id: 'knowledge_bases/rag',
          label: 'RAG',
        },
        {
          type: 'doc',
          id: 'knowledge_bases/graph_rag',
          label: 'Graph RAG',
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
