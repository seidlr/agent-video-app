import { type ChildProcess, spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { unzipSync } from 'fflate';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.join(__dirname, '../..');
// vite's own default preview port -- distinct from playwright.config.ts's shared dev-server
// webServer (port 3000, base '/'), since TS-008 specifically needs the PRODUCTION build served
// under its real GitHub Pages base path ('/agent-video-app/'), which only `vite preview` (against
// an already-built dist/) reproduces. Managed as this file's own process rather than a second
// shared `webServer` entry, so it doesn't affect every other spec's dev-server assumptions.
const PREVIEW_PORT = 4173;
const PREVIEW_ORIGIN = `http://localhost:${PREVIEW_PORT}`;
const BASE_PATH = '/agent-video-app/';
const APP_URL = `${PREVIEW_ORIGIN}${BASE_PATH}`;

async function execTool(page: Page, name: string, args: Record<string, unknown> = {}): Promise<Record<string, unknown>> {
  await page.waitForFunction((toolName) => navigator.modelContextTesting?.listTools().some((t) => t.name === toolName) ?? false, name);
  const resultJson = await page.evaluate(
    async ({ name, argsJson }) => navigator.modelContextTesting!.executeTool(name, argsJson),
    { name, argsJson: JSON.stringify(args) },
  );
  return JSON.parse(resultJson ?? 'null') as Record<string, unknown>;
}

async function waitForServer(url: string, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let lastError: unknown;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(url);
      if (res.ok) return;
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 300));
  }
  throw new Error(`Preview server at ${url} did not become ready within ${timeoutMs}ms: ${String(lastError)}`);
}

/**
 * TS-008 steps 1-4 (step 5, `npx skills add ./skills -y --agent claude-code` in a temp dir, is a
 * separate CLI's own install flow and stays manual per the plan's own DoD wording). Requires a
 * fresh production build (`npm run build`, which runs `scripts/build-skill.ts` first) already on
 * disk -- this file starts and stops its own `vite preview` against that `dist/`, tagged `@build`
 * so CI runs it only after the Build step (dist/ does not exist during the main e2e step, which
 * runs before Build in .github/workflows/deploy.yml).
 */
test.describe('TS-008: skill discovery and install surfaces @build', () => {
  // fullyParallel (playwright.config.ts) would otherwise assign these tests to separate workers,
  // each running its own beforeAll/afterAll -- multiple concurrent `vite preview --strictPort`
  // spawns racing for the same port. Serial keeps this file's one preview server and its
  // beforeAll/afterAll on a single worker.
  test.describe.configure({ mode: 'serial' });

  let previewProcess: ChildProcess | undefined;

  test.beforeAll(async () => {
    previewProcess = spawn('npx', ['vite', 'preview', '--port', String(PREVIEW_PORT), '--strictPort'], { cwd: REPO_ROOT, stdio: 'pipe' });
    await waitForServer(APP_URL, 30_000);
  });

  test.afterAll(() => {
    previewProcess?.kill();
  });

  test('step 1: GET /.well-known/agent-skills/index.json is a valid discovery document whose digest matches the served SKILL.md', async ({ request }) => {
    const indexRes = await request.get(`${APP_URL}.well-known/agent-skills/index.json`);
    expect(indexRes.status()).toBe(200);
    const index = (await indexRes.json()) as { $schema: string; skills: { name: string; type: string; digest: string; url: string }[] };
    expect(index.$schema).toBe('https://schemas.agentskills.io/discovery/0.2.0/schema.json');

    const skillMdEntry = index.skills.find((s) => s.type === 'skill-md');
    expect(skillMdEntry?.name).toBe('agent-video-studio');
    expect(skillMdEntry?.url).toBe(`${BASE_PATH}.well-known/agent-skills/agent-video-studio/SKILL.md`);

    const skillMdRes = await request.get(`${PREVIEW_ORIGIN}${skillMdEntry!.url}`);
    expect(skillMdRes.status()).toBe(200);
    const digestHex = createHash('sha256').update(await skillMdRes.body()).digest('hex');
    expect(skillMdEntry!.digest).toBe(`sha256:${digestHex}`);
  });

  test('step 2: GET /skill.zip is a real zip whose root contains SKILL.md and references/TOOLS.md', async ({ request }) => {
    const res = await request.get(`${APP_URL}skill.zip`);
    expect(res.status()).toBe(200);
    expect(res.headers()['content-type']).toContain('zip');

    const entries = unzipSync(new Uint8Array(await res.body()));
    expect(Object.keys(entries)).toContain('SKILL.md');
    expect(Object.keys(entries)).toContain('references/TOOLS.md');
  });

  test('step 3: get_agent_skill returns the real SKILL.md text over the production build', async ({ page }) => {
    await page.goto(APP_URL);
    const result = await execTool(page, 'get_agent_skill', {});
    expect(result.ok).toBe(true);
    expect(String(result.content)).toContain('Agent Video Studio');
    expect(String(result.content)).toContain('Call `get_state` first');
    expect(String(result.content).startsWith('---')).toBe(false);
  });

  test('step 4: the Skill panel shows the install command, a download link, and per-agent connection cards', async ({ page }) => {
    await page.goto(APP_URL);
    await page.locator('button', { hasText: 'Skill' }).click();

    await expect(page.locator('code', { hasText: 'npx skills add' })).toHaveCount(2);
    await expect(page.locator('a', { hasText: 'Download zip' })).toHaveAttribute('href', `${BASE_PATH}skill.zip`);

    for (const label of ['Chrome 152+', 'ChatGPT Desktop', 'MCP-B extension', 'Claude in Chrome', 'Claude Desktop (MCP App)']) {
      await expect(page.locator(`text=${label}`).first()).toBeVisible();
    }
  });
});
