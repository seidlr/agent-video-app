import { randomUUID } from 'node:crypto';

/**
 * The instance-bound command bus (Task 11): per MCP session, a registry of rendered UI instances
 * and the commands in flight to them. Pure and framework-free -- `server/index.ts` is the only
 * caller, wiring `dispatch`/`pollCommands`/`postResult` to actual MCP tool handlers. Durations are
 * constructor options (defaulting to the plan's real values) so tests can exercise the exact same
 * timeout/race logic with millisecond-scale windows instead of waiting on real 15s/25s/10min clocks.
 */

export interface DispatchArgs {
  name: string;
  args: unknown;
  /** The assetId the caller last saw. Checked against the active instance's current assetId
   * before dispatching -- a mismatch means the human changed video/state since, and the command
   * would otherwise act on the wrong thing. */
  expectedAssetId?: string;
  /** Same requestId called twice returns the same `cmdId`'s status instead of dispatching twice. */
  requestId?: string;
}

/** `capture_frame` and similar tools hand back an image; the UI posts it alongside the result
 * rather than embedded inside it (Key Decisions: `post_result {..., imageBase64?, mimeType?}`) so
 * `server/index.ts` can build a real MCP `image` content block instead of a base64 string
 * inflating the JSON text block. */
export interface ImagePayload {
  base64: string;
  mimeType: string;
}

export type DispatchResult =
  | { ok: true; jobId: string; status: 'running' }
  | ({ ok: boolean; instanceId: string; asset?: string; image?: ImagePayload } & Record<string, unknown>)
  | { ok: false; error: 'ui_not_connected'; hint: string }
  | { ok: false; error: 'instance_asset_changed'; instanceId: string; asset?: string };

export interface JobStatus {
  ok: boolean;
  jobId?: string;
  status?: 'running' | 'done';
  result?: unknown;
  error?: string;
  hint?: string;
}

interface InstanceInfo {
  instanceId: string;
  assetId?: string;
  lastPollAt: number;
  active: boolean;
}

interface PendingCommand {
  cmdId: string;
  name: string;
  args: unknown;
  instanceId: string;
  createdAt: number;
  delivered: boolean;
  resolve: (result: Record<string, unknown>) => void;
}

interface StoredResult {
  result: Record<string, unknown>;
  image?: ImagePayload;
  storedAt: number;
}

interface Session {
  instances: Map<string, InstanceInfo>;
  pendingByInstance: Map<string, PendingCommand[]>;
  pendingById: Map<string, PendingCommand>;
  results: Map<string, StoredResult>;
  requestIdIndex: Map<string, string>;
}

export interface CommandBusOptions {
  /** How long an active instance can go without polling before `dispatch` gives up on it. Default 15s. */
  connectedWindowMs?: number;
  /** How long `dispatch` awaits a result before returning `{jobId, status:'running'}`. Default 25s. */
  dispatchTimeoutMs?: number;
  /** How long a stored result stays retrievable via `getJob` after `postResult`. Default 10min. */
  resultTtlMs?: number;
  /** Injectable clock, real `Date.now` by default. */
  now?: () => number;
}

const DEFAULTS = { connectedWindowMs: 15_000, dispatchTimeoutMs: 25_000, resultTtlMs: 600_000 };

export interface CommandBus {
  /** Called when a render tool (`open_video_studio`) creates a fresh UI instance. Retires every
   * other instance in the session. */
  registerInstance(sessionId: string, instanceId: string, assetId?: string): void;
  /** Called on the `activate_instance` app-only tool -- an existing instance reclaiming focus. */
  activateInstance(sessionId: string, instanceId: string): void;
  retireInstance(sessionId: string, instanceId: string): void;
  /** The UI's long-poll: returns the next undelivered command for `instanceId`, or `{retired:true}`
   * if that instance is no longer the active one. Non-blocking -- the actual long-poll wait (up to
   * ~10s) is the caller's concern, not this pure store's. */
  pollCommands(sessionId: string, instanceId: string): { retired: true } | { retired?: false; command: { cmdId: string; name: string; args: unknown } | null };
  /** Called when the UI posts a tool's result back. Resolves a still-awaiting `dispatch` call, and
   * always stores the result (so a late post after `dispatch` already returned `status:'running'`
   * is still retrievable via `getJob`). `image` is separate from `result` (see `ImagePayload`). */
  postResult(sessionId: string, instanceId: string, cmdId: string, result: Record<string, unknown>, image?: ImagePayload): void;
  /** Sends a command to the active instance and awaits its result up to `dispatchTimeoutMs`. */
  dispatch(sessionId: string, cmd: DispatchArgs): Promise<DispatchResult>;
  getJob(sessionId: string, cmdId: string): JobStatus;
}

