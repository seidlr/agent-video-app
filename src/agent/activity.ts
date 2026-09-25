import type { ToolCall } from '../lib/types';
import type { StudioStore } from '../store/studio';
import type { RegistryDeps } from './registry';

/** Binds the registry's Activity logging to a real studio store instance -- keeps registry.ts
 * store-agnostic (it only knows the plain RegistryDeps shape) while every transport shares one
 * Activity feed via this single binding. */
export function createActivityDeps(store: StudioStore): RegistryDeps {
  return {
    pushActivity: (call) => store.getState().pushActivity(call),
    updateActivity: (id, patch) => store.getState().updateActivity(id, patch),
  };
}

/** A tool call's status and duration for the Activity card and the top bar's agent-presence
 * chip, e.g. "done · 120ms", "failed · 1.2s", "running…". */
export function toolCallStatusText(call: ToolCall): string {
  if (call.status === 'running') return 'running…';
  const word = call.status === 'error' ? 'failed' : 'done';
  if (call.endedAt === undefined) return word;
  const ms = call.endedAt - call.startedAt;
  return `${word} · ${ms < 1000 ? `${ms}ms` : `${(ms / 1000).toFixed(1)}s`}`;
}
