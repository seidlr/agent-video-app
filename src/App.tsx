import type { ReactElement } from 'react';
import { Activity as ActivityIcon, Captions, Cpu, Eye, FolderOpen, Images, NotebookPen, Puzzle, Scan, Scissors, WandSparkles } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { TopBar } from './components/TopBar';
import { VideoStage } from './components/Stage/VideoStage';
import { Library } from './components/Panels/Library';
import { Activity } from './components/Panels/Activity';
import { Frames } from './components/Panels/Frames';
import { Models } from './components/Panels/Models';
import { Notes } from './components/Panels/Notes';
import { Tracking } from './components/Panels/Tracking';
import { Vision } from './components/Panels/Vision';
import { Transcript } from './components/Panels/Transcript';
import { Clips } from './components/Panels/Clips';
import { Effects } from './components/Panels/Effects';
import { Skill } from './components/Panels/Skill';
import { WelcomeExplainer } from './components/WelcomeExplainer';
import { useStudio } from './store/studio';
import type { PanelId } from './store/studio';

interface NavItem {
  id: PanelId;
  label: string;
  icon: LucideIcon;
}

/** Claude Design screens/06-studio-v2.dc.html: eleven panels as a grouped icon+label column rather
 * than a tab strip that wrapped to three rows in the rail. Labels stay visible text -- they're how
 * a human scans the column, and the e2e suite selects panels by them. */
const NAV_GROUPS: { label: string; items: NavItem[] }[] = [
  {
    label: 'Media',
    items: [
      { id: 'library', label: 'Library', icon: FolderOpen },
      { id: 'notes', label: 'Notes', icon: NotebookPen },
      { id: 'frames', label: 'Frames', icon: Images },
      { id: 'clips', label: 'Clips', icon: Scissors },
    ],
  },
  {
    label: 'Analyze',
    items: [
      { id: 'tracking', label: 'Tracking', icon: Scan },
      { id: 'vision', label: 'Vision', icon: Eye },
      { id: 'transcript', label: 'Transcript', icon: Captions },
      { id: 'effects', label: 'Effects', icon: WandSparkles },
    ],
  },
  {
    label: 'Agent',
    items: [
      { id: 'activity', label: 'Activity', icon: ActivityIcon },
      { id: 'models', label: 'Models', icon: Cpu },
      { id: 'skill', label: 'Skill', icon: Puzzle },
    ],
  },
];

const TABS: NavItem[] = NAV_GROUPS.flatMap((g) => g.items);

function plural(n: number, word: string, pluralWord = `${word}s`): string {
  return `${n} ${n === 1 ? word : pluralWord}`;
}

/** A one-line count under the panel title, for panels whose content is a list. */
function usePanelMeta(panel: PanelId): string | null {
  return useStudio((s) => {
    switch (panel) {
      case 'activity':
        return s.activity.length > 0 ? plural(s.activity.length, 'call') : null;
      case 'notes':
        return `${plural(s.notes.length, 'note')} · ${plural(s.chapters.length, 'chapter')}`;
      case 'frames':
        return plural(s.frames.length, 'frame');
      case 'tracking':
        return `${plural(s.boxes.length, 'box', 'boxes')} · ${plural(s.tracks.length, 'track')}`;
      case 'clips':
        return plural(s.clips.length, 'clip');
      default:
        return null;
    }
  });
}

function RailNav({ panel, onSelect }: { panel: PanelId; onSelect: (id: PanelId) => void }): ReactElement {
  const agentBusy = useStudio((s) => s.activity.some((c) => c.status === 'running'));
  return (
    <nav aria-label="Panels" className="flex w-[70px] flex-none flex-col gap-3.5 overflow-y-auto border-r border-line bg-bg px-[7px] py-3">
      {NAV_GROUPS.map((group) => (
        <div key={group.label} className="flex flex-col gap-0.5">
          <div className="pb-1 text-center font-mono text-[8.5px] font-semibold uppercase tracking-[0.08em] text-ink-4">{group.label}</div>
          {group.items.map((item) => {
            const active = panel === item.id;
            const Icon = item.icon;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => onSelect(item.id)}
                aria-current={active ? 'page' : undefined}
                className={`relative flex flex-col items-center gap-1 rounded-[9px] px-0.5 pb-1.5 pt-[7px] text-[10px] font-medium transition-colors ${
                  active ? 'bg-surface text-clay-ink shadow-[0_0_0_1px_var(--color-line)]' : 'text-ink-3 hover:bg-surface-2 hover:text-ink'
                }`}
              >
                <Icon size={16} className={active ? 'text-clay' : undefined} aria-hidden />
                {item.label}
                {item.id === 'activity' && agentBusy && (
                  <span aria-hidden className="absolute right-[13px] top-1.5 h-[7px] w-[7px] rounded-full border-2 border-bg bg-warn motion-safe:animate-pulse" />
                )}
              </button>
            );
          })}
        </div>
      ))}
    </nav>
  );
}

