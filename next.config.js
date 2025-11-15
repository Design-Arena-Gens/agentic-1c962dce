/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  experimental: {
    serverActions: { allowedOrigins: ["agentic-1c962dce.vercel.app", "localhost"] }
  }
};

module.exports = nextConfig;
