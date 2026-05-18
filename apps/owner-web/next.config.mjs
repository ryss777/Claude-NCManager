/** @type {import('next').NextConfig} */
const nextConfig = {
  transpilePackages: [
    "@nc-manager/shared-constants",
    "@nc-manager/validation",
  ],
};

export default nextConfig;
