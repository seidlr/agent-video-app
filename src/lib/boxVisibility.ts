import type { Box } from './types';

const POINT_VISIBILITY_WINDOW = 0.5;

/** True when `box` should be drawn on the stage at `currentTime`. Pure, so it's cheaply testable
 * independent of BoxOverlay's rendering. */
export function isBoxVisibleAt(box: Pick<Box, 'time' | 'until'>, currentTime: number): boolean {
  if (box.until !== undefined) return currentTime >= box.time && currentTime <= box.until;
  return Math.abs(box.time - currentTime) <= POINT_VISIBILITY_WINDOW;
}
