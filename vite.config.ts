import { defineConfig } from 'vitest/config';

// Relative base so the build works from any GitHub Pages sub-path (e.g. /afk/).
export default defineConfig({
  base: './',
  build: { target: 'es2022', chunkSizeWarningLimit: 900 },
  test: { environment: 'node', include: ['tests/**/*.test.ts'] },
});
