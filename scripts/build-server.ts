import { existsSync } from 'node:fs';
import { copyFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.join(__dirname, '..');
const SERVER_DIR = path.join(REPO_ROOT, 'server');
const OUT_FILE = path.join(SERVER_DIR, 'dist', 'stdio.js');

/**
 * Bundles `server/stdio.ts` (and everything it imports -- the MCP SDK, Express, zod, this app's
 * own `src/agent/registry.ts` types, ...) into one self-contained `server/dist/stdio.js`, so the
 * `.mcpb` bundle (Claude Desktop, `npm run mcp:bundle`) can run `node dist/stdio.js` with no
 * `node_modules` of its own and no `tsx`/TypeScript runtime installed on the end user's machine.
 *
 * `--format=esm` (not the more common `cjs`) is required here specifically because
 * `server/index.ts` computes its own directory via `import.meta.url` (to locate `dist/mcp-app.html`
 * relative to itself, working the same way whether run from source via `tsx` or from this bundled
 * output) -- `import.meta` is silently emptied under esbuild's `cjs` output format, breaking that
 * path resolution. The one esbuild+ESM+Node gotcha this trades in return: several of Express's own
 * CommonJS dependencies (`debug`, `body-parser`, ...) call a real `require()` for Node builtins at
 * module-eval time, which esbuild's synthetic CJS-in-ESM interop shim can't satisfy ("Dynamic
 * require of \"tty\" is not supported") -- confirmed by hitting that exact crash on a first build
 * without this banner. The standard fix: a `createRequire(import.meta.url)` banner gives the
 * bundle a real, working `require()` backed by Node's own module system for any CJS dependency
 * esbuild couldn't fully statically inline.
 */
export async function main(): Promise<void> {
  await mkdir(path.dirname(OUT_FILE), { recursive: true });
  await build({
    entryPoints: [path.join(SERVER_DIR, 'stdio.ts')],
    bundle: true,
    platform: 'node',
    format: 'esm',
    target: 'node20',
    outfile: OUT_FILE,
    banner: {
      js: "import { createRequire as __createRequire } from 'node:module'; const require = __createRequire(import.meta.url);",
    },
  });

  // The `.mcpb` bundle is self-contained -- `server/index.ts`'s own `DEFAULT_MCP_APP_HTML_PATH`
  // resolves to `<dirname of the running file>/../dist/mcp-app.html`, which for this bundled
  // output means `server/dist/mcp-app.html`. `npm run build:mcp-app` must run before this script
  // (`mcp:bundle` orders them that way) so the real, current build is what gets copied in.
  const builtMcpAppHtml = path.join(REPO_ROOT, 'dist', 'mcp-app.html');
  if (existsSync(builtMcpAppHtml)) {
    await copyFile(builtMcpAppHtml, path.join(SERVER_DIR, 'dist', 'mcp-app.html'));
  } else {
    console.warn(`[build-server] ${builtMcpAppHtml} not found -- run "npm run build:mcp-app" first, or open_video_studio's ui:// resource will 404.`);
  }
}
