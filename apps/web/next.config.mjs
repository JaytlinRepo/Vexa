/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  transpilePackages: ['@vexa/types'],
  experimental: {
    typedRoutes: false,
  },
  async rewrites() {
    const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000'
    return [
      { source: '/api/:path*', destination: `${apiUrl}/api/:path*` },
    ]
  },
}

export default nextConfig
