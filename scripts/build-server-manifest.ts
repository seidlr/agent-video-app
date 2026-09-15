import 'fake-indexeddb/auto';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createAgentRegistry } from '../src/agent';
import { buildManifest } from '../src/agent/registry';
import { createStudioStore } from '../src/store/studio';

/**
 * Generates `server/generated/tool-manifest.json` (Task 11) -- the server's own view of every
 * registered tool (name/description/inputSchema/annotations/group/when/mode), with no `handler`
 * (that only exists in the browser instance the bus dispatches to). Committed like
 * `skills/agent-video-studio/references/TOOLS.md` rather than gitignored: `server/test/server.test.ts`
 * imports `server/index.ts`, which imports this JSON directly, and needs it to exist without
 * first running a build -- same reasoning as Task 10's TOOLS.md.
 *
 * `main()` is exported and called from `scripts/run-build-server-manifest.ts` rather than
 * self-invoked here, for the same reason as `build-skill.ts`: this module pulls in the full
 * tool-module graph (via `createAgentRegistry`), including `agent/skill.ts`'s Vite-only
 * `SKILL.md?raw` import, so it only runs under `vite-node`, whose CLI consumes the target path
 * before it reaches `process.argv` -- there is no reliable "am I the entry point" signal to
 * guard against tests importing this module's side effects.
 */

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.join(__dirname, '..');
const MANIFEST_PATH = path.join(REPO_ROOT, 'server', 'generated', 'tool-manifest.json');

export function main(): void {
  const registry = createAgentRegistry(createStudioStore());
  const manifest = buildManifest(registry.list());
  mkdirSync(path.dirname(MANIFEST_PATH), { recursive: true });
  writeFileSync(MANIFEST_PATH, `${JSON.stringify(manifest, null, 2)}\n`);
  console.log(`Wrote ${path.relative(REPO_ROOT, MANIFEST_PATH)} (${manifest.length} tools)`);
}
