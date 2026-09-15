import type { ReactElement } from 'react';
import type { ToolCall } from '../../lib/types';
import { describeToolCall } from '../../agent/activity';

const VIA_LABEL: Record<ToolCall['via'], string> = {
  webmcp: 'WebMCP',
  bridge: 'Bridge',
  'mcp-app': 'MCP App',
  'mcp-bus': 'MCP bus',
  testing: 'Testing',
};

const STATUS_DOT: Record<ToolCall['status'], string> = {
  running: 'bg-warn',
  done: 'bg-good',
  error: 'bg-clay-ink',
};

/**
 * Default renderer for one Activity entry: name/status/via header, compact args, and a JSON dump
 * of the result. Ported in spirit from ../agent-video-player/src/components/AgentPanel/ToolCallCard.tsx
 * -- specialized renderers (capture_frame image, list_* tables, export_* download chip) land in
 * the tasks that add those tools (5, 6, 9); this default JSON view covers every tool until then.
 */
export function ToolCallCard({ call }: { call: ToolCall }): ReactElement {
  return (
    <div data-testid="tool-call-card" className="rounded-token border border-line bg-surface p-2.5 text-[12px]">
      <div className="flex items-center gap-2">
        <span className={`h-1.5 w-1.5 flex-none rounded-full ${STATUS_DOT[call.status]}`} />
        <span className="flex-1 truncate font-mono font-medium text-ink">{describeToolCall(call)}</span>
        <span className="flex-none rounded bg-chip px-1.5 py-0.5 font-mono text-[10px] text-ink-3">{VIA_LABEL[call.via]}</span>
      </div>
      {Object.keys(call.args).length > 0 && (
        <pre className="mt-1.5 overflow-x-auto rounded bg-surface-2 p-1.5 font-mono text-[11px] text-ink-2">{JSON.stringify(call.args)}</pre>
      )}
      {call.status !== 'running' && call.result !== undefined && (
        <pre className="mt-1.5 overflow-x-auto rounded bg-surface-2 p-1.5 font-mono text-[11px] text-ink-2">{JSON.stringify(call.result, null, 2)}</pre>
      )}
      {call.error && <p className="mt-1.5 text-clay-ink">{call.error}</p>}
    </div>
  );
}
