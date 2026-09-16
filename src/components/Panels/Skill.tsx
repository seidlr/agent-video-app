import { useState } from 'react';
import type { ReactElement } from 'react';
import type { AgentVideoBridge } from '../../agent/bridge';
import { SKILL_MARKDOWN } from '../../agent/skill';
import { useStudio } from '../../store/studio';

const SITE_ORIGIN = 'https://seidlr.github.io/agent-video-app/';
const ZIP_URL = `${import.meta.env.BASE_URL}skill.zip`;
const INSTALL_COMMAND = `npx skills add ${SITE_ORIGIN}skill.zip`;
const INSTALL_COMMAND_GITHUB = 'npx skills add seidlr/agent-video-app';

interface AgentCard {
  id: string;
  title: string;
  steps: string[];
  /** Returns undefined when this host's connection state genuinely can't be checked from inside
   * the page (e.g. a host permission toggle, or a transport Task 11 hasn't built yet). */
  checkLive?: () => boolean | undefined;
}

function CopyButton({ text, label }: { text: string; label: string }): ReactElement {
  const [copied, setCopied] = useState(false);
  async function handleCopy(): Promise<void> {
    await navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }
  return (
    <button type="button" onClick={() => void handleCopy()} className="rounded px-1.5 py-0.5 text-ink-2 hover:bg-line" aria-label={label}>
      {copied ? 'Copied!' : 'Copy'}
    </button>
  );
}

function LiveStatus({ ok }: { ok: boolean | undefined }): ReactElement {
  if (ok === undefined) {
    return <span className="flex-none rounded bg-surface-2 px-1.5 py-0.5 font-mono text-[10.5px] text-ink-3">not detectable here</span>;
  }
  return (
    <span className={`flex-none rounded px-1.5 py-0.5 font-mono text-[10.5px] ${ok ? 'bg-good-soft text-good' : 'bg-surface-2 text-ink-3'}`}>
      {ok ? 'detected' : 'not detected'}
    </span>
  );
}

/**
 * TS-008: install commands, a downloadable skill.zip, a copyable SKILL.md, and per-agent
 * connection cards -- the in-app half of Task 10 (`skills/agent-video-studio/` + `build-skill.ts`
 * generate the actual files this panel links to; `docs/agents.md` mirrors these same cards for
 * someone reading the repo instead of the running app).
 */
export function Skill(): ReactElement {
  const transport = useStudio((s) => s.ui.agentTransport);
  const bridgeAvailable = typeof window !== 'undefined' && typeof (window as unknown as { agentVideo?: AgentVideoBridge }).agentVideo !== 'undefined';

  const cards: AgentCard[] = [
    {
      id: 'chrome',
      title: 'Chrome 152+ (native WebMCP)',
      steps: ['Go to chrome://flags/#enable-webmcp-testing and set it to Enabled.', 'Relaunch Chrome.', 'Reload this page -- tools register automatically.'],
      checkLive: () => transport !== 'none',
    },
    {
      id: 'chatgpt-codex',
      title: 'ChatGPT Desktop / Codex sessions (site tools)',
      steps: ['Settings -> Browser -> Permissions -> enable site tools for this origin.', 'Reload this page; the host lists the registered tools.'],
    },
    {
      id: 'mcp-b',
      title: 'MCP-B extension',
      steps: ['Install the WebMCP (@mcp-b) browser extension.', 'Connect to this site from Claude Desktop (or another MCP-B-aware client) the same way you would connect to any other MCP-B-registered site.'],
    },
    {
      id: 'bridge',
      title: 'Claude in Chrome / Claude Desktop\'s browser (scripting bridge)',
      steps: ['No extension needed. Use javascript_tool to run: await window.agentVideo.call(\'get_state\', {})', 'Every call returns the same {ok, ...} envelope and logs to the Activity panel with via:"bridge".'],
      checkLive: () => bridgeAvailable,
    },
    {
      id: 'claude-desktop-mcp-app',
      title: 'Claude Desktop (MCP App)',
      steps: [
        'Run npm run mcp:bundle to produce agent-video-studio.mcpb.',
        'Claude Desktop -> Settings -> Extensions -> install the .mcpb file.',
        'Start a new conversation and ask Claude to open the video studio.',
      ],
    },
    {
      id: 'codex-cli',
      title: 'Codex CLI (HTTP bus)',
      steps: [
        'Run npm run build:server once, then: codex mcp add agent-video-studio -- node <repo>/server/dist/stdio.js',
        `Open this site (deployed, or npm run dev) with ?bus=http://localhost:3333 in a normal tab -- that tab is the UI; don't also call open_video_studio in this mode.`,
      ],
    },
  ];

  return (
    <div className="flex flex-col gap-3 text-[12.5px]">
      <div>
        <h3 className="mb-1 font-medium">Install</h3>
        <div className="flex flex-col gap-1.5">
          <div className="flex items-center justify-between gap-2 rounded-token border border-line bg-surface-2 p-2">
            <code className="min-w-0 truncate font-mono text-[11px] text-ink-2">{INSTALL_COMMAND}</code>
            <CopyButton text={INSTALL_COMMAND} label="Copy install command" />
          </div>
          <div className="flex items-center justify-between gap-2 rounded-token border border-line bg-surface-2 p-2">
            <code className="min-w-0 truncate font-mono text-[11px] text-ink-2">{INSTALL_COMMAND_GITHUB}</code>
            <CopyButton text={INSTALL_COMMAND_GITHUB} label="Copy GitHub install command" />
          </div>
          <div className="flex gap-1.5">
            <a href={ZIP_URL} download className="rounded border border-line px-2 py-1 text-ink-2 hover:bg-line">
              Download zip
            </a>
            <CopyButton text={SKILL_MARKDOWN} label="Copy SKILL.md" />
          </div>
        </div>
      </div>

      <div>
        <h3 className="mb-1 font-medium">Connect an agent</h3>
        <div className="flex flex-col gap-2">
          {cards.map((card) => (
            <div key={card.id} className="rounded-token border border-line bg-surface-2 p-2.5">
              <div className="flex items-center justify-between gap-2">
                <div className="font-medium">{card.title}</div>
                <LiveStatus ok={card.checkLive?.()} />
              </div>
              <ul className="mt-1 list-disc pl-4 text-ink-3">
                {card.steps.map((step, i) => (
                  <li key={i}>{step}</li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </div>

      <p className="text-ink-3">
        Full tool reference and per-host details also live in{' '}
        <code className="font-mono text-[11px]">skills/agent-video-studio/</code> and{' '}
        <code className="font-mono text-[11px]">docs/agents.md</code>.
      </p>
    </div>
  );
}
