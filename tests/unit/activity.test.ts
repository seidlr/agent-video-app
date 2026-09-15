import { describe, expect, it } from 'vitest';
import { describeToolCall } from '../../src/agent/activity';
import type { ToolCall } from '../../src/lib/types';

function call(overrides: Partial<ToolCall> = {}): ToolCall {
  return {
    id: 'c1',
    name: 'seek',
    args: { time: 5 },
    via: 'testing',
    status: 'running',
    startedAt: 1000,
    ...overrides,
  };
}

describe('describeToolCall', () => {
  it('describes a running call with no duration yet', () => {
    expect(describeToolCall(call({ status: 'running' }))).toBe('seek · running…');
  });

  it('describes a done call with its duration', () => {
    expect(describeToolCall(call({ status: 'done', endedAt: 1120 }))).toBe('seek · done (120ms)');
  });

  it('describes a failed call', () => {
    expect(describeToolCall(call({ status: 'error', endedAt: 1050, error: 'boom' }))).toBe('seek · failed (50ms)');
  });
});
