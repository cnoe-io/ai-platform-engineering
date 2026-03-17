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
            {
              type: 'category',
              label: 'Chart Reference',
              items: [
                {
                  type: 'doc',
                  id: 'installation/helm-charts/supervisor-agent',
                  label: 'supervisor-agent',
                },
                {
                  type: 'doc',
                  id: 'installation/helm-charts/langgraph-redis',
                  label: 'langgraph-redis',
                },
              ],
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
      label: 'Development',
      items: [
        {
          type: 'doc',
          id: 'development/index',
          label: 'Overview',
        },
        {
          type: 'doc',
          id: 'development/development-environment',
          label: 'Development Environment',
        },
        {
          type: 'doc',
          id: 'development/creating-an-agent',
          label: 'Creating an Agent',
        },
        {
          type: 'doc',
          id: 'development/creating-mcp-server',
          label: 'Creating an MCP Server',
        },
        {
          type: 'doc',
          id: 'development/spec-driven-development',
          label: 'Spec-Driven Development',
        }
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
          id: 'agents/gitlab',
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
          id: 'agents/victorops',
        },
        {
          type: 'doc',
          id: 'agents/webex',
        }
      ],
    },
    {
      type: 'category',
      label: 'Integrations',
      items: [
        {
          type: 'doc',
          id: 'integrations/slack-bot',
          label: 'Slack Bot',
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
          id: 'knowledge_bases/architecture',
          label: 'Architecture',
        },
        {
          type: 'doc',
          id: 'knowledge_bases/ingestors',
          label: 'Ingestors',
        },
        {
          type: 'doc',
          id: 'knowledge_bases/ontology-agent',
          label: 'Ontology Agent',
        },
        {
          type: 'doc',
          id: 'knowledge_bases/mcp-tools',
          label: 'MCP Tools',
        },
        {
          type: 'doc',
          id: 'knowledge_bases/authentication-overview',
          label: 'Authentication',
        },
      ],
    },
    {
      type: 'category',
      label: '🎨 CAIPE UI',
      items: [
        {
          type: 'doc',
          id: 'ui/index',
          label: 'Overview',
        },
        {
          type: 'doc',
          id: 'ui/features',
          label: 'Features',
        },
        {
          type: 'doc',
          id: 'ui/auth-flow',
          label: 'Authentication Flow',
        },
        {
          type: 'doc',
          id: 'ui/configuration',
          label: 'Configuration',
        },
        {
          type: 'doc',
          id: 'ui/customization',
          label: 'Customization & Branding',
        },
        {
          type: 'doc',
          id: 'ui/development',
          label: 'Development Guide',
        },
        {
          type: 'doc',
          id: 'ui/api-reference',
          label: 'API Reference',
        },
        {
          type: 'doc',
          id: 'ui/troubleshooting',
          label: 'Troubleshooting',
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
      label: 'Specifications',
      items: [
        {
          type: 'autogenerated',
          dirName: 'specs',
        },
      ],
    },
    {
      type: 'category',
      label: 'CAIPE Labs',
      items: [
        {
          type: 'doc',
          id: 'workshop/caipeintro',
          label: 'Introduction to CAIPE',
        },
        {
          type: 'doc',
          id: 'workshop/agent',
          label: 'Introduction to AI Agents',
        },
        {
          type: 'doc',
          id: 'workshop/mas',
          label: 'Multi-Agent System',
        },
        {
          type: 'doc',
          id: 'workshop/rag',
          label: 'RAG (Retrieval-Augmented Generation)',
        },
        {
          type: 'doc',
          id: 'workshop/tracing',
          label: 'Tracing',
        },
        {
          type: 'doc',
          id: 'workshop/conclusion',
          label: 'Conclusion',
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
