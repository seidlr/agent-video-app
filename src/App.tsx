import type { ReactElement } from 'react';
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
import { ToastStack } from './components/ToastStack';
import { WelcomeExplainer } from './components/WelcomeExplainer';
import { useStudio } from './store/studio';
import type { PanelId } from './store/studio';

const TABS: { id: PanelId; label: string }[] = [
  { id: 'library', label: 'Library' },
  { id: 'activity', label: 'Activity' },
  { id: 'notes', label: 'Notes' },
  { id: 'frames', label: 'Frames' },
  { id: 'tracking', label: 'Tracking' },
  { id: 'vision', label: 'Vision' },
  { id: 'transcript', label: 'Transcript' },
  { id: 'clips', label: 'Clips' },
  { id: 'effects', label: 'Effects' },
  { id: 'models', label: 'Models' },
  { id: 'skill', label: 'Skill' },
];

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

  return (
    <div className="flex h-screen flex-col bg-bg text-ink">
      <TopBar />
      <div className={`mx-auto flex min-h-0 w-full flex-1 gap-0 pb-5 ${compact ? 'px-2' : 'max-w-[1440px] px-5'}`}>
        <main className="flex min-w-0 flex-1 flex-col gap-3.5 py-4">
          {source ? <VideoStage /> : <WelcomeExplainer />}
        </main>
        {/* Task 11/14's own "compact layout" gap: `set_view {layout:'focus'}` (any transport, and
            src/agent/mcpApp.ts's own displayMode:'pip' handling) drops this 392px-wide side panel
            entirely rather than trying to squeeze its tab bar + panel body into a real MCP App
            PiP window's own much smaller footprint -- there's nowhere for it to reasonably go at
            that size. `layout:'studio'` (the default) is unchanged. */}
        {!compact && (
          <aside className="flex w-[392px] flex-none flex-col border-l border-line bg-surface">
            <div className="flex flex-wrap gap-0.5 px-3 pt-2.5">
              {TABS.map((tab) => (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => setView(tab.id)}
                  className={`rounded-t-md px-2.5 py-1.5 font-mono text-[10.5px] ${panel === tab.id ? 'border border-b-0 border-line bg-bg text-ink' : 'text-ink-3'}`}
                >
                  {tab.label}
                </button>
              ))}
            </div>
            <div className="flex-1 overflow-y-auto p-3.5">
              <PanelBody panel={panel} />
            </div>
          </aside>
        )}
      </div>
      <ToastStack />
    </div>
  );
}
