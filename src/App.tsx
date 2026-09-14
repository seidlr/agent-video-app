import type { ReactElement } from 'react';
import { TopBar } from './components/TopBar';
import { VideoStage } from './components/Stage/VideoStage';
import { Library } from './components/Panels/Library';
import { useStudio } from './store/studio';
import type { PanelId } from './store/studio';

const TABS: { id: PanelId; label: string }[] = [
  { id: 'library', label: 'Library' },
  { id: 'activity', label: 'Activity' },
  { id: 'notes', label: 'Notes' },
  { id: 'tracking', label: 'Tracking' },
  { id: 'vision', label: 'Vision' },
  { id: 'transcript', label: 'Transcript' },
  { id: 'clips', label: 'Clips' },
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
    default:
      return <ComingSoonPanel label={TABS.find((t) => t.id === panel)?.label ?? panel} />;
  }
}

export function App(): ReactElement {
  const source = useStudio((s) => s.source);
  const panel = useStudio((s) => s.ui.panel);
  const setView = useStudio((s) => s.setView);

  return (
    <div className="flex h-screen flex-col bg-bg text-ink">
      <TopBar />
      <div className="mx-auto flex min-h-0 w-full max-w-[1440px] flex-1 gap-0 px-5 pb-5">
        <main className="flex min-w-0 flex-1 flex-col gap-3.5 py-4">
          {source ? (
            <VideoStage />
          ) : (
            <div className="grid flex-1 place-items-center rounded-token-lg border border-line bg-surface text-ink-3">
              Load a video from the Library panel to get started.
            </div>
          )}
        </main>
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
      </div>
    </div>
  );
}
