import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { unzipSync } from 'fflate';
import { describe, expect, it } from 'vitest';
import 'fake-indexeddb/auto';
import { buildDiscoveryIndex, buildToolsMarkdown, parseFrontmatter, sha256Hex, validateFrontmatter, zipDirectory } from '../../scripts/build-skill';
import { createAgentRegistry } from '../../src/agent';
import { createStudioStore } from '../../src/store/studio';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SKILL_DIR = path.join(__dirname, '../../skills/agent-video-studio');
const SKILL_MD_PATH = path.join(SKILL_DIR, 'SKILL.md');

describe('scripts/build-skill (pure functions)', () => {
  it('parseFrontmatter extracts name and description from the real SKILL.md', () => {
    const text = readFileSync(SKILL_MD_PATH, 'utf-8');
    const fm = parseFrontmatter(text);
    expect(fm.name).toBe('agent-video-studio');
    expect(fm.description.length).toBeGreaterThan(0);
  });

  it('parseFrontmatter throws when there is no frontmatter block', () => {
    expect(() => parseFrontmatter('# just a heading, no frontmatter')).toThrow(/frontmatter/);
  });

  it('parseFrontmatter throws when name or description is missing', () => {
    expect(() => parseFrontmatter('---\nname: x\n---\nbody')).toThrow(/missing name or description/);
  });

  it('validateFrontmatter accepts a valid name/description', () => {
    expect(() => validateFrontmatter({ name: 'agent-video-studio', description: 'short' })).not.toThrow();
  });

  it('validateFrontmatter rejects an invalid name (uppercase, leading hyphen, consecutive hyphens, too long)', () => {
    expect(() => validateFrontmatter({ name: 'Agent-Video', description: 'x' })).toThrow(/invalid/);
    expect(() => validateFrontmatter({ name: '-agent-video', description: 'x' })).toThrow(/invalid/);
    expect(() => validateFrontmatter({ name: 'agent--video', description: 'x' })).toThrow(/invalid/);
    expect(() => validateFrontmatter({ name: 'a'.repeat(65), description: 'x' })).toThrow(/invalid/);
  });

  it('validateFrontmatter rejects a description over 1024 characters', () => {
    expect(() => validateFrontmatter({ name: 'agent-video-studio', description: 'x'.repeat(1025) })).toThrow(/1024-char limit/);
  });

  it('sha256Hex matches a known SHA-256 test vector ("abc")', () => {
    expect(sha256Hex(new TextEncoder().encode('abc'))).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  });

  it('buildToolsMarkdown contains every registered tool name', () => {
    const registry = createAgentRegistry(createStudioStore());
    const tools = registry.list();
    const markdown = buildToolsMarkdown(tools);
    for (const tool of tools) {
      expect(markdown).toContain(`\`${tool.name}\``);
    }
  });

  it('buildToolsMarkdown never puts a raw "|" inside a table cell (would fragment the row)', () => {
    const registry = createAgentRegistry(createStudioStore());
    const markdown = buildToolsMarkdown(registry.list());
    const tableRows = markdown.split('\n').filter((line: string) => line.startsWith('| `'));
    for (const row of tableRows) {
      expect(row.split('|')).toHaveLength(5); // leading empty + Argument + Type + Required + trailing empty
    }
  });
});

describe('build-skill.ts DoD: index.json digest matches SKILL.md; zip root contains SKILL.md', () => {
  // Builds against the real, checked-in skills/agent-video-studio/ source directly (not
  // main()'s own public/.well-known/ + public/skill.zip copies, which are gitignored build
  // output -- see .gitignore's own comment -- and don't exist yet on a fresh checkout at the
  // point in CI's pipeline where unit tests run, before the `build` step that creates them).
  it('buildDiscoveryIndex\'s skill-md digest equals sha256 of the real SKILL.md', () => {
    const skillMdBytes = new Uint8Array(readFileSync(SKILL_MD_PATH));
    const zipBytes = zipDirectory(SKILL_DIR);
    const fm = parseFrontmatter(readFileSync(SKILL_MD_PATH, 'utf-8'));

    const index = buildDiscoveryIndex(fm, sha256Hex(skillMdBytes), sha256Hex(zipBytes));
    const skillMdEntry = index.skills.find((s) => s.type === 'skill-md');

    expect(skillMdEntry).toBeDefined();
    expect(skillMdEntry!.digest).toBe(`sha256:${sha256Hex(skillMdBytes)}`);
  });

  it('zipDirectory(skills/agent-video-studio/) contains SKILL.md at its root', () => {
    const zipBytes = zipDirectory(SKILL_DIR);
    const entries = unzipSync(zipBytes);
    expect(Object.keys(entries)).toContain('SKILL.md');
  });
});
