/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  transpilePackages: ['@vexa/types'],
  experimental: {
    typedRoutes: false,
  },
}

export default nextConfig
