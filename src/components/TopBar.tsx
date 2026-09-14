import { useEffect } from 'react';
import type { ReactElement } from 'react';
import { useStudio } from '../store/studio';
import type { ThemeSetting } from '../store/studio';

const TRANSPORT_LABEL: Record<string, { text: string; tone: 'good' | 'off' }> = {
  webmcp: { text: 'WebMCP · connected', tone: 'good' },
  bridge: { text: 'Bridge · connected', tone: 'good' },
  'mcp-app': { text: 'MCP App · connected', tone: 'good' },
  'mcp-bus': { text: 'MCP bus · connected', tone: 'good' },
  none: { text: 'No agent connected', tone: 'off' },
};

const THEME_CYCLE: ThemeSetting[] = ['system', 'light', 'dark'];
const THEME_ICON: Record<ThemeSetting, string> = { system: '◐', light: '☀', dark: '☾' };

/**
 * Ported from the Claude Design deliverable (screens/01-studio.dc.html), adapted from the old
 * project's TopBar.tsx: the Firebase auth pill becomes the agent-transport pill, and a
 * light/dark/system theme toggle replaces the old sign-out-driven state.
 */
export function TopBar(): ReactElement {
  const sourceTitle = useStudio((s) => s.source?.title);
  const theme = useStudio((s) => s.ui.theme);
  const setTheme = useStudio((s) => s.setTheme);
  const transport = useStudio((s) => s.ui.agentTransport);

  useEffect(() => {
    const root = document.documentElement;
    if (theme === 'system') root.removeAttribute('data-theme');
    else root.setAttribute('data-theme', theme);
  }, [theme]);

  function cycleTheme(): void {
    const next = THEME_CYCLE[(THEME_CYCLE.indexOf(theme) + 1) % THEME_CYCLE.length] as ThemeSetting;
    setTheme(next);
  }

  const pill = TRANSPORT_LABEL[transport] ?? TRANSPORT_LABEL.none!;

  return (
    <header className="flex h-[54px] flex-none items-center gap-4 border-b border-line bg-surface px-5">
      <div className="grid h-6 w-6 place-items-center rounded-[7px] bg-clay font-serif text-[13px] font-semibold text-surface">
        A
      </div>
      <div className="text-[14.5px] font-semibold">
        <span>Agent</span> <span className="font-medium text-ink-3">· video studio</span>
      </div>
      <div className="text-[12.5px] text-ink-3">
        Library / <b className="font-medium text-ink">{sourceTitle ?? 'no video loaded'}</b>
      </div>
      <div className="flex-1" />
      <button
        type="button"
        onClick={cycleTheme}
        aria-label={`Theme: ${theme} (click to change)`}
        title={`Theme: ${theme}`}
        className="grid h-7 w-7 place-items-center rounded-token border border-line bg-surface text-ink-3"
      >
        {THEME_ICON[theme]}
      </button>
      <div
        className={`flex items-center gap-1.5 rounded-full px-2.5 py-1 font-mono text-[10.5px] ${pill.tone === 'good' ? 'bg-good-soft text-good' : 'bg-chip text-ink-3'}`}
      >
        <span className={`h-1.5 w-1.5 rounded-full ${pill.tone === 'good' ? 'bg-good' : 'bg-ink-4'}`} />
        {pill.text}
      </div>
    </header>
  );
}
