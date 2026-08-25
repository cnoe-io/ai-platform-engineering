import * as fs from 'fs';
import * as path from 'path';
import {themes as prismThemes} from 'prism-react-renderer';
import type {Config} from '@docusaurus/types';
import type * as Preset from '@docusaurus/preset-classic';

// This runs in Node.js - Don't use client-side code here (browser APIs, JSX...)

// Versioned docs are generated at build time (see scripts/generate-versioned-docs.js)
// and `versions-config.json` is git-ignored. When it is absent (e.g. local authoring
// without generating versions), fall back to a current-docs-only build.
type VersionsConfig = {
  lastVersion: string;
  versions: Record<string, { label: string; path: string; badge: boolean }>;
};

const versionsConfigPath = path.join(__dirname, 'versions-config.json');
const versionsConfig: VersionsConfig | null = fs.existsSync(versionsConfigPath)
  ? (JSON.parse(fs.readFileSync(versionsConfigPath, 'utf8')) as VersionsConfig)
  : null;

// Release notes are published one post per minor series (`release-0.5.x`), not per patch.
// Every historical patch post and standalone migration guide had a live public URL, so
// each one redirects to the series post that now covers it. Release notes also used to
// live under `/blog/releases`; `/releases` is canonical, so both prefixes redirect.
const patchSlugs = (minor: string, latest: number) =>
  Array.from({length: latest + 1}, (_, patch) => `release-${minor}.${patch}`);

// Pre-0.5 upgrade guides shipped as their own pages. The 0.4.x series post carries the
// only guide still worth reading (0.3.x → 0.4.x), so they all land there.
const legacyMigrationSlugs = [
  'migration-0.2.41-to-0.3.2',
  'migration-0.3.x-to-0.4.0',
  ...Array.from({length: 8}, (_, i) => `migration-0.4.${i}-to-0.4.${i + 1}`),
];

const retiredReleaseSlugs: Record<string, string[]> = {
  'release-0.4.x': ['release-0.3.2', ...patchSlugs('0.4', 18), ...legacyMigrationSlugs],
  'release-0.5.x': [...patchSlugs('0.5', 69), 'release-0.5.52-upgrade-guide'],
  'release-0.6.x': patchSlugs('0.6', 0),
};

const releaseRedirects = [
  ...Object.entries(retiredReleaseSlugs).map(([series, slugs]) => ({
    to: `/releases/${series}`,
    from: slugs.flatMap((slug) => [`/releases/${slug}`, `/blog/releases/${slug}`]),
  })),
  {from: '/blog/releases', to: '/releases'},
];

const config: Config = {
  title: 'CAIPE',
  tagline: 'AI-powered Platform Engineering — deploy intelligent agents for your platform stack.',
  favicon: 'img/favicon.ico',

  // Future flags, see https://docusaurus.io/docs/api/docusaurus-config#future
  future: {
    v4: true, // Improve compatibility with the upcoming Docusaurus v4
  },

  // GitHub Pages serves the project from the custom domain root.
  url: 'https://caipe.io',
  baseUrl: '/',

  // GitHub pages deployment config.
  // If you aren't using GitHub pages, you don't need these.
  organizationName: 'cnoe-io', // Usually your GitHub org/user name.
  projectName: 'ai-platform-engineering', // Usually your repo name.

  clientModules: ['./src/clientModules/mermaidFullscreen.js'],

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
        // Keep custom-domain links that still include the former GitHub Pages
        // project path valid.
        createRedirects(existingPath: string) {
          return `/ai-platform-engineering${existingPath}`;
        },
        redirects: [
          // GitHub Pages strips the project prefix from legacy host URLs. These
          // historically published docs links also omitted the /docs route.
          {from: '/getting-started/quick-start', to: '/docs/getting-started/quick-start'},
          {from: '/knowledge_bases/graph_rag', to: '/docs/knowledge_bases/'},
          // /docs/index has no real page; redirect to Quick Start
          {from: '/docs/index', to: '/docs/getting-started/quick-start'},
          ...releaseRedirects,
        ],
      },
    ],
    [
      '@docusaurus/plugin-content-blog',
      {
        id: 'releases',
        path: 'releases',
        routeBasePath: 'releases',
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
          ...(versionsConfig
            ? {
                lastVersion: versionsConfig.lastVersion,
                versions: versionsConfig.versions,
              }
            : {}),
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
        ...(versionsConfig ? [{
          type: 'docsVersionDropdown' as const,
          position: 'left' as const,
          dropdownActiveClassDisabled: true,
        }] : []),
        {to: '/features', label: 'Features', position: 'left'},
        {to: '/roadmap', label: 'Roadmap', position: 'left'},
        {to: '/community', label: 'Community', position: 'left'},
        {to: '/releases', label: 'Releases', position: 'left'},
        {to: '/blog', label: 'Blog', position: 'left'},
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
              to: '/releases',
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
              href: 'https://caipe.io/community',
            },
            {
              label: 'Slack Channel',
              href: 'https://cloud-native.slack.com/archives/C08N0AKR52S',
            },
            {
              label: 'Meeting Recordings',
              href: 'https://www.youtube.com/@cnoe-community',
            },
            {
              label: 'Governance',
              href: 'https://github.com/caipe-io/governance',
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
              label: 'CAIPE.io',
              href: 'https://caipe.io',
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
      theme: {light: 'neutral', dark: 'dark'},
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
