import { describe, expect, it, vi } from 'vitest';
import { createJobsStore } from '../../src/agent/jobs';

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

describe('createJobsStore', () => {
  it('start() records a running job and list()/get() see it immediately', () => {
    const jobs = createJobsStore();
    const { jobId } = jobs.start({ tool: 'export_video', run: async () => ({ ok: true, summary: 'done' }) });

    const job = jobs.get(jobId);
    expect(job).toMatchObject({ jobId, tool: 'export_video', status: 'running', progress: 0 });
    expect(jobs.list().map((j) => j.jobId)).toContain(jobId);
  });

  it('marks the job done with its result once run() resolves', async () => {
    const jobs = createJobsStore();
    const { jobId, promise } = jobs.start({ tool: 'export_video', run: async () => ({ ok: true, summary: 'done' }) });
    await promise;

    const job = jobs.get(jobId);
    expect(job).toMatchObject({ status: 'done', result: { ok: true, summary: 'done' } });
    expect(job?.endedAt).toBeGreaterThanOrEqual(job?.startedAt ?? 0);
  });

  it('marks the job failed with a JSON-safe error result if run() rejects', async () => {
    const jobs = createJobsStore();
    const { jobId, promise } = jobs.start({
      tool: 'export_video',
      run: async () => {
        throw new Error('boom');
      },
    });
    await promise;

    const job = jobs.get(jobId);
    expect(job?.status).toBe('failed');
    expect(job?.result).toMatchObject({ ok: false, error: expect.stringContaining('boom') });
  });

  it('reports progress updates through ctx.progress', async () => {
    const jobs = createJobsStore();
    const { jobId, promise } = jobs.start({
      tool: 'export_video',
      run: async (ctx) => {
        ctx.progress(0.5, 'halfway');
        return { ok: true, summary: 'done' };
      },
    });
    // progress() applies synchronously inside run(), but run() itself is scheduled -- wait a tick.
    await Promise.resolve();
    await Promise.resolve();
    expect(jobs.get(jobId)?.progress).toBe(0.5);
    expect(jobs.get(jobId)?.message).toBe('halfway');
    await promise;
  });

  it('deduplicates a repeated start() with the same requestId, returning the original job', () => {
    const jobs = createJobsStore();
    const run = vi.fn(async () => ({ ok: true, summary: 'done' }));
    const first = jobs.start({ tool: 'export_video', requestId: 'req-1', run });
    const second = jobs.start({ tool: 'export_video', requestId: 'req-1', run });

    expect(second.jobId).toBe(first.jobId);
    expect(run).toHaveBeenCalledTimes(1);
  });

  it('does not deduplicate calls with different requestIds', () => {
    const jobs = createJobsStore();
    const run = vi.fn(async () => ({ ok: true, summary: 'done' }));
    const first = jobs.start({ tool: 'export_video', requestId: 'req-1', run });
    const second = jobs.start({ tool: 'export_video', requestId: 'req-2', run });

    expect(second.jobId).not.toBe(first.jobId);
    expect(run).toHaveBeenCalledTimes(2);
  });

  it('cancel() aborts the handler signal and flips status to cancelled immediately', async () => {
    const jobs = createJobsStore();
    let sawAborted = false;
    const { jobId, promise } = jobs.start({
      tool: 'export_video',
      run: async (ctx) => {
        await sleep(50);
        sawAborted = ctx.signal.aborted;
        return { ok: true, summary: 'done' };
      },
    });

    const cancelled = jobs.cancel(jobId);
    expect(cancelled).toBe(true);
    expect(jobs.get(jobId)?.status).toBe('cancelled');

    await promise; // let the handler observe the abort and finish its own control flow
    expect(sawAborted).toBe(true);
    // A cancellation must not be overwritten by the handler's eventual (ignored) resolution.
    expect(jobs.get(jobId)?.status).toBe('cancelled');
  });

  it('cancel() returns false for an unknown or already-terminal job', async () => {
    const jobs = createJobsStore();
    expect(jobs.cancel('nope')).toBe(false);

    const { jobId, promise } = jobs.start({ tool: 'export_video', run: async () => ({ ok: true, summary: 'done' }) });
    await promise;
    expect(jobs.cancel(jobId)).toBe(false);
  });
});