/** Panels not yet implemented land here as a placeholder until their owning task builds them. */
function ComingSoonPanel({ label }: { label: string }): ReactElement {
  return <p className="text-[13px] text-ink-3">The {label} panel arrives in a later task.</p>;
}

function PanelBody({ panel }: { panel: PanelId }): ReactElement {
  switch (panel) {
    case 'library':
      return <Library />;
    case 'activity':
      return <Activity />;
    case 'frames':
      return <Frames />;
    case 'notes':
      return <Notes />;
    case 'tracking':
      return <Tracking />;
    case 'models':
      return <Models />;
    case 'vision':
      return <Vision />;
    case 'transcript':
      return <Transcript />;
    case 'clips':
      return <Clips />;
    case 'effects':
      return <Effects />;
    case 'skill':
      return <Skill />;
    default:
      return <ComingSoonPanel label={TABS.find((t) => t.id === panel)?.label ?? panel} />;
  }
}

export function App(): ReactElement {
  const source = useStudio((s) => s.source);
  const panel = useStudio((s) => s.ui.panel);
  const layout = useStudio((s) => s.ui.layout);
  const setView = useStudio((s) => s.setView);
  const compact = layout === 'focus';
  const panelMeta = usePanelMeta(panel);
  const panelLabel = TABS.find((t) => t.id === panel)?.label ?? panel;

  return (
    <div className="flex h-screen flex-col bg-bg text-ink">
      <TopBar />
      {/* Below 1024px (an inline MCP App card in a chat, a narrow window) the rail stacks under the
          video instead of squeezing it beside a 430px column; the page then scrolls. */}
      <div
        className={`mx-auto flex min-h-0 w-full flex-1 flex-col gap-0 overflow-y-auto pb-5 lg:flex-row lg:overflow-visible ${compact ? 'px-2' : 'max-w-[1440px] px-3 sm:px-5'}`}
      >
        <main className="flex min-w-0 flex-none flex-col gap-3.5 py-4 lg:flex-1">
          {source ? <VideoStage /> : <WelcomeExplainer />}
        </main>
        {/* Task 11/14's own "compact layout" gap: `set_view {layout:'focus'}` (any transport, and
            src/agent/mcpApp.ts's own displayMode:'pip' handling) drops this 430px-wide side panel
            entirely rather than trying to squeeze its tab bar + panel body into a real MCP App
            PiP window's own much smaller footprint -- there's nowhere for it to reasonably go at
            that size. `layout:'studio'` (the default) is unchanged. */}
        {!compact && (
          <aside className="flex h-[560px] w-full flex-none overflow-hidden rounded-token-lg border border-line bg-surface lg:h-auto lg:w-[430px] lg:rounded-none lg:border-y-0 lg:border-r-0">
            <RailNav panel={panel} onSelect={(id) => setView(id)} />
            <section aria-label={panelLabel} className="flex min-w-0 flex-1 flex-col">
              <div className="flex flex-none items-baseline justify-between gap-2.5 border-b border-line px-4 pb-3 pt-4">
                <h2 className="text-[15px] font-semibold tracking-[-0.01em]">{panelLabel}</h2>
                {panelMeta && <span className="truncate font-mono text-[10.5px] text-ink-3">{panelMeta}</span>}
              </div>
              <div className="flex-1 overflow-y-auto p-3.5">
                <PanelBody panel={panel} />
              </div>
            </section>
          </aside>
        )}
      </div>
    </div>
  );
}
