import type { ReactElement } from 'react';
import { toolCallStatusText } from '../agent/activity';
import type { ToolCall } from '../lib/types';
import { useStudio } from '../store/studio';

const TRANSPORT_LABEL: Record<string, string> = {
  webmcp: 'WebMCP',
  bridge: 'Bridge',
  'mcp-app': 'MCP App',
  'mcp-bus': 'MCP bus',
};

/** Only `mcp-app`/`mcp-bus` have an instance hand-off concept (Task 11): a newer render or tab
 * always retires this one, at which point its transport is still mounted but no longer the one
 * commands reach -- worth surfacing distinctly rather than a misleadingly steady "connected". */
const INSTANCE_HANDOFF_TRANSPORTS = new Set(['mcp-app', 'mcp-bus']);

const STATUS_DOT: Record<ToolCall['status'], string> = {
  running: 'bg-warn motion-safe:animate-pulse',
  done: 'bg-good',
  error: 'bg-clay-ink',
};

/**
 * The one place agent activity surfaces outside the Activity panel (Claude Design
 * screens/06-studio-v2.dc.html): which transport is connected, the agent's latest call updating in
 * place, and the running total. Replaces the per-call toast stack, which piled up over the video
 * while an agent worked ("not so many toasts"). Clicking it opens the full Activity feed.
 */
export function AgentPresence(): ReactElement {
  const transport = useStudio((s) => s.ui.agentTransport);
  const instanceActive = useStudio((s) => s.ui.agentInstanceActive);
  const latest = useStudio((s) => s.activity[s.activity.length - 1]);
  const callCount = useStudio((s) => s.activity.length);
  const setView = useStudio((s) => s.setView);

  const inactive = INSTANCE_HANDOFF_TRANSPORTS.has(transport) && !instanceActive;
  const label = TRANSPORT_LABEL[transport];
  const connected = label !== undefined && !inactive;
  const who = label === undefined ? 'No agent yet' : inactive ? `${label} · inactive` : label;

  return (
    <button
      type="button"
      data-testid="agent-presence"
      onClick={() => setView('activity')}
      aria-label={`${who}${latest ? `, latest call ${latest.name} ${toolCallStatusText(latest)}` : ''}. Open the agent's activity`}
      title={inactive ? 'A newer tab or render took over this instance -- reactivate it there to resume commands here.' : 'Open the agent activity feed'}
      className="flex h-8 min-w-0 max-w-[520px] items-center overflow-hidden rounded-full border border-line bg-surface font-mono text-[11px] transition-colors hover:border-line-2"
    >
      <span className={`flex h-full flex-none items-center gap-1.5 px-3 font-semibold ${connected ? 'bg-good-soft text-good' : 'bg-chip text-ink-3'}`}>
        <span className={`h-1.5 w-1.5 rounded-full ${connected ? 'bg-good' : 'bg-ink-4'}`} />
        <span className="max-sm:sr-only">{who}</span>
      </span>
      {latest && (
        <span data-testid="agent-presence-call" className="flex min-w-0 items-center gap-2 px-3 text-ink-2">
          <span className={`h-1.5 w-1.5 flex-none rounded-full ${STATUS_DOT[latest.status]}`} />
          <span className="min-w-[4ch] truncate font-semibold text-ink">{latest.name}</span>
          <span className="flex-none">{toolCallStatusText(latest)}</span>
        </span>
      )}
      {callCount > 0 && (
        <span className="hidden h-full flex-none items-center border-l border-line px-3 text-ink-3 md:flex">
          {callCount} {callCount === 1 ? 'call' : 'calls'}
        </span>
      )}
    </button>
  );
}
