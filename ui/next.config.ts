import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",

  // No NEXT_PUBLIC_* env vars needed — config is served via GET /api/config
  // and consumed client-side through the ConfigProvider + useConfig() hook.

  experimental: {
    serverActions: {
      bodySizeLimit: "2mb",
    },
  },

  // Turbopack is default in Next.js 16 - empty config silences migration warning
  turbopack: {},

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
