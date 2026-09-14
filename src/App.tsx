import type { ReactElement } from 'react';

// Task 1 tokens smoke test: renders the top bar + a two-panel studio placeholder against the
// selected design (light 1a / dark 1b — see docs/design/DESIGN.md). Task 3 replaces the
// placeholders with the real VideoStage, Timeline and rail panels.
export function App(): ReactElement {
  return (
    <div className="min-h-screen bg-bg text-ink font-sans">
      <div className="mx-auto flex max-w-[1440px] flex-col px-5 pb-8">
        <header className="flex h-[54px] flex-none items-center gap-4 border-b border-line">
          <div className="grid h-6 w-6 place-items-center rounded-[7px] bg-clay font-serif text-[13px] font-semibold text-surface">
            A
          </div>
          <div className="text-[14.5px] font-semibold">
            <span>Agent</span> <span className="font-medium text-ink-3">· video studio</span>
          </div>
        </header>
        <main className="flex flex-1 gap-4 pt-4">
          <section className="flex-1 rounded-token-lg border border-line bg-surface p-4 text-ink-3">
            Studio placeholder — VideoStage lands in Task 3.
          </section>
          <aside className="w-[392px] flex-none rounded-token-lg border border-line bg-surface p-4 text-ink-3">
            Agent rail placeholder — Activity feed lands in Task 4.
          </aside>
        </main>
      </div>
    </div>
  );
}
