/**
 * Job protocol (Global Constraints): long-running tools run through here so a call that cannot
 * finish within its waitSeconds returns {ok:true, jobId, status:'running'} instead of hanging or
 * timing out the caller, and a retried call with the same requestId returns the existing job
 * instead of starting duplicate work (agents retry timed-out calls -- see the plan's Risks
 * table). This module is tool-agnostic: the registry decides waitSeconds/inline-vs-async
 * behavior and wraps handler results into the {ok,...} envelope; jobs.ts only tracks lifecycle.
 */

export type JobStatus = 'running' | 'done' | 'failed' | 'cancelled';

export interface Job {
  jobId: string;
  tool: string;
  requestId?: string;
  status: JobStatus;
  /** 0-1. */
  progress: number;
  message?: string;
  startedAt: number;
  endedAt?: number;
  result?: unknown;
}

export interface JobRunContext {
  signal: AbortSignal;
  progress: (fraction: number, message?: string) => void;
}

export interface StartJobOptions {
  tool: string;
  /** Idempotency key: a repeated start() with the same (tool, requestId) returns the original
   * job's handle instead of running the work again. */
  requestId?: string;
  run: (ctx: JobRunContext) => Promise<unknown>;
}

export interface JobHandle {
  jobId: string;
  /** Resolves with the job's terminal `result`, once `run()` settles (a cancellation does not
   * reject or resolve this differently -- callers read `get(jobId).status` for that). */
  promise: Promise<unknown>;
}

export interface JobsStore {
  start(options: StartJobOptions): JobHandle;
  get(jobId: string): Job | undefined;
  list(): Job[];
  /** Aborts the running handler's signal and marks the job cancelled immediately. Returns false
   * for an unknown job or one that already reached a terminal status. */
  cancel(jobId: string): boolean;
}

let jobCounter = 0;
function nextJobId(): string {
  jobCounter += 1;
  return `job-${Date.now().toString(36)}-${jobCounter}`;
}

export function createJobsStore(): JobsStore {
  const jobs = new Map<string, Job>();
  const controllers = new Map<string, AbortController>();
  const handles = new Map<string, JobHandle>();
  /** requestId -> jobId, so a retried call finds the same job regardless of the job's current
   * status (a completed job's requestId still answers "what happened to that call?"). */
  const requestIndex = new Map<string, string>();

  function start(options: StartJobOptions): JobHandle {
    const dedupeKey = options.requestId ? `${options.tool}:${options.requestId}` : undefined;
    if (dedupeKey) {
      const existingJobId = requestIndex.get(dedupeKey);
      if (existingJobId) {
        const existingHandle = handles.get(existingJobId);
        if (existingHandle) return existingHandle;
      }
    }

    const jobId = nextJobId();
    const controller = new AbortController();
    const job: Job = {
      jobId,
      tool: options.tool,
      requestId: options.requestId,
      status: 'running',
      progress: 0,
      startedAt: Date.now(),
    };
    jobs.set(jobId, job);
    controllers.set(jobId, controller);
    if (dedupeKey) requestIndex.set(dedupeKey, jobId);

    const ctx: JobRunContext = {
      signal: controller.signal,
      progress: (fraction, message) => {
        const current = jobs.get(jobId);
        if (!current || current.status !== 'running') return;
        current.progress = fraction;
        if (message !== undefined) current.message = message;
      },
    };

    const promise = options
      .run(ctx)
      .then((result) => {
        const current = jobs.get(jobId);
        // cancel() already finalized this job -- its own (ignored) resolution must not resurrect it.
        if (!current || current.status !== 'running') return result;
        current.status = 'done';
        current.result = result;
        current.endedAt = Date.now();
        return result;
      })
      .catch((error: unknown) => {
        const current = jobs.get(jobId);
        if (!current || current.status !== 'running') return undefined;
        const message = error instanceof Error ? error.message : String(error);
        current.status = 'failed';
        current.result = { ok: false, error: `job_failed: ${message}` };
        current.endedAt = Date.now();
        return current.result;
      });

    const handle: JobHandle = { jobId, promise };
    handles.set(jobId, handle);
    return handle;
  }

  function get(jobId: string): Job | undefined {
    return jobs.get(jobId);
  }

  function list(): Job[] {
    return Array.from(jobs.values());
  }

  function cancel(jobId: string): boolean {
    const job = jobs.get(jobId);
    if (!job || job.status !== 'running') return false;
    controllers.get(jobId)?.abort();
    job.status = 'cancelled';
    job.endedAt = Date.now();
    return true;
  }

  return { start, get, list, cancel };
}
