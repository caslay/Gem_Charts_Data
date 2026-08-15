import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  rewrites: async () => {
    return [
      {
        source: "/api/py/:path*",
        destination:
          process.env.NODE_ENV === "development"
            ? "http://127.0.0.1:8000/api/py/:path*"
            : "/api/",
      },
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
