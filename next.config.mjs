/** @type {import('next').NextConfig} */
const supabaseHost = (() => {
  try { return new URL(process.env.NEXT_PUBLIC_SUPABASE_URL ?? '').hostname } catch { return null }
})()

const nextConfig = {
  reactStrictMode: true,
  images: {
    remotePatterns: [
      ...(supabaseHost ? [{ protocol: 'https', hostname: supabaseHost }] : []),
      { protocol: 'https', hostname: 'images.unsplash.com' }
    ]
  },
  async redirects() {
    return [
      { source: '/refund', destination: '/cancellation-and-refund', permanent: true },
      { source: '/refund-policy', destination: '/cancellation-and-refund', permanent: true },
      { source: '/terms-of-service', destination: '/terms', permanent: true },
      { source: '/privacy-policy', destination: '/privacy', permanent: true },
    ]
  },
}
export default nextConfig
