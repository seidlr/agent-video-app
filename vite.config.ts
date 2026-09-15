import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

// Agent Video Studio — standalone site build.
// The MCP App build lives in vite.mcp-app.config.ts (single-file, separate entry).
//
// `base` matches GitHub Pages' real /agent-video-app/ subpath for a production build AND for
// `vite preview` against that build (`isPreview` -- `vite preview` resolves `command` as 'serve',
// the same as plain dev, so `command === 'build'` alone leaves preview silently back at root: a
// request under /agent-video-app/ then matches nothing, and Vite's SPA html-fallback quietly
// serves index.html instead of erroring, which is exactly indistinguishable from success unless
// something checks response *content*, not just status -- confirmed the hard way via
// tests/e2e/skill.spec.ts). The plain dev server (and Playwright, which navigates to "/") stays
// at root or every absolute import and page.goto('/') breaks locally.
// scripts/build-skill.ts's own SITE_BASE_PATH constant must be kept in sync with this string --
// it prefixes index.json's discovery URLs the same way.
export default defineConfig(({ command, isPreview }) => ({
  base: command === 'build' || isPreview ? '/agent-video-app/' : '/',
  plugins: [react(), tailwindcss()],
  server: {
    port: 3000,
    host: '0.0.0.0',
  },
  build: {
    outDir: 'dist',
    rollupOptions: {
      input: 'index.html',
    },
  },
}));
