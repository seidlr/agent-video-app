import type { ReactElement } from 'react';

export interface FrameTitleProps {
  title: string;
  hidden: boolean;
}

export function FrameTitle({ title, hidden }: FrameTitleProps): ReactElement {
  if (!title) return <></>;
  return (
    <div
      className={`pointer-events-none absolute inset-x-0 bottom-[60px] text-center font-serif text-[28px] font-normal tracking-[-0.01em] text-white/90 transition-opacity duration-300 [text-shadow:0_2px_18px_rgba(0,0,0,0.5)] ${hidden ? 'opacity-0' : 'opacity-100'}`}
    >
      {title}
    </div>
  );
}
