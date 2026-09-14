import type { ReactElement } from 'react';
import type { Chapter } from '../../lib/types';

export interface FrameLabelProps {
  chapter: Chapter | null;
  index: number;
}

export function FrameLabel({ chapter, index }: FrameLabelProps): ReactElement {
  const sceneNumber = String(index + 1).padStart(2, '0');
  const title = (chapter?.title ?? '').toUpperCase();
  return (
    <div className="absolute top-3.5 left-3.5 inline-flex items-center gap-2 rounded-md bg-black/30 px-[9px] py-[5px] font-mono text-[11px] uppercase tracking-[0.06em] text-white/85 backdrop-blur-sm">
      <span className="h-1.5 w-1.5 rounded-full bg-[#E25A3C]" aria-hidden="true" />
      {title ? `SCENE ${sceneNumber} · ${title}` : `SCENE ${sceneNumber}`}
    </div>
  );
}
