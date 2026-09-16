import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { viteSingleFile } from 'vite-plugin-singlefile';

// The MCP App build (Task 11): a single self-contained `dist/mcp-app.html` an MCP host (Claude
// Desktop, ChatGPT Desktop, VS Code) renders as a sandboxed `ui://` resource -- no server of its
// own to fetch separate JS/CSS chunks from, so everything has to live in the one file.
// `base: './'` (not '/') so any reference vite-plugin-singlefile misses still resolves relative to
// wherever the resource is actually served from, rather than assuming site root.
export default defineConfig({
  base: './',
  plugins: [react(), tailwindcss(), viteSingleFile()],
  build: {
    outDir: 'dist',
    emptyOutDir: false,
    rollupOptions: {
      input: 'mcp-app.html',
    },
  },
});
