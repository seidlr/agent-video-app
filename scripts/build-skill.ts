import 'fake-indexeddb/auto';
import { createHash } from 'node:crypto';
import { mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { zipSync } from 'fflate';
import { createAgentRegistry } from '../src/agent';
import type { ToolDefinition } from '../src/agent/registry';
import { createStudioStore } from '../src/store/studio';

/**
 * Generates the skill package's own tool reference, copies the skill folder into the well-known
 * discovery location, zips it, and writes the discovery index -- run before `vite build` (see
 * `package.json`'s own `build` script, and `scripts/run-build-skill.ts`). `import
 * 'fake-indexeddb/auto'` first: `createAgentRegistry` pulls in `store/db.ts`, which instantiates a
 * real Dexie database at module load time; this is the exact same "SSR-less" trick every unit
 * test already uses (vitest.config.ts's own `environment: 'node'`) to run the same tool-module
 * graph outside a browser.
 *
 * `main()` is exported rather than self-invoked behind an `import.meta.url === process.argv[1]`
 * guard: the tool-module graph also pulls in `agent/skill.ts`'s `SKILL.md?raw` import, a
 * Vite-only convention that plain Node/tsx can't resolve (`ERR_UNKNOWN_FILE_EXTENSION` on
 * `.md`), so this script needs `vite-node` (already a transitive dep via vitest) to actually run
 * -- and vite-node's own CLI consumes the target path before it reaches `process.argv`, leaving
 * no reliable "am I the entry point" signal to test. `scripts/run-build-skill.ts` calls `main()`
 * unconditionally instead; `tests/unit/build-skill.test.ts` imports only the named pure functions
 * below and never `main`, so it never runs this module's side effects.
 */

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.join(__dirname, '..');
const SKILL_DIR = path.join(REPO_ROOT, 'skills', 'agent-video-studio');
const SKILL_MD_PATH = path.join(SKILL_DIR, 'SKILL.md');
const TOOLS_MD_PATH = path.join(SKILL_DIR, 'references', 'TOOLS.md');
const PUBLIC_DISCOVERY_DIR = path.join(REPO_ROOT, 'public', '.well-known', 'agent-skills');
const PUBLIC_SKILL_COPY_DIR = path.join(PUBLIC_DISCOVERY_DIR, 'agent-video-studio');
const PUBLIC_ZIP_PATH = path.join(REPO_ROOT, 'public', 'skill.zip');

/** Must match `vite.config.ts`'s own hardcoded `base` -- GitHub Pages serves this repo at a
 * project subpath, not the domain root, so `index.json`'s own `url` fields need the same prefix
 * or they resolve to the wrong place (`https://seidlr.github.io/skill.zip` instead of
 * `https://seidlr.github.io/agent-video-app/skill.zip`) when an agent fetches them as absolute
 * paths against the deployed origin. */
const SITE_BASE_PATH = '/agent-video-app/';

const SCHEMA_URL = 'https://schemas.agentskills.io/discovery/0.2.0/schema.json';
/** Per the Agent Skills naming spec (also enforced by the Cloudflare discovery RFC): 1-64 chars,
 * lowercase alphanumeric and hyphens only, no leading/trailing/consecutive hyphens. */
const NAME_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const MAX_DESCRIPTION_LENGTH = 1024;

export function sha256Hex(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

export interface Frontmatter {
  name: string;
  description: string;
}

/** A minimal frontmatter reader for the two fields this script needs to validate -- SKILL.md's
 * frontmatter here is flat scalars (no nested lists), so a line-based extraction is simpler and
 * has fewer moving parts than pulling in a full YAML parser for a document this script itself
 * authored the shape of. */
export function parseFrontmatter(markdown: string): Frontmatter {
  const match = markdown.match(/^---\n([\s\S]*?)\n---/);
  if (!match) throw new Error('SKILL.md is missing its --- frontmatter block');
  const block = match[1]!;

  const nameMatch = block.match(/^name:\s*(.+)$/m);
  const descriptionMatch = block.match(/^description:\s*(.+)$/m);
  if (!nameMatch || !descriptionMatch) throw new Error('SKILL.md frontmatter is missing name or description');

  return { name: nameMatch[1]!.trim(), description: descriptionMatch[1]!.trim() };
}

export function validateFrontmatter(fm: Frontmatter): void {
  if (!NAME_PATTERN.test(fm.name) || fm.name.length > 64) {
    throw new Error(`SKILL.md frontmatter "name: ${fm.name}" is invalid: must be 1-64 lowercase alphanumeric/hyphen characters, no leading/trailing/consecutive hyphens`);
  }
  if (fm.description.length > MAX_DESCRIPTION_LENGTH) {
    throw new Error(`SKILL.md frontmatter "description" is ${fm.description.length} chars, over the ${MAX_DESCRIPTION_LENGTH}-char limit`);
  }
}

/** A raw `|` inside this string would collide with the Markdown table cell separator it's placed
 * into (`buildToolsMarkdown`'s args table) -- ` or ` instead of ` | ` keeps the row a real table
 * row instead of silently fragmenting into extra columns. */
function describeSchemaType(schema: { type?: unknown; enum?: readonly unknown[] }): string {
  if (schema.enum) return schema.enum.map((v) => JSON.stringify(v)).join(' or ');
  const type = schema.type;
  if (Array.isArray(type)) return type.join(' or ');
  if (typeof type === 'string') return type;
  return 'any';
}

/** Builds one Markdown section per tool: name, group/when/mode, description, an args table (from
 * `inputSchema.properties`), and an example call/result pair. Sorted by name for a stable diff. */
export function buildToolsMarkdown(tools: ToolDefinition[]): string {
  const sorted = [...tools].sort((a, b) => a.name.localeCompare(b.name));
  const lines: string[] = [
    '# Tool reference',
    '',
    '_Generated by `scripts/build-skill.ts` from the live tool registry -- do not hand-edit._',
    '',
    'Every tool resolves to `{ok:true, summary, ...}` or `{ok:false, error, hint?}`, never an',
    'exception. `when` says when a tool is registered: `always` (registers immediately),',
    '`local` (only while a decodable local/URL source is loaded), `yt` (also registers for a',
    'YouTube source), `after-transcribe` (only once a transcript exists). `mode: job` tools accept',
    'the universal `wait`/`waitSeconds`/`requestId` envelope fields on top of their own arguments.',
    '',
    `${sorted.length} tools:`,
    '',
  ];

  for (const tool of sorted) {
    lines.push(`## \`${tool.name}\``, '');
    lines.push(`**Group:** ${tool.group} · **When:** ${tool.when}${tool.mode ? ' · **Mode:** job' : ''}`, '');
    lines.push(tool.description, '');

    const properties = tool.inputSchema.properties;
    if (properties && Object.keys(properties).length > 0) {
      const required = new Set(tool.inputSchema.required ?? []);
      lines.push('| Argument | Type | Required |', '|---|---|---|');
      for (const [key, propSchema] of Object.entries(properties)) {
        lines.push(`| \`${key}\` | ${describeSchemaType(propSchema as { type?: unknown; enum?: readonly unknown[] })} | ${required.has(key) ? 'yes' : 'no'} |`);
      }
      lines.push('');
    } else {
      lines.push('_No arguments._', '');
    }

    const exampleArgs: Record<string, string> = {};
    for (const key of Object.keys(properties ?? {})) exampleArgs[key] = `<${key}>`;
    lines.push('Example call:', '', '```json', JSON.stringify({ name: tool.name, arguments: exampleArgs }, null, 2), '```', '');
  }

  return `${lines.join('\n')}\n`;
}

/** Recursively lists every file under `dir`, returning paths relative to `dir` (posix-separated,
 * since these become zip entry names). */
function listFilesRelative(dir: string): string[] {
  const results: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) {
      results.push(...listFilesRelative(full).map((p) => path.posix.join(entry, p)));
    } else {
      results.push(entry.split(path.sep).join('/'));
    }
  }
  return results;
}

