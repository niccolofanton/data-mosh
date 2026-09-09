import { fileURLToPath, URL } from 'node:url';

import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  // Relative asset URLs. Codrops deploys demos into a dedicated directory on
  // their server rather than at a host root, so every emitted URL - the bundle,
  // the icons, and `import.meta.env.BASE_URL` in the source - has to resolve
  // against the document instead of against `/`.
  base: './',
  plugins: [react()],
  resolve: {
    // The `@/...` imports the source uses throughout, resolved the same way the
    // TypeScript `paths` entry in `tsconfig.json` resolves them.
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  build: {
    // three.js alone is past Rollup's default 500 kB warning threshold, and the
    // whole point of this page is to ship a WebGL scene, so the warning carries
    // no information here.
    chunkSizeWarningLimit: 1500,
  },
});
