import { defineConfig } from 'vite';

/**
 * Build config for the demo site (GitHub Pages), separate from the library
 * build in vite.config.ts. Bundles index.html + demo/ into a static site.
 *
 * `base` must match the repo name so asset URLs resolve under
 * https://<user>.github.io/goro-charts/. Override via DEMO_BASE if the repo
 * is renamed or served from a custom domain (set DEMO_BASE=/ for that case).
 */
export default defineConfig({
  base: process.env.DEMO_BASE ?? '/goro-charts/',
  build: {
    outDir: 'dist-demo',
    emptyOutDir: true,
  },
});
