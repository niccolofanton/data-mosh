/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'export',
  trailingSlash: true,
  skipTrailingSlashRedirect: true,
  distDir: 'out',
  images: {
    unoptimized: true,
    loader: 'custom',
    loaderFile: './src/lib/image-loader.ts',
  },
  // Ensure static generation works with client components
  typescript: {
    ignoreBuildErrors: false,
  },
  eslint: {
    ignoreDuringBuilds: false,
  },
  // Optimize for static hosting
  assetPrefix: process.env.NODE_ENV === 'production' ? '' : '',
  // Generate static pages
  generateBuildId: async () => {
    return 'data-mosh-demo-build'
  },
};

export default nextConfig;