import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",

  // No NEXT_PUBLIC_* env vars needed — config is served via GET /api/config
  // and consumed client-side through the ConfigProvider + useConfig() hook.

  // HTTP security headers — applied to all responses
  headers: async () => [
    {
      source: '/(.*)',
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
