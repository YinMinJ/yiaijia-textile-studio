import type { NextConfig } from "next";
import { appBasePath } from "./lib/app-path.ts";

const nextConfig: NextConfig = {
  basePath: appBasePath(),
  // Nginx exposes the directory URL /zhijing/; retain that URL at the app root.
  skipTrailingSlashRedirect: Boolean(appBasePath()),
  output: "standalone",
  poweredByHeader: false,
  outputFileTracingIncludes: { "/*": ["./drizzle/*.sql"] },
  experimental: { serverActions: { bodySizeLimit: "20mb" } },
};

export default nextConfig;
