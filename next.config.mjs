/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'export',
  trailingSlash: true,
  skipTrailingSlashRedirect: true,
  // No `distDir`. `output: 'export'` writes the exported site to `out/`, so
  // pointing the webpack build directory at the same folder buried the deploy
  // artefact under build internals - `out/cache` alone reached 56 MB of webpack
  // .pack.gz files, next to `out/server`, `out/types` and megabytes of unminified
  // dev chunks. The README says to upload the contents of `out/`, so all of it
  // shipped. The default (`.next`) keeps the two apart.
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