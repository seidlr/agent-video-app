/**
 * Chrome doesn't load video in a tab that has never been shown (found live: the studio page an
 * agent handed out was opened in a background tab, and every tool saw a 0:00, 0x0 video until the
 * human switched to it). Tools use these to say so instead of reporting a meaningless 00:00, and
 * the tab's own title asks the human to bring it forward.
 */
export function isTabHidden(): boolean {
  return typeof document !== 'undefined' && document.visibilityState === 'hidden';
}

export const HIDDEN_TAB_HINT =
  'This studio tab is in the background, and Chrome does not load video there until the tab is shown. Ask the user to bring the Agent Video Studio tab to the front, then retry.';

const TITLE_PREFIX = '▶ Show this tab · ';

/** Prefixes the tab title until the tab is visible again. No-op when already visible or asked. */
export function askToShowTab(): void {
  if (!isTabHidden() || document.title.startsWith(TITLE_PREFIX)) return;
  const original = document.title;
  document.title = `${TITLE_PREFIX}${original}`;
  const restore = (): void => {
    if (isTabHidden()) return;
    document.title = original;
    document.removeEventListener('visibilitychange', restore);
  };
  document.addEventListener('visibilitychange', restore);
}
