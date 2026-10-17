import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  skipTrailingSlashRedirect: true,
  /* config options here */
  typescript: {
    ignoreBuildErrors: true,
  },
  reactStrictMode: false,
};

export default nextConfig;
