import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  poweredByHeader: false,
  outputFileTracingIncludes: { "/*": ["./drizzle/*.sql"] },
  experimental: { serverActions: { bodySizeLimit: "20mb" } },
};

export default nextConfig;
