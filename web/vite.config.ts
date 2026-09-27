import { defineConfig } from 'vitest/config';

export default defineConfig({
  // Relative asset URLs so the build works from any sub-path (Cloudflare Pages,
  // GitHub Pages project sites, a plain folder on a USB stick).
  base: './',
  build: {
    target: 'es2022',
    outDir: 'dist',
    emptyOutDir: true,
    sourcemap: false,
    chunkSizeWarningLimit: 512,
  },
  server: {
    port: 5173,
    strictPort: true,
  },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
  },
});
