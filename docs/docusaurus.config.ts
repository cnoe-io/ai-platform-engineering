import {themes as prismThemes} from 'prism-react-renderer';
import type {Config} from '@docusaurus/types';
import type * as Preset from '@docusaurus/preset-classic';

// This runs in Node.js - Don't use client-side code here (browser APIs, JSX...)

const config: Config = {
  title: 'CAIPE (Community AI Platform Engineering)',
  tagline: 'Community AI Platform Engineering Multi-Agent Systems',
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

  plugins: [[
    require.resolve('docusaurus-lunr-search'), {
      languages: ['en'],
      title: { boost: 200 },
      content: { boost: 2 },
      keywords: { boost: 100 }
    }
  ]],

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
      title: 'CAIPE (Community AI Platform Engineering)',
      logo: {
        alt: 'CAIPE Logo',
        src: 'img/logo.svg',
      },
      items: [
        {
          type: 'docSidebar',
          sidebarId: 'docsSidebar',
          position: 'left',
          label: 'Docs',
        },
        {to: '/blog', label: 'Blog', position: 'left'},
        {
          type: 'docSidebar',
          sidebarId: 'communitySidebar',
          position: 'left',
          label: 'Community',
        },
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
            <a href="https://github.com/cnoe-io/ai-platform-engineering/issues" target="_blank" rel="noopener">
              <img alt="GitHub issues" src="https://img.shields.io/github/issues/cnoe-io/ai-platform-engineering?style=social" style="vertical-align: middle;" />
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
              label: 'GitHub Repository',
              href: 'https://github.com/cnoe-io/ai-platform-engineering',
            },
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
      additionalLanguages: [
        'bash',
        'yaml',
        'diff'
      ],
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