/** Zips every file under `dir` with files at the archive root (RFC: "not nested inside a wrapper
 * directory") -- pulled out of `main()` so a test can zip the real, checked-in `skills/
 * agent-video-studio/` source directly, independent of the gitignored `public/skill.zip` copy
 * `main()` itself writes (which only exists after a build has actually run). */
export function zipDirectory(dir: string): Uint8Array {
  const entries: Record<string, Uint8Array> = {};
  for (const rel of listFilesRelative(dir)) {
    entries[rel] = readFileSync(path.join(dir, ...rel.split('/')));
  }
  return zipSync(entries);
}

export interface DiscoverySkillEntry {
  name: string;
  type: 'skill-md' | 'archive';
  description: string;
  url: string;
  digest: string;
}

export interface DiscoveryIndex {
  $schema: string;
  skills: DiscoverySkillEntry[];
}

/** Builds the `/.well-known/agent-skills/index.json` document -- one `skill-md` entry (the raw
 * file) and one `archive` entry (the zip, for a client that wants the full bundle including
 * references/ in one request), per the Cloudflare discovery RFC's own index format. Pure: takes
 * already-computed digests rather than reading files itself, so a test can check its shape
 * against known inputs without needing a prior build to have run. */
export function buildDiscoveryIndex(fm: Frontmatter, basePath: string, skillMdDigestHex: string, zipDigestHex: string): DiscoveryIndex {
  return {
    $schema: SCHEMA_URL,
    skills: [
      {
        name: fm.name,
        type: 'skill-md',
        description: fm.description,
        url: `${basePath}.well-known/agent-skills/${fm.name}/SKILL.md`,
        digest: `sha256:${skillMdDigestHex}`,
      },
      {
        name: fm.name,
        type: 'archive',
        description: fm.description,
        url: `${basePath}skill.zip`,
        digest: `sha256:${zipDigestHex}`,
      },
    ],
  };
}

