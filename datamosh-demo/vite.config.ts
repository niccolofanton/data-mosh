import { defineConfig } from 'vite';

export default defineConfig({
  // Relative asset URLs: Codrops deploys the demo into a dedicated directory on
  // their server, not at a host root, so `/assets/...` would 404 there.
  base: './',
  // three.js alone is past Rollup's default 500 kB warning threshold.
  build: { chunkSizeWarningLimit: 1500 },
});
