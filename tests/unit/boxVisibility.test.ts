import { describe, expect, it } from 'vitest';
import { isBoxVisibleAt } from '../../src/lib/boxVisibility';

describe('isBoxVisibleAt', () => {
  it('a point box (no "until") is visible within 0.5s of its timestamp', () => {
    expect(isBoxVisibleAt({ time: 10 }, 10.4)).toBe(true);
    expect(isBoxVisibleAt({ time: 10 }, 9.6)).toBe(true);
    expect(isBoxVisibleAt({ time: 10 }, 10.6)).toBe(false);
  });

  it('a ranged box (with "until") is visible for its whole [time, until] span', () => {
    expect(isBoxVisibleAt({ time: 5, until: 20 }, 5)).toBe(true);
    expect(isBoxVisibleAt({ time: 5, until: 20 }, 12)).toBe(true);
    expect(isBoxVisibleAt({ time: 5, until: 20 }, 20)).toBe(true);
    expect(isBoxVisibleAt({ time: 5, until: 20 }, 4.9)).toBe(false);
    expect(isBoxVisibleAt({ time: 5, until: 20 }, 20.1)).toBe(false);
  });
});
