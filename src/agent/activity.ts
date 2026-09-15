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

/** One-line human summary for the ToolCallCard header, e.g. "seek · done (120ms)". */
export function describeToolCall(call: ToolCall): string {
  const statusWord = call.status === 'running' ? 'running…' : call.status === 'error' ? 'failed' : 'done';
  const duration = call.endedAt !== undefined ? ` (${call.endedAt - call.startedAt}ms)` : '';
  return `${call.name} · ${statusWord}${duration}`;
}
