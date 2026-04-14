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
  // Public companion scripts (/*.js) are where we iterate fastest; tell
  // browsers not to cache them so dev reloads always get fresh code.
  async headers() {
    return [
      {
        source: '/:path*.js',
        headers: [
          { key: 'Cache-Control', value: 'no-store, no-cache, must-revalidate' },
        ],
      },
    ]
  },
}

export default nextConfig
