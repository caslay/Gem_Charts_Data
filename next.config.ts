import type { NextConfig } from "next";

const nextConfig: NextConfig = {
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
};

export default nextConfig;
