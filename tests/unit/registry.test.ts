import { describe, expect, it, vi } from 'vitest';
import { buildManifest, createRegistry, type ToolDefinition, type ToolResult } from '../../src/agent/registry';
import type { ToolCall } from '../../src/lib/types';

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function fakeDeps() {
  const activity: ToolCall[] = [];
  return {
    activity,
    pushActivity: vi.fn((call: Omit<ToolCall, 'endedAt' | 'result' | 'error'>) => {
      activity.push(call as ToolCall);
    }),
    // Immutable update, matching the real store (src/store/studio.ts updateActivity): must not
    // mutate the object reference captured in pushActivity's call history, or a later
    // toHaveBeenCalledWith assertion on that history would see the mutated (post-update) value.
    updateActivity: vi.fn((id: string, patch: Partial<ToolCall>) => {
      const index = activity.findIndex((a) => a.id === id);
      if (index !== -1) activity[index] = { ...activity[index], ...patch } as ToolCall;
    }),
  };
}

const PING_TOOL: ToolDefinition<{ time: number }> = {
  name: 'ping',
  description: 'Echoes back the given time.',
  inputSchema: { type: 'object', properties: { time: { type: 'number' } }, required: ['time'] },
  group: 'session',
  when: 'always',
  handler: (args) => ({ ok: true, summary: `pong ${args.time}` }),
};

