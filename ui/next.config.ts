import type { NextConfig } from "next";

import { MCP_REMOTE_DEPENDENCIES } from "./src/lib/tome/mcpb/mcp-remote-dependencies";

const nextConfig: NextConfig = {
  output: "standalone",

  // Keep the Okta SDK as a native Node require instead of bundling it. The SDK
  // does `const nodeFetch = require('node-fetch')` and calls it directly;
  // when bundled, CJS/ESM interop turns that into `{ default: fn }`, so the call
  // throws "nodeFetch is not a function". Externalizing preserves the raw
  // require so node-fetch resolves to the callable function.
  serverExternalPackages: ["@okta/okta-sdk-nodejs", "pdfkit"],

  // No NEXT_PUBLIC_* env vars needed — config is served via GET /api/config
  // and consumed client-side through the ConfigProvider + useConfig() hook.

  // The Tome MCP bundle route reads mcp-remote (and its full dependency
  // closure — express, open, etc.) off disk to zip into a downloadable
  // .mcpb, rather than importing them as JS modules, so Next's static-import
  // tracer never detects the dependency on its own. Force the whole closure
  // into that route's standalone trace explicitly; see
  // src/lib/tome/mcpb/mcp-remote-dependencies.ts for why this is a computed
  // list rather than just "mcp-remote/**/*" (its deps are hoisted, not
  // nested under node_modules/mcp-remote).
  outputFileTracingIncludes: {
    "/api/tome/mcp/bundle": MCP_REMOTE_DEPENDENCIES.map((pkg) => `./node_modules/${pkg}/**/*`),
    "/api/tome/projects/[slug]/export": [
      "./node_modules/dejavu-fonts-ttf/ttf/DejaVuSans.ttf",
      "./node_modules/dejavu-fonts-ttf/ttf/DejaVuSans-Oblique.ttf",
      "./node_modules/dejavu-fonts-ttf/ttf/DejaVuSans-Bold.ttf",
      "./node_modules/dejavu-fonts-ttf/ttf/DejaVuSansMono.ttf",
    ],
  },

  typescript: {
    // Local Docker rebuilds can opt out of Next's duplicate typecheck for speed.
    // CI and production builds keep type errors fatal by leaving this unset.
    ignoreBuildErrors: process.env.CAIPE_UI_FAST_BUILD === "true",
  },

  // HTTP security headers — applied to all responses
  headers: async () => [
    {
      // All routes except /apps/* proxy routes (those are iframe-embeddable)
      source: '/((?!apps/).*)',
      headers: [
        { key: 'X-Frame-Options', value: 'DENY' },
        { key: 'X-Content-Type-Options', value: 'nosniff' },
        { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
        { key: 'Strict-Transport-Security', value: 'max-age=31536000; includeSubDomains' },
        { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
        // CSP in report-only mode — monitors violations without blocking.
        // Permissive starter policy; tighten after reviewing violation reports.
        {
          key: 'Content-Security-Policy-Report-Only',
          value: [
            "default-src 'self'",
            "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
            "style-src 'self' 'unsafe-inline'",
            "img-src 'self' data: blob: https:",
            "font-src 'self' data:",
            "connect-src 'self' wss: https:",
            "frame-src 'self' https://app.vidcast.io",
            "frame-ancestors 'none'",
          ].join('; '),
        },
      ],
    },
    {
      // /apps/* proxy routes — framing allowed (these render inside AgenticAppEmbed iframe)
      source: '/apps/(.*)',
      headers: [
        { key: 'X-Content-Type-Options', value: 'nosniff' },
        { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
        { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
      ],
    },
  ],

  experimental: {
    serverActions: {
      bodySizeLimit: "2mb",
    },
  },

  // Turbopack is default in Next.js 16 — set root to silence lockfile detection warning
  turbopack: {
    root: import.meta.dirname,
  },

  // Webpack configuration (fallback for non-Turbopack builds)
  webpack: (config) => {
    // Suppress warnings for optional peer dependencies
    config.resolve.fallback = {
      ...config.resolve.fallback,
      fs: false,
      net: false,
      tls: false,
    };
    return config;
  },
};

export default nextConfig;
