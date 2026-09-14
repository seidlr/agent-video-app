import type { ReactElement } from 'react';

export interface PlayOverlayProps {
  hidden: boolean;
  onPlay: () => void;
}

export function PlayOverlay({ hidden, onPlay }: PlayOverlayProps): ReactElement {
  return (
    <div
      className={`absolute inset-0 grid place-items-center bg-gradient-to-b from-transparent to-black/35 transition-opacity duration-200 ${hidden ? 'pointer-events-none opacity-0' : 'opacity-100'}`}
    >
      <button
        type="button"
        onClick={onPlay}
        aria-label="Play video"
        className="grid h-16 w-16 place-items-center rounded-full bg-clay shadow-[0_8px_24px_rgba(0,0,0,0.25)] transition-transform hover:scale-105"
      >
        <svg width="22" height="22" viewBox="0 0 24 24" className="ml-[3px] fill-surface">
          <path d="M8 5v14l11-7z" />
        </svg>
      </button>
    </div>
  );
}