describe('createRegistry', () => {
  it('define()/get()/list() round-trip a tool', () => {
    const registry = createRegistry(fakeDeps());
    registry.define(PING_TOOL);
    expect(registry.get('ping')).toBe(PING_TOOL);
    expect(registry.list().map((t) => t.name)).toEqual(['ping']);
  });

  it('define() throws on a duplicate tool name (a programming error, not an agent-facing one)', () => {
    const registry = createRegistry(fakeDeps());
    registry.define(PING_TOOL);
    expect(() => registry.define(PING_TOOL)).toThrow(/ping/);
  });

  it('list({when}) filters by registration condition', () => {
    const registry = createRegistry(fakeDeps());
    registry.define(PING_TOOL);
    registry.define({ ...PING_TOOL, name: 'local_only', when: 'local' });
    expect(registry.list({ when: ['local'] }).map((t) => t.name)).toEqual(['local_only']);
    expect(registry.list({ when: ['always'] }).map((t) => t.name)).toEqual(['ping']);
  });

  it('call() returns ok:false,error:"unknown_tool" for an unregistered name, never throwing', async () => {
    const registry = createRegistry(fakeDeps());
    const result = await registry.call('does_not_exist', {});
    expect(result).toMatchObject({ ok: false, error: 'unknown_tool' });
  });

  it('call() rejects invalid args with the offending path in the hint, without invoking the handler', async () => {
    const registry = createRegistry(fakeDeps());
    const handler = vi.fn((): ToolResult => ({ ok: true, summary: 'should not run' }));
    registry.define({ ...PING_TOOL, handler });

    const result = await registry.call('ping', { time: 'not-a-number' });
    expect(result).toMatchObject({ ok: false, error: 'invalid_args' });
    expect((result as { hint?: string }).hint).toContain('$.time');
    expect(handler).not.toHaveBeenCalled();
  });

  it('call() invokes the handler and returns its result for valid args', async () => {
    const registry = createRegistry(fakeDeps());
    registry.define(PING_TOOL);
    const result = await registry.call('ping', { time: 5 });
    expect(result).toEqual({ ok: true, summary: 'pong 5' });
  });

  it('call() catches a thrown handler error and returns ok:false instead of throwing', async () => {
    const registry = createRegistry(fakeDeps());
    registry.define({
      ...PING_TOOL,
      handler: () => {
        throw new Error('kaboom');
      },
    });
    const result = await expect(registry.call('ping', { time: 1 })).resolves.toMatchObject({
      ok: false,
      error: expect.stringContaining('kaboom'),
    });
    void result;
  });

  it('call() logs a running-then-done pair to Activity with the given via', async () => {
    const deps = fakeDeps();
    const registry = createRegistry(deps);
    registry.define(PING_TOOL);

    await registry.call('ping', { time: 5 }, { via: 'testing' });

    expect(deps.pushActivity).toHaveBeenCalledWith(expect.objectContaining({ name: 'ping', args: { time: 5 }, via: 'testing', status: 'running' }));
    expect(deps.activity).toHaveLength(1);
    expect(deps.activity[0]).toMatchObject({ status: 'done', result: { ok: true, summary: 'pong 5' } });
    expect(deps.activity[0]?.endedAt).toBeGreaterThanOrEqual(deps.activity[0]?.startedAt ?? 0);
  });

  it('call() marks the Activity entry status:"error" when the handler throws', async () => {
    const deps = fakeDeps();
    const registry = createRegistry(deps);
    registry.define({
      ...PING_TOOL,
      handler: () => {
        throw new Error('kaboom');
      },
    });

    await registry.call('ping', { time: 1 });
    expect(deps.activity[0]).toMatchObject({ status: 'error' });
    expect(deps.activity[0]?.error).toContain('kaboom');
  });

  describe('job-mode tools', () => {
    function defineSlowTool(registry: ReturnType<typeof createRegistry>, delayMs: number): void {
      registry.define({
        name: 'slow_job',
        description: 'Takes a while.',
        inputSchema: { type: 'object', properties: {} },
        group: 'export',
        when: 'always',
        mode: 'job',
        handler: async (_args, ctx) => {
          await sleep(delayMs);
          return { ok: true, summary: 'finished', aborted: ctx.signal.aborted };
        },
      });
    }

    it('returns the real result inline when it finishes within waitSeconds', async () => {
      const registry = createRegistry(fakeDeps());
      defineSlowTool(registry, 30);
      const result = await registry.call('slow_job', { waitSeconds: 0.3 });
      expect(result).toMatchObject({ ok: true, summary: 'finished' });
    });

    it('returns a running envelope with a jobId when it does not finish within waitSeconds', async () => {
      const registry = createRegistry(fakeDeps());
      defineSlowTool(registry, 200);
      const result = await registry.call('slow_job', { waitSeconds: 0.03 });
      expect(result).toMatchObject({ ok: true, status: 'running' });
      expect(typeof (result as { jobId?: string }).jobId).toBe('string');
    });

    it('deduplicates concurrent calls sharing a requestId onto the same job', async () => {
      const registry = createRegistry(fakeDeps());
      defineSlowTool(registry, 200);
      const [first, second] = await Promise.all([
        registry.call('slow_job', { waitSeconds: 0.03, requestId: 'dup-1' }),
        registry.call('slow_job', { waitSeconds: 0.03, requestId: 'dup-1' }),
      ]);
      expect((first as { jobId?: string }).jobId).toBe((second as { jobId?: string }).jobId);
    });

    it('cancel_job aborts the handler signal and get_job reports status:"cancelled"', async () => {
      const registry = createRegistry(fakeDeps());
      defineSlowTool(registry, 100);
      registry.define({
        name: 'get_job',
        description: 'Reports a job.',
        inputSchema: { type: 'object', properties: { jobId: { type: 'string' } }, required: ['jobId'] },
        group: 'session',
        when: 'always',
        handler: (args: { jobId: string }): ToolResult => {
          const job = registry.jobs.get(args.jobId);
          if (!job) return { ok: false, error: 'unknown_job' };
          return { ok: true, summary: job.status, status: job.status };
        },
      });
      registry.define({
        name: 'cancel_job',
        description: 'Cancels a job.',
        inputSchema: { type: 'object', properties: { jobId: { type: 'string' } }, required: ['jobId'] },
        group: 'session',
        when: 'always',
        handler: (args: { jobId: string }): ToolResult => {
          const cancelled = registry.jobs.cancel(args.jobId);
          return cancelled ? { ok: true, summary: 'cancelled' } : { ok: false, error: 'could not cancel' };
        },
      });

      const started = await registry.call('slow_job', { waitSeconds: 0.01 });
      const jobId = (started as unknown as { jobId: string }).jobId;

      const cancelResult = await registry.call('cancel_job', { jobId });
      expect(cancelResult).toMatchObject({ ok: true });

      const jobResult = await registry.call('get_job', { jobId });
      expect(jobResult).toMatchObject({ ok: true, status: 'cancelled' });

      await sleep(150); // let the handler's own sleep(100) elapse so we can check it observed the abort
      expect(registry.jobs.get(jobId)?.status).toBe('cancelled'); // not resurrected by the handler's resolution
    });
  });
});

describe('buildManifest (Task 11: the server\'s serializable view of the registry)', () => {
  it('strips handler and keeps every other field a manifest tool needs', () => {
    const manifest = buildManifest([PING_TOOL]);
    expect(manifest).toEqual([
      {
        name: 'ping',
        description: 'Echoes back the given time.',
        inputSchema: PING_TOOL.inputSchema,
        annotations: PING_TOOL.annotations,
        group: 'session',
        when: 'always',
        mode: undefined,
      },
    ]);
    expect(manifest[0]).not.toHaveProperty('handler');
  });

  it('round-trips through JSON.stringify with no loss (server reads it back from a plain .json file)', () => {
    const manifest = buildManifest([PING_TOOL]);
    expect(JSON.parse(JSON.stringify(manifest))).toEqual(manifest);
  });
});
