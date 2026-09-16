import { Bot, Captions, Crop, Eye, FileDown, Scissors, Search, Wand2 } from 'lucide-react';
import type { ReactElement } from 'react';

const STEPS = [
  { title: 'Load a video', body: 'Drop a file, pick a sample, or hand your agent a YouTube link — all in the Library tab.' },
  { title: 'Point an agent at this page', body: 'Claude Desktop, ChatGPT, Codex CLI, or any WebMCP-aware host. See the Skill tab for the exact steps for yours.' },
  { title: 'Step back', body: 'Everything below happens through tool calls your agent makes -- this page is the UI, not the driver.' },
];

const CAPABILITIES: { icon: typeof Bot; label: string }[] = [
  { icon: Eye, label: 'Play, seek, capture frames' },
  { icon: Crop, label: 'Segment & track any object (EdgeTAM)' },
  { icon: Search, label: 'Detect scenes, search "the red car", describe what\'s on screen' },
  { icon: Captions, label: 'Transcribe & translate speech' },
  { icon: Wand2, label: 'Remove backgrounds, add a voice-over, upscale a frame' },
  { icon: Scissors, label: 'Cut clips and export GIFs' },
  { icon: FileDown, label: 'Export notes as Markdown, SRT, VTT, or EDL' },
];

/** First thing a human visitor sees, before any video is loaded (Task 14, user-requested):
 * explains this is agent-first -- what the human does, and what their agent can then do -- rather
 * than leaving them looking at a bare "load a video" prompt with no context for why an AI-driven
 * app looks like a normal video player. */
export function WelcomeExplainer(): ReactElement {
  return (
    <div className="flex flex-1 items-center justify-center overflow-y-auto rounded-token-lg border border-line bg-surface p-6">
      <div className="flex w-full max-w-2xl flex-col gap-6">
        <div className="flex items-start gap-3">
          <div className="grid h-9 w-9 flex-none place-items-center rounded-token bg-clay-soft text-clay-ink">
            <Bot size={18} />
          </div>
          <div>
            <h2 className="text-base font-semibold text-ink">Built for an AI agent to drive</h2>
            <p className="mt-0.5 text-[13px] text-ink-3">
              There's no chat here -- an external agent (Claude, ChatGPT, Codex, ...) calls this page's tools directly. You load the video and connect
              your agent; it does the rest.
            </p>
          </div>
        </div>

        <div>
          <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-ink-3">What you do</h3>
          <ol className="flex flex-col gap-2.5">
            {STEPS.map((step, i) => (
              <li key={step.title} className="flex gap-2.5 text-[13px]">
                <span className="grid h-5 w-5 flex-none place-items-center rounded-full bg-surface-2 font-mono text-[11px] text-ink-2">{i + 1}</span>
                <span>
                  <b className="text-ink">{step.title}</b> <span className="text-ink-3">— {step.body}</span>
                </span>
              </li>
            ))}
          </ol>
        </div>

        <div>
          <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-ink-3">What your agent can then do</h3>
          <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            {CAPABILITIES.map(({ icon: Icon, label }) => (
              <li key={label} className="flex items-start gap-2 rounded-token bg-surface-2 p-2 text-[12.5px] text-ink-2">
                <Icon size={14} className="mt-0.5 flex-none text-ink-3" />
                <span>{label}</span>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}
