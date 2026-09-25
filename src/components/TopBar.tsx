import { useEffect } from 'react';
import type { ReactElement } from 'react';
import { Moon, Sun, SunMoon } from 'lucide-react';
import { useStudio } from '../store/studio';
import type { ThemeSetting } from '../store/studio';
import { AgentPresence } from './AgentPresence';

const THEME_CYCLE: ThemeSetting[] = ['system', 'light', 'dark'];
const THEME_ICON: Record<ThemeSetting, typeof Sun> = { system: SunMoon, light: Sun, dark: Moon };

/**
 * Claude Design screens/06-studio-v2.dc.html (evolving 01-studio.dc.html): brand, breadcrumb, the
 * agent-presence chip (transport + latest call + call count, replacing the old transport pill and
 * the toast stack), and the light/dark/system theme toggle.
 */
export function TopBar(): ReactElement {
  const sourceTitle = useStudio((s) => s.source?.title);
  const theme = useStudio((s) => s.ui.theme);
  const setTheme = useStudio((s) => s.setTheme);
  const ThemeIcon = THEME_ICON[theme];

  useEffect(() => {
    const root = document.documentElement;
    if (theme === 'system') root.removeAttribute('data-theme');
    else root.setAttribute('data-theme', theme);
  }, [theme]);

  function cycleTheme(): void {
    const next = THEME_CYCLE[(THEME_CYCLE.indexOf(theme) + 1) % THEME_CYCLE.length] as ThemeSetting;
    setTheme(next);
  }

  return (
    <header className="flex h-[54px] flex-none items-center gap-2.5 border-b border-line bg-surface px-3 sm:gap-4 sm:px-5">
      <div className="grid h-6 w-6 flex-none place-items-center rounded-[7px] bg-clay font-serif text-[13px] font-semibold text-surface">
        A
      </div>
      <div className="hidden flex-none text-[14.5px] font-semibold sm:block">
        <span>Agent</span> <span className="font-medium text-ink-3">· video studio</span>
      </div>
      <div className="hidden min-w-0 truncate text-[12.5px] text-ink-3 lg:block">
        Library / <b className="font-medium text-ink">{sourceTitle ?? 'no video loaded'}</b>
      </div>
      <div className="flex-1" />
      <AgentPresence />
      <button
        type="button"
        onClick={cycleTheme}
        aria-label={`Theme: ${theme} (click to change)`}
        title={`Theme: ${theme}`}
        className="grid h-8 w-8 flex-none place-items-center rounded-token border border-line bg-surface text-ink-3 hover:text-ink"
      >
        <ThemeIcon size={15} />
      </button>
    </header>
  );
}
