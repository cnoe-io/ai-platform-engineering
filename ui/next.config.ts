import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",

  // Environment variables exposed to the browser (must use NEXT_PUBLIC_ prefix)
  // Server-side variables are available without the prefix
  env: {
    // These are fallback values - actual values come from runtime env
    NEXT_PUBLIC_CAIPE_URL: process.env.NEXT_PUBLIC_CAIPE_URL || process.env.CAIPE_URL || "http://localhost:8000",
  },

  experimental: {
    serverActions: {
      bodySizeLimit: "2mb",
    },
  },

  // Proxy API requests to backend server (MongoDB chat history API)
  async rewrites() {
    const backendUrl = process.env.NEXT_PUBLIC_CAIPE_URL || process.env.CAIPE_URL || "http://localhost:8000";
    
    return [
      {
        source: "/api/chat/:path*",
        destination: `${backendUrl}/api/chat/:path*`,
      },
      {
        source: "/api/users/:path*",
        destination: `${backendUrl}/api/users/:path*`,
      },
      {
        source: "/api/notifications/:path*",
        destination: `${backendUrl}/api/notifications/:path*`,
      },
    ];
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