export function main(): void {
  // 1. Generate references/TOOLS.md from the live registry.
  const registry = createAgentRegistry(createStudioStore());
  writeFileSync(TOOLS_MD_PATH, buildToolsMarkdown(registry.list()));
  console.log(`Wrote ${path.relative(REPO_ROOT, TOOLS_MD_PATH)} (${registry.list().length} tools)`);

  // 2. Validate SKILL.md's frontmatter before publishing anything.
  const skillMdText = readFileSync(SKILL_MD_PATH, 'utf-8');
  const frontmatter = parseFrontmatter(skillMdText);
  validateFrontmatter(frontmatter);

  // 3. Copy the whole skill folder (SKILL.md + references/, now including the fresh TOOLS.md)
  // into the well-known discovery location.
  mkdirSync(PUBLIC_SKILL_COPY_DIR, { recursive: true });
  for (const rel of listFilesRelative(SKILL_DIR)) {
    const destPath = path.join(PUBLIC_SKILL_COPY_DIR, ...rel.split('/'));
    mkdirSync(path.dirname(destPath), { recursive: true });
    writeFileSync(destPath, readFileSync(path.join(SKILL_DIR, ...rel.split('/'))));
  }

  // 4. Zip the skill folder -- files at the archive root (RFC: "not nested inside a wrapper
  // directory"), SKILL.md included.
  const zipBytes = zipDirectory(SKILL_DIR);
  mkdirSync(path.dirname(PUBLIC_ZIP_PATH), { recursive: true });
  writeFileSync(PUBLIC_ZIP_PATH, zipBytes);
  console.log(`Wrote ${path.relative(REPO_ROOT, PUBLIC_ZIP_PATH)} (${zipBytes.byteLength} bytes)`);

  // 5. Write the discovery index -- one skill-md entry (the raw file) and one archive entry.
  const skillMdDigest = sha256Hex(new Uint8Array(readFileSync(SKILL_MD_PATH)));
  const zipDigest = sha256Hex(zipBytes);
  const index = buildDiscoveryIndex(frontmatter, SITE_BASE_PATH, skillMdDigest, zipDigest);
  mkdirSync(PUBLIC_DISCOVERY_DIR, { recursive: true });
  writeFileSync(path.join(PUBLIC_DISCOVERY_DIR, 'index.json'), `${JSON.stringify(index, null, 2)}\n`);
  console.log(`Wrote ${path.relative(REPO_ROOT, path.join(PUBLIC_DISCOVERY_DIR, 'index.json'))}`);
}
