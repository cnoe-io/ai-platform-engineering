import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",

  // No NEXT_PUBLIC_* env vars needed — config is served via GET /api/config
  // and consumed client-side through the ConfigProvider + useConfig() hook.

  // HTTP security headers — applied to all responses except the Agentic Apps
  // proxy/embed routes, which need a relaxed framing policy so the embed
  // shell at /apps/embed/<id> can same-origin-iframe the proxied app at
  // /apps/<id>/...
  //
  // Why two rules:
  //   - Global rule (default): X-Frame-Options DENY + frame-ancestors 'none'.
  //     Locks down clickjacking on every page that *isn't* an Agentic App.
  //   - /apps/* rule: relaxed to SAMEORIGIN + frame-ancestors 'self'. Only
  //     CAIPE itself (same origin) can frame these. Cross-site framing of
  //     the proxy/embed routes remains blocked.
  //
  // We deliberately avoid the negative-lookahead source matcher because Next
  // does not deduplicate headers when multiple rules match — duplicate
  // X-Frame-Options keys are interpreted as DENY by browsers. The negative
  // lookahead pattern guarantees the global rule never matches /apps/* paths,
  // so each path gets exactly one set of framing headers.
  headers: async () => [
    {
      // Negative lookahead: every path EXCEPT /apps and any descendant.
      source: '/((?!apps(?:/|$)).*)',
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
            "frame-ancestors 'none'",
          ].join('; '),
        },
      ],
    },
    {
      // Agentic Apps: allow same-origin framing for the embed shell. All
      // other clickjacking defenses (nosniff, referrer-policy, HSTS,
      // permissions-policy) stay identical.
      source: '/apps/:path*',
      headers: [
        { key: 'X-Frame-Options', value: 'SAMEORIGIN' },
        { key: 'X-Content-Type-Options', value: 'nosniff' },
        { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
        { key: 'Strict-Transport-Security', value: 'max-age=31536000; includeSubDomains' },
        { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
        {
          key: 'Content-Security-Policy-Report-Only',
          value: [
            "default-src 'self'",
            "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
            "style-src 'self' 'unsafe-inline'",
            "img-src 'self' data: blob: https:",
            "font-src 'self' data:",
            "connect-src 'self' wss: https:",
            // 'self' — only same-origin parents (i.e. CAIPE's embed shell)
            // may frame proxy responses. Cross-site embedding stays blocked.
            "frame-ancestors 'self'",
          ].join('; '),
        },
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
  webpack: (config, { isServer }) => {
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