export function createCommandBus(options: CommandBusOptions = {}): CommandBus {
  const connectedWindowMs = options.connectedWindowMs ?? DEFAULTS.connectedWindowMs;
  const dispatchTimeoutMs = options.dispatchTimeoutMs ?? DEFAULTS.dispatchTimeoutMs;
  const resultTtlMs = options.resultTtlMs ?? DEFAULTS.resultTtlMs;
  const now = options.now ?? (() => Date.now());

  const sessions = new Map<string, Session>();

  function getOrCreateSession(sessionId: string): Session {
    let session = sessions.get(sessionId);
    if (!session) {
      session = { instances: new Map(), pendingByInstance: new Map(), pendingById: new Map(), results: new Map(), requestIdIndex: new Map() };
      sessions.set(sessionId, session);
    }
    return session;
  }

  function activate(session: Session, instanceId: string): void {
    for (const inst of session.instances.values()) inst.active = inst.instanceId === instanceId;
  }

  function getActiveInstance(session: Session): InstanceInfo | undefined {
    return [...session.instances.values()].find((inst) => inst.active);
  }

  function pruneExpiredResults(session: Session): void {
    const cutoff = now() - resultTtlMs;
    for (const [cmdId, stored] of session.results) {
      if (stored.storedAt < cutoff) session.results.delete(cmdId);
    }
  }

  function registerInstance(sessionId: string, instanceId: string, assetId?: string): void {
    const session = getOrCreateSession(sessionId);
    activate(session, instanceId);
    session.instances.set(instanceId, { instanceId, assetId, lastPollAt: now(), active: true });
    if (!session.pendingByInstance.has(instanceId)) session.pendingByInstance.set(instanceId, []);
  }

  function activateInstance(sessionId: string, instanceId: string): void {
    const session = getOrCreateSession(sessionId);
    if (!session.instances.has(instanceId)) {
      registerInstance(sessionId, instanceId);
      return;
    }
    activate(session, instanceId);
    session.instances.get(instanceId)!.lastPollAt = now();
  }

  function retireInstance(sessionId: string, instanceId: string): void {
    const inst = sessions.get(sessionId)?.instances.get(instanceId);
    if (inst) inst.active = false;
  }

  function pollCommands(sessionId: string, instanceId: string): ReturnType<CommandBus['pollCommands']> {
    const session = getOrCreateSession(sessionId);
    const inst = session.instances.get(instanceId);
    if (!inst || !inst.active) return { retired: true };
    inst.lastPollAt = now();
    const queue = session.pendingByInstance.get(instanceId) ?? [];
    const next = queue.find((c) => !c.delivered);
    if (!next) return { command: null };
    next.delivered = true;
    return { command: { cmdId: next.cmdId, name: next.name, args: next.args } };
  }

  function postResult(sessionId: string, instanceId: string, cmdId: string, result: Record<string, unknown>, image?: ImagePayload): void {
    const session = getOrCreateSession(sessionId);
    const pending = session.pendingById.get(cmdId);
    const inst = session.instances.get(instanceId);
    const tagged = { ...result, instanceId, asset: inst?.assetId, ...(image ? { image } : {}) };
    session.results.set(cmdId, { result: tagged, image, storedAt: now() });
    if (pending) {
      pending.resolve(tagged);
      session.pendingById.delete(cmdId);
      const queue = session.pendingByInstance.get(instanceId);
      if (queue) {
        const idx = queue.findIndex((c) => c.cmdId === cmdId);
        if (idx >= 0) queue.splice(idx, 1);
      }
    }
  }

  async function dispatch(sessionId: string, cmd: DispatchArgs): Promise<DispatchResult> {
    const session = getOrCreateSession(sessionId);
    pruneExpiredResults(session);

    if (cmd.requestId) {
      const existingCmdId = session.requestIdIndex.get(cmd.requestId);
      if (existingCmdId) {
        const job = getJob(sessionId, existingCmdId);
        if (job.status === 'done') return job.result as DispatchResult;
        return { ok: true, jobId: existingCmdId, status: 'running' };
      }
    }

    const active = getActiveInstance(session);
    if (!active || now() - active.lastPollAt > connectedWindowMs) {
      return { ok: false, error: 'ui_not_connected', hint: 'No UI instance has polled recently. Render the MCP App (open_video_studio) or open the site with the bus URL first.' };
    }
    if (cmd.expectedAssetId !== undefined && active.assetId !== cmd.expectedAssetId) {
      return { ok: false, error: 'instance_asset_changed', instanceId: active.instanceId, asset: active.assetId };
    }

    const cmdId = randomUUID();
    if (cmd.requestId) session.requestIdIndex.set(cmd.requestId, cmdId);

    const resultPromise = new Promise<Record<string, unknown>>((resolve) => {
      const pending: PendingCommand = { cmdId, name: cmd.name, args: cmd.args, instanceId: active.instanceId, createdAt: now(), delivered: false, resolve };
      session.pendingById.set(cmdId, pending);
      const queue = session.pendingByInstance.get(active.instanceId) ?? [];
      queue.push(pending);
      session.pendingByInstance.set(active.instanceId, queue);
    });

    const timeout = new Promise<'timeout'>((resolve) => setTimeout(() => resolve('timeout'), dispatchTimeoutMs));
    const winner = await Promise.race([resultPromise, timeout]);
    if (winner === 'timeout') {
      return { ok: true, jobId: cmdId, status: 'running' };
    }
    return winner as DispatchResult;
  }

  function getJob(sessionId: string, cmdId: string): JobStatus {
    const session = getOrCreateSession(sessionId);
    pruneExpiredResults(session);
    const stored = session.results.get(cmdId);
    if (stored) return { ok: true, jobId: cmdId, status: 'done', result: stored.result };
    if (session.pendingById.has(cmdId)) return { ok: true, jobId: cmdId, status: 'running' };
    return { ok: false, error: 'unknown_job', hint: `No job with id "${cmdId}"` };
  }

  return { registerInstance, activateInstance, retireInstance, pollCommands, postResult, dispatch, getJob };
}
