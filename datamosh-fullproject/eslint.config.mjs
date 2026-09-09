import js from '@eslint/js';
import globals from 'globals';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  // Build artefacts: Vite writes the static site into `dist`.
  { ignores: ['dist/**'] },
  {
    files: ['**/*.{ts,tsx}'],
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    languageOptions: {
      ecmaVersion: 2020,
      globals: globals.browser,
    },
    plugins: {
      'react-hooks': reactHooks,
      'react-refresh': reactRefresh,
    },
    rules: {
      // The two hook rules `next/core-web-vitals` used to provide. The plugin's
      // own `recommended` set now also turns on the React Compiler rules
      // (purity, immutability, refs, set-state-in-effect), which a
      // react-three-fiber scene breaks by design: `useFrame` mutates objects
      // and refs every frame on purpose. Widening the gate is a separate call
      // from moving off Next.
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',
      'react-refresh/only-export-components': ['warn', { allowConstantExport: true }],
    },
  },
);
