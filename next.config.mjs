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
    // Next 14 cannot discover ESLint 9 flat config (`eslint.config.mjs`), so its
    // built-in lint step silently does nothing here regardless of this flag.
    // Rather than keep a setting that promises a check that never runs, linting
    // is an explicit step: the `build` script runs `eslint src` before `next
    // build`, so the gate is real. Run it on its own with `pnpm lint`.
    ignoreDuringBuilds: true,
  },
  // Optimize for static hosting
  assetPrefix: process.env.NODE_ENV === 'production' ? '' : '',
  // Generate static pages
  generateBuildId: async () => {
    return 'data-mosh-demo-build'
  },
};

export default nextConfig;