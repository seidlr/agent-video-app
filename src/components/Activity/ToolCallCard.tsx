import { useState } from 'react';
import type { ReactElement } from 'react';
import { ChevronDown, ChevronUp } from 'lucide-react';
import { toolCallStatusText } from '../../agent/activity';
import type { ToolCall } from '../../lib/types';

const VIA_LABEL: Record<ToolCall['via'], string> = {
  webmcp: 'WebMCP',
  bridge: 'Bridge',
  'mcp-app': 'MCP App',
  'mcp-bus': 'MCP bus',
  testing: 'Testing',
};

const STATUS_DOT: Record<ToolCall['status'], string> = {
  running: 'bg-warn motion-safe:animate-pulse',
  done: 'bg-good',
  error: 'bg-clay-ink',
};

const STATUS_PILL: Record<ToolCall['status'], string> = {
  running: 'bg-clay-soft text-clay-ink',
  done: 'bg-good-soft text-good',
  error: 'bg-chip text-clay-ink',
};

/** Long string values (a returned dataUrl, a full transcript) make the details block unreadable;
 * the full value stays available to the agent that received it. */
const MAX_DETAIL_STRING = 140;

function resultRecord(call: ToolCall): Record<string, unknown> | null {
  return call.result && typeof call.result === 'object' ? (call.result as Record<string, unknown>) : null;
}

/** The one line a human reads: the tool's own `summary` (every tool returns one), its error, or
 * while still running, the arguments it was called with. */
function summaryLine(call: ToolCall): string | null {
  const result = resultRecord(call);
  if (call.error) return call.error;
  if (result && typeof result.summary === 'string') return result.summary;
  if (result && result.ok === false && typeof result.error === 'string') return `${result.error}${typeof result.hint === 'string' ? ` -- ${result.hint}` : ''}`;
  const args = JSON.stringify(call.args);
  return args === '{}' ? null : args;
}

function compactForDisplay(value: unknown): unknown {
  return JSON.parse(
    JSON.stringify(value ?? null, (_key, v: unknown) => (typeof v === 'string' && v.length > MAX_DETAIL_STRING ? `<${v.length} chars>` : v)),
  ) as unknown;
}

/**
 * One Activity entry (Claude Design screens/06-studio-v2.dc.html): tool name and status, the
 * human-readable summary line, transport and time, and the raw args/result JSON behind a
 * "Details" toggle instead of always dumped inline. A captured frame returned as a data URL shows
 * as a thumbnail.
 */
export function ToolCallCard({ call }: { call: ToolCall }): ReactElement {
  const [open, setOpen] = useState(false);
  const result = resultRecord(call);
  const summary = summaryLine(call);
  const thumb = typeof result?.dataUrl === 'string' && result.dataUrl.startsWith('data:image/') ? result.dataUrl : null;
  const hasDetails = Object.keys(call.args).length > 0 || call.result !== undefined;
  const failed = call.status === 'error' || result?.ok === false;

  return (
    <div
      data-testid="tool-call-card"
      className={`flex flex-col gap-1.5 rounded-token border bg-surface px-3 py-2.5 text-[12px] ${
        call.status === 'running' ? 'border-clay-soft shadow-[0_0_0_3px_color-mix(in_srgb,var(--color-clay)_10%,transparent)]' : 'border-line'
      }`}
    >
      <div className="flex items-center gap-2">
        <span className={`h-[7px] w-[7px] flex-none rounded-full ${failed ? STATUS_DOT.error : STATUS_DOT[call.status]}`} />
        <span className="min-w-0 flex-1 truncate font-mono text-[11.5px] font-semibold text-ink">{call.name}</span>
        <span className={`flex-none rounded-full px-2 py-0.5 font-mono text-[10px] font-medium ${STATUS_PILL[call.status]}`}>{toolCallStatusText(call)}</span>
      </div>

      {(summary || thumb) && (
        <div className="flex items-center gap-2.5">
          {thumb && <img src={thumb} alt="" className="h-8 w-14 flex-none rounded object-cover" />}
          {summary && <p className={`min-w-0 break-words text-[12.5px] leading-snug ${failed ? 'text-clay-ink' : 'text-ink-2'}`}>{summary}</p>}
        </div>
      )}

      <div className="flex items-center gap-2 font-mono text-[10px] text-ink-4">
        <span className="rounded bg-chip px-1.5 py-px text-ink-3">{VIA_LABEL[call.via]}</span>
        <span>{new Date(call.startedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}</span>
        {hasDetails && (
          <button
            type="button"
            onClick={() => setOpen((o) => !o)}
            aria-expanded={open}
            className="ml-auto inline-flex items-center gap-1 rounded px-1 py-0.5 text-ink-3 hover:bg-surface-2 hover:text-ink"
          >
            {open ? 'Hide details' : 'Details'}
            {open ? <ChevronUp size={11} /> : <ChevronDown size={11} />}
          </button>
        )}
      </div>

      {open && (
        <pre className="max-h-64 overflow-auto rounded-md bg-[#1f1e1c] px-2.5 py-2 font-mono text-[10.5px] leading-relaxed text-[#e9e4da]">
          <span className="text-[#e8b89f]">args</span> {JSON.stringify(compactForDisplay(call.args))}
          {call.result !== undefined && (
            <>
              {'\n'}
              <span className="text-[#e8b89f]">result</span> {JSON.stringify(compactForDisplay(call.result), null, 2)}
            </>
          )}
        </pre>
      )}
    </div>
  );
}
