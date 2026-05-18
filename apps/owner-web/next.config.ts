import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  transpilePackages: [
    "@nc-manager/shared-constants",
    "@nc-manager/validation",
  ],
};

export default nextConfig;
