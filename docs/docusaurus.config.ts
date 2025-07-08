import {themes as prismThemes} from 'prism-react-renderer';
import type {Config} from '@docusaurus/types';
import type * as Preset from '@docusaurus/preset-classic';

// This runs in Node.js - Don't use client-side code here (browser APIs, JSX...)

const config: Config = {
  title: 'AI Platform Engineering',
  tagline: 'AI Platform Engineering Multi-Agent Systems',
  favicon: 'img/favicon.ico',

  // Future flags, see https://docusaurus.io/docs/api/docusaurus-config#future
  future: {
    v4: true, // Improve compatibility with the upcoming Docusaurus v4
  },

  // Set the production url of your site here
  url: 'https://cnoe-io.github.io',
  // Set the /<baseUrl>/ pathname under which your site is served
  // For GitHub pages deployment, it is often '/<projectName>/'
  baseUrl: '/ai-platform-engineering/',

  // GitHub pages deployment config.
  // If you aren't using GitHub pages, you don't need these.
  organizationName: 'cnoe.io', // Usually your GitHub org/user name.
  projectName: 'ai-platform-engineering', // Usually your repo name.

  onBrokenLinks: 'throw',
  onBrokenMarkdownLinks: 'warn',

  // Even if you don't use internationalization, you can use this field to set
  // useful metadata like html lang. For example, if your site is Chinese, you
  // may want to replace "en" with "zh-Hans".
  i18n: {
    defaultLocale: 'en',
    locales: ['en'],
  },

  presets: [
    [
      'classic',
      {
        docs: {
          routeBasePath: '/', // Serve the docs at the site's root
          sidebarPath: './sidebars.ts',
          // Please change this to your repo.
          // Remove this to remove the "edit this page" links.
          editUrl:
            'https://github.com/cnoe-io/ai-platform-engineering/tree/main/docs',
        },
        blog: {
          showReadingTime: true,
          feedOptions: {
            type: ['rss', 'atom'],
            xslt: true,
          },
          // Please change this to your repo.
          // Remove this to remove the "edit this page" links.
          editUrl:
            'https://github.com/cnoe-io/ai-platform-engineering/tree/main/docs',
          // Useful options to enforce blogging best practices
          onInlineTags: 'warn',
          onInlineAuthors: 'warn',
          onUntruncatedBlogPosts: 'warn',
        },
        theme: {
          customCss: './src/css/custom.css',
        },
      } satisfies Preset.Options,
    ],
  ],

  themeConfig: {
    // Replace with your project's social card
    image: 'img/logo.svg',
    navbar: {
      title: 'AI Platform Engineering',
      logo: {
        alt: 'AI Platform Engineering Logo',
        src: 'img/logo.svg',
      },
      items: [
        {
          type: 'docSidebar',
          sidebarId: 'gettingStartedSidebar',
          position: 'left',
          label: 'Getting Started',
        },
        {
          type: 'docSidebar',
          sidebarId: 'architectureSidebar',
          dirName: 'docs/architecture',
          position: 'left',
          label: 'Architecture',
        },
        {
          type: 'docSidebar',
          sidebarId: 'securitySidebar',
          dirName: 'docs/security',
          position: 'left',
          label: 'Security',
        },
        {
          type: 'docSidebar',
          sidebarId: 'agentsSidebar',
          dirName: 'docs/agents',
          position: 'left',
          label: 'Agents',
        },
        {
          type: 'docSidebar',
          sidebarId: 'evaluationsSidebar',
          dirName: 'docs/evaluations',
          position: 'left',
          label: 'Evaluations',
        },
        {
          type: 'docSidebar',
          sidebarId: 'usecasesSidebar',
          dirName: 'docs/usecases',
          position: 'left',
          label: 'Use Cases',
        },
        {
          type: 'docSidebar',
          sidebarId: 'promptLibrarySidebar',
          dirName: 'docs/prompt-library',
          position: 'left',
          label: 'Prompt Library',
        },
        {
          type: 'docSidebar',
          sidebarId: 'agentOpsSidebar',
          dirName: 'docs/agent-ops',
          position: 'left',
          label: 'Agent Ops',
        },
        {
          type: 'docSidebar',
          sidebarId: 'contributingSidebar',
          dirName: 'docs/contributing',
          position: 'left',
          label: 'Contributing',
        },
        {to: '/blog', label: 'Blog', position: 'left'},
        // Uncomment the following lines to enable versioning
        // {
        //   type: 'docsVersionDropdown',
        // },
        // --- START: GITHUB BADGES ---
        {
          type: 'html',
          position: 'right',
          value: `
            <a href="https://github.com/cnoe-io/ai-platform-engineering" target="_blank" rel="noopener" style="margin-right: 8px;">
              <img alt="GitHub stars" src="https://img.shields.io/github/stars/cnoe-io/ai-platform-engineering?style=social" style="vertical-align: middle;" />
            </a>
            <a href="https://github.com/cnoe-io/ai-platform-engineering/fork" target="_blank" rel="noopener">
              <img alt="GitHub forks" src="https://img.shields.io/github/forks/cnoe-io/ai-platform-engineering?style=social" style="vertical-align: middle;" />
            </a>
          `,
        },
        // --- END: GITHUB BADGES ---
        {
          href: 'https://github.com/cnoe-io/ai-platform-engineering',
          label: 'GitHub',
          position: 'right',
          className: 'header-github-link',
          'aria-label': 'GitHub repository',
        }
      ],
    },
    footer: {
      style: 'dark',
      links: [
        {
          title: 'Docs',
          items: [
            {
              label: 'Getting Started',
              to: '/getting-started',
            },
            {
              label: 'Architecture',
              to: '/architecture',
            },
            {
              label: 'Installation',
              to: '/installation',
            },
            {
              label: 'Contributing',
              to: '/contributing',
            },
          ],
        },
        {
          title: 'Project',
          items: [
            {
              label: 'Project Roadmap',
              href: 'https://github.com/orgs/cnoe-io/projects/9',
            },
            {
              label: 'Github Issue Tracker',
              href: 'https://github.com/cnoe-io/ai-platform-engineering/issues',
            },
            {
              label: 'Community Meeting',
              href: 'https://github.com/cnoe-io/ai-platform-engineering#agentic-ai-sig-community',
            },
            {
              label: 'Slack Channel',
              href: 'https://cloud-native.slack.com/archives/C08N0AKR52S',
            },
            {
              label: 'Meeting Recordings',
              href: 'https://github.com/cnoe-io/agentic-ai/wiki/Meeting-Recordings',
            },
            {
              label: 'CNOE Agentic AI SIG Governance',
              href: 'https://github.com/cnoe-io/governance/tree/main/sigs/agentic-ai',
            }
          ],
        },
        {
          title: 'More',
          items: [
            {
              label: 'openapi-mcp-generator',
              href: 'https://github.com/cnoe-io/openapi-mcp-codegen',
            },
            {
              label: 'cnoe-agent-utils',
              href: 'https://github.com/cnoe-io/cnoe-agent-utils',
            },
            {
              label: 'CNOE.io',
              href: 'https://cnoe.io',
            },
          ],
        },
      ],
      copyright: `Copyright © ${new Date().getFullYear()} CNOE.io Agentic AI SIG Contributors. Built with Docusaurus.`,
    },
    prism: {
      theme: prismThemes.github,
      darkTheme: prismThemes.dracula,
    },
    mermaid: {
      theme: {dark: 'forest'},
    },
  } satisfies Preset.ThemeConfig,

  markdown: {
    mermaid: true,
  },
  themes: ['@docusaurus/theme-mermaid'],
};

export default config;
