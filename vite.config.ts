import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

// Agent Video Studio — standalone site build.
// The MCP App build lives in vite.mcp-app.config.ts (single-file, separate entry).
//
// `base` only applies to the production build: GitHub Pages serves this repo at
// /agent-video-app/, but the dev server (and Playwright, which navigates to "/") must stay at
// the root or every absolute import and page.goto('/') breaks locally.
export default defineConfig(({ command }) => ({
  base: command === 'build' ? '/agent-video-app/' : '/',
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
