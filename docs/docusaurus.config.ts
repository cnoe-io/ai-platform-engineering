import {themes as prismThemes} from 'prism-react-renderer';
import type {Config} from '@docusaurus/types';
import type * as Preset from '@docusaurus/preset-classic';

// This runs in Node.js - Don't use client-side code here (browser APIs, JSX...)

const config: Config = {
  title: 'CAIPE',
  tagline: 'AI-powered Platform Engineering — deploy intelligent agents for your platform stack.',
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

  // Even if you don't use internationalization, you can use this field to set
  // useful metadata like html lang. For example, if your site is Chinese, you
  // may want to replace "en" with "zh-Hans".
  i18n: {
    defaultLocale: 'en',
    locales: ['en'],
  },

  plugins: [
    [
      require.resolve('docusaurus-lunr-search'), {
        languages: ['en'],
        title: { boost: 200 },
        content: { boost: 2 },
        keywords: { boost: 100 }
      }
    ],
    [
      '@docusaurus/plugin-client-redirects',
      {
        redirects: [
          // Old docs-based release notes → new blog posts
          {from: '/releases/release-0.4.9', to: '/blog/releases/release-0.4.9'},
          {from: '/releases/release-0.4.8', to: '/blog/releases/release-0.4.8'},
          {from: '/releases/release-0.4.7', to: '/blog/releases/release-0.4.7'},
          {from: '/releases/release-0.4.6', to: '/blog/releases/release-0.4.6'},
          {from: '/releases/release-0.4.5', to: '/blog/releases/release-0.4.5'},
          {from: '/releases/release-0.4.4', to: '/blog/releases/release-0.4.4'},
          {from: '/releases/release-0.4.3', to: '/blog/releases/release-0.4.3'},
          {from: '/releases/release-0.4.2', to: '/blog/releases/release-0.4.2'},
          {from: '/releases/release-0.4.1', to: '/blog/releases/release-0.4.1'},
          {from: '/releases/release-0.4.0', to: '/blog/releases/release-0.4.0'},
          // Old migration guide docs → embedded in release blog posts
          {from: '/releases/migration-0.4.7-to-0.4.8', to: '/blog/releases/release-0.4.8'},
          {from: '/releases/migration-0.4.6-to-0.4.7', to: '/blog/releases/release-0.4.7'},
          {from: '/releases/migration-0.4.5-to-0.4.6', to: '/blog/releases/release-0.4.6'},
          {from: '/releases/migration-0.4.4-to-0.4.5', to: '/blog/releases/release-0.4.5'},
          {from: '/releases/migration-0.4.3-to-0.4.4', to: '/blog/releases/release-0.4.4'},
          {from: '/releases/migration-0.4.2-to-0.4.3', to: '/blog/releases/release-0.4.3'},
          {from: '/releases/migration-0.4.1-to-0.4.2', to: '/blog/releases/release-0.4.2'},
          {from: '/releases/migration-0.4.0-to-0.4.1', to: '/blog/releases/release-0.4.1'},
          {from: '/releases/migration-0.3.x-to-0.4.0', to: '/blog/releases/release-0.4.0'},
          {from: '/releases/migration-0.2.41-to-0.3.2', to: '/blog/releases/release-0.3.2'},
          {from: '/releases', to: '/blog/releases'},
        ],
      },
    ],
    [
      '@docusaurus/plugin-content-blog',
      {
        id: 'releases',
        path: 'releases',
        routeBasePath: 'blog/releases',
        blogTitle: 'Releases',
        blogDescription: 'CAIPE release notes and upgrade guides',
        showReadingTime: false,
        blogSidebarCount: 'ALL',
        blogSidebarTitle: 'All Releases',
        onInlineTags: 'warn',
        onInlineAuthors: 'warn',
        onUntruncatedBlogPosts: 'warn',
      },
    ],
  ],

  presets: [
    [
      'classic',
      {
        docs: {
          routeBasePath: '/docs',
          sidebarPath: './sidebars.ts',
          editUrl:
            'https://github.com/cnoe-io/ai-platform-engineering/tree/main/docs',
          lastVersion: '0.4.9',
          versions: {
            current: {
              label: 'main 🚧',
              path: 'next',
              badge: true,
            },
            '0.4.9': {
              label: '0.4.9 (Latest)',
              path: '',
              badge: false,
            },
            '0.4.8': {
              label: '0.4.8',
              path: '0.4.8',
              badge: false,
            },
          },
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
    image: 'img/logo.svg',
    colorMode: {
      defaultMode: 'dark',
      disableSwitch: false,
      respectPrefersColorScheme: false,
    },
    navbar: {
      title: 'CAIPE',
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
        {to: '/blog/releases', label: 'Releases', position: 'left'},
        {to: '/features', label: 'Features', position: 'left'},
        {to: '/roadmap', label: 'Roadmap', position: 'left'},
        {to: '/community', label: 'Community', position: 'left'},
        {to: '/blog', label: 'Blog', position: 'left'},
        {
          type: 'docsVersionDropdown',
          position: 'left',
        },
        {
          href: 'https://github.com/cnoe-io/ai-platform-engineering',
          label: '⭐ Star Repo',
          position: 'right',
          className: 'navbar-star-btn',
        },
        {
          href: 'https://github.com/cnoe-io/ai-platform-engineering',
          position: 'right',
          className: 'header-github-link',
          'aria-label': 'GitHub repository',
        },
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
              to: '/docs/getting-started',
            },
            {
              label: 'Architecture',
              to: '/docs/architecture',
            },
            {
              label: 'Installation',
              to: '/docs/installation',
            },
            {
              label: 'Contributing',
              to: '/docs/contributing',
            },
            {
              label: 'Releases',
              to: '/blog/releases',
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
      copyright: `Copyright © ${new Date().getFullYear()} CAIPE.io OSS Contributors. Built with Docusaurus.`,
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
    hooks: {
      onBrokenMarkdownLinks: 'warn',
    },
  },
  themes: ['@docusaurus/theme-mermaid'],
};

export default config;
