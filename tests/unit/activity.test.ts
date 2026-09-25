import { describe, expect, it } from 'vitest';
import { toolCallStatusText } from '../../src/agent/activity';
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

describe('toolCallStatusText', () => {
  it('describes a running call with no duration yet', () => {
    expect(toolCallStatusText(call({ status: 'running' }))).toBe('running…');
  });

  it('describes a done call with its duration in ms under a second', () => {
    expect(toolCallStatusText(call({ status: 'done', endedAt: 1120 }))).toBe('done · 120ms');
  });

  it('switches to seconds from one second up', () => {
    expect(toolCallStatusText(call({ status: 'done', endedAt: 21_003 }))).toBe('done · 20.0s');
  });

  it('describes a failed call', () => {
    expect(toolCallStatusText(call({ status: 'error', endedAt: 1050, error: 'boom' }))).toBe('failed · 50ms');
  });
});
