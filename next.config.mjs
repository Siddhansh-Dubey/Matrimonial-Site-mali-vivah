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
      // Canonical legal routes are /privacy-policy and /terms-and-conditions;
      // the old page locations redirect so existing links never break.
      { source: '/terms', destination: '/terms-and-conditions', permanent: true },
      { source: '/terms-of-service', destination: '/terms-and-conditions', permanent: true },
      { source: '/privacy', destination: '/privacy-policy', permanent: true },
    ]
  },
}
export default nextConfig
