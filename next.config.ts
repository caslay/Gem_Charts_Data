import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ["pg"],
  turbopack: {},
  typescript: {
    ignoreBuildErrors: true,
  },
  rewrites: async () => {
    return [
      // RFC 8414 OAuth Authorization Server Metadata — required by Gemini Spark
      // Cannot be a Next.js App Router directory (starts with '.'), so we rewrite.
      {
        source: "/.well-known/oauth-authorization-server",
        destination: "/api/oauth/discovery",
      },
    ];
  },
  webpack: (config, { isServer }) => {
    // Client‑side fallback – keep existing behavior
    if (!isServer) {
      config.resolve = config.resolve || {};
      config.resolve.fallback = {
        ...config.resolve.fallback,
        pg: false,
        "pg-native": false,
        "pg-cloudflare": false,
        net: false,
        tls: false,
        dns: false,
        fs: false,
      };
    }

    // Server‑side externals – tell webpack not to bundle `pg`
    if (isServer) {
      config.externals = config.externals || {};
      // Use CommonJS external so Node can require it at runtime
      config.externals['pg'] = 'commonjs pg';
    }
    return config;
  },
};

export default nextConfig;
