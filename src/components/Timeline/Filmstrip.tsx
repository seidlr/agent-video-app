import type { ReactElement } from 'react';

export interface FilmstripProps {
  urls: string[];
}

/**
 * Minimal filmstrip: renders whatever thumbnail URLs the current source resolved (today, only
 * YouTube's 4 free i.ytimg.com stills via source.filmstripUrls). Task 5 replaces this with a
 * mediabunny-generated sprite for local/URL sources; this component itself is kept as the
 * shared display, extended rather than duplicated.
 */
export function Filmstrip({ urls }: FilmstripProps): ReactElement {
  if (urls.length === 0) return <></>;
  return (
    <div className="flex h-11 flex-none gap-[3px] overflow-hidden rounded-token">
      {urls.map((url, i) => (
        <img
          key={url}
          src={url}
          alt={`Frame preview ${i + 1}`}
          crossOrigin="anonymous"
          className="h-full flex-1 object-cover"
        />
      ))}
    </div>
  );
}
