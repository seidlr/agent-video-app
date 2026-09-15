import type { ToolCall } from '../lib/types';
import { createJobsStore, type JobsStore } from './jobs';
import { validate, type JSONSchema } from './validate';

/**
 * The typed tool registry every transport (WebMCP, the scripting bridge, the testing shim, the
 * MCP server) mounts from. One registry.call() implementation gives all of them identical
 * validation, error handling, job semantics and Activity logging -- see the plan's Global
 * Constraints on the tool contract and Task 4's own key decisions.
 */

export type ToolGroup =
  | 'session'
  | 'models'
  | 'library'
  | 'playback'
  | 'frames'
  | 'vision'
  | 'vlm'
  | 'audio'
  | 'effects'
  | 'boxes'
  | 'notes'
  | 'chapters'
  | 'transcript'
  | 'clips'
  | 'export';

/** `always` tools register on load; `local` tools only while a decodable local/URL source is
 * loaded (not YouTube); `yt` marks a YouTube-safe subset of an otherwise-local group;
 * `after-transcribe` tools need a transcript to already exist. */
export type ToolWhen = 'always' | 'local' | 'yt' | 'after-transcribe';

export interface ToolAnnotations {
  readOnlyHint?: boolean;
  untrustedContentHint?: boolean;
  consequentialHint?: boolean;
}

export interface ToolOkResult {
  ok: true;
  summary: string;
  [key: string]: unknown;
}
export interface ToolErrResult {
  ok: false;
  error: string;
  hint?: string;
}
export type ToolResult = ToolOkResult | ToolErrResult;

export interface ToolCallContext {
  signal: AbortSignal;
  progress: (fraction: number, message?: string) => void;
}

export interface ToolDefinition<TArgs extends Record<string, unknown> = Record<string, unknown>> {
  name: string;
  description: string;
  /** Draft-07-ish JSON Schema for TArgs; validated by ./validate before the handler ever runs. */
  inputSchema: JSONSchema;
  annotations?: ToolAnnotations;
  group: ToolGroup;
  when: ToolWhen;
  /** Job-mode tools accept the universal wait?/waitSeconds?/requestId? envelope fields on top of
   * their own inputSchema (Global Constraints) -- the registry strips those before validating
   * and before calling the handler, so inputSchema only ever describes the tool's own args. */
  mode?: 'job';
  handler: (args: TArgs, ctx: ToolCallContext) => Promise<ToolResult> | ToolResult;
}

export interface CallOptions {
  via?: ToolCall['via'];
}

export interface RegistryDeps {
  pushActivity(call: Omit<ToolCall, 'endedAt' | 'result' | 'error'>): void;
  updateActivity(id: string, patch: Partial<ToolCall>): void;
  /** Injectable for tests; production wiring lets the registry create its own. */
  jobs?: JobsStore;
}

export interface Registry {
  define<TArgs extends Record<string, unknown>>(tool: ToolDefinition<TArgs>): void;
  list(filter?: { when?: ToolWhen[] }): ToolDefinition[];
  get(name: string): ToolDefinition | undefined;
  /** Never throws (Global Constraints) -- every failure, including a handler that throws, comes
   * back as {ok:false, error, hint?}. */
  call(name: string, rawArgs?: unknown, options?: CallOptions): Promise<ToolResult>;
  jobs: JobsStore;
}

const DEFAULT_WAIT_SECONDS = 20;
const MAX_WAIT_SECONDS = 55;

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

let callCounter = 0;
function nextCallId(): string {
  callCounter += 1;
  return `call-${Date.now().toString(36)}-${callCounter}`;
}

export function createRegistry(deps: RegistryDeps): Registry {
  // Heterogeneous storage: each tool's own TArgs is only known at its call site (registry.call
  // validates against the schema at runtime instead), so type erasure here is the type-safe
  // alternative to `unknown` casts scattered through every call site below.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const tools = new Map<string, ToolDefinition<any>>();
  const jobs = deps.jobs ?? createJobsStore();

  function define<TArgs extends Record<string, unknown>>(tool: ToolDefinition<TArgs>): void {
    if (tools.has(tool.name)) {
      throw new Error(`registry: a tool named "${tool.name}" is already defined`);
    }
    tools.set(tool.name, tool);
  }

  function list(filter?: { when?: ToolWhen[] }): ToolDefinition[] {
    const all = Array.from(tools.values());
    if (!filter?.when) return all;
    return all.filter((t) => filter.when!.includes(t.when));
  }

  function get(name: string): ToolDefinition | undefined {
    return tools.get(name);
  }

  /** Runs a non-job tool: validate -> Activity(running) -> handler -> Activity(done|error). */
  async function callDirect(tool: ToolDefinition<never>, args: Record<string, unknown>, via: ToolCall['via']): Promise<ToolResult> {
    const id = nextCallId();
    const startedAt = Date.now();
    deps.pushActivity({ id, name: tool.name, args, via, status: 'running', startedAt });

    const controller = new AbortController();
    try {
      const result = await tool.handler(args as never, { signal: controller.signal, progress: () => undefined });
      deps.updateActivity(id, { status: 'done', endedAt: Date.now(), result });
      return result;
    } catch (error) {
      const result: ToolErrResult = { ok: false, error: `tool_threw: ${errorMessage(error)}` };
      deps.updateActivity(id, { status: 'error', endedAt: Date.now(), error: result.error, result });
      return result;
    }
  }

  /** Runs a job-mode tool through jobs.ts: strips the universal wait/waitSeconds/requestId
   * envelope fields, starts the job, and either returns its real result inline (finished within
   * waitSeconds) or a {status:'running', jobId} envelope (Global Constraints' job protocol). */
  async function callJob(tool: ToolDefinition<never>, rawArgs: Record<string, unknown>, via: ToolCall['via']): Promise<ToolResult> {
    const { wait, waitSeconds, requestId, ...domainArgs } = rawArgs;
    const validation = validate(tool.inputSchema, domainArgs);
    if (!validation.valid) {
      return { ok: false, error: 'invalid_args', hint: `${validation.path}: ${validation.message}` };
    }

    const id = nextCallId();
    const startedAt = Date.now();
    deps.pushActivity({ id, name: tool.name, args: domainArgs, via, status: 'running', startedAt });

    const clampedWaitSeconds = Math.min(
      MAX_WAIT_SECONDS,
      Math.max(0, typeof waitSeconds === 'number' ? waitSeconds : DEFAULT_WAIT_SECONDS),
    );
    const { jobId, promise } = jobs.start({
      tool: tool.name,
      requestId: typeof requestId === 'string' ? requestId : undefined,
      run: (ctx) => Promise.resolve(tool.handler(domainArgs as never, ctx)),
    });

    if (wait === false) {
      const running: ToolOkResult = { ok: true, jobId, status: 'running', summary: `Started; call get_job({jobId:"${jobId}"}).` };
      deps.updateActivity(id, { status: 'done', endedAt: Date.now(), result: running });
      return running;
    }

    const winner = await Promise.race([
      promise.then((result) => ({ settled: true as const, result: result as ToolResult })),
      sleep(clampedWaitSeconds * 1000).then(() => ({ settled: false as const })),
    ]);

    if (winner.settled) {
      deps.updateActivity(id, { status: 'done', endedAt: Date.now(), result: winner.result });
      return winner.result;
    }

    const running: ToolOkResult = {
      ok: true,
      jobId,
      status: 'running',
      summary: `Still running after ${clampedWaitSeconds}s; call get_job({jobId:"${jobId}"}) or list_jobs({}).`,
    };
    deps.updateActivity(id, { status: 'done', endedAt: Date.now(), result: running });
    return running;
  }

  async function call(name: string, rawArgs?: unknown, options?: CallOptions): Promise<ToolResult> {
    const tool = tools.get(name);
    if (!tool) {
      return { ok: false, error: 'unknown_tool', hint: `no tool named "${name}"; call get_agent_skill({}) or check the tool catalog` };
    }

    const args = rawArgs && typeof rawArgs === 'object' ? (rawArgs as Record<string, unknown>) : {};
    const via = options?.via ?? 'testing';

    if (tool.mode === 'job') {
      return callJob(tool, args, via);
    }

    const validation = validate(tool.inputSchema, args);
    if (!validation.valid) {
      return { ok: false, error: 'invalid_args', hint: `${validation.path}: ${validation.message}` };
    }

    return callDirect(tool, args, via);
  }

  return { define, list, get, call, jobs };
}

/** A tool definition stripped to its serializable fields -- no `handler`, which only exists in the
 * browser instance that actually runs it. This is what `scripts/build-server-manifest.ts` writes
 * to `server/generated/tool-manifest.json` (Task 11): the MCP server registers one passthrough
 * "data tool" per manifest entry, whose own handler forwards the call to the bus rather than
 * running any of this app's real logic itself. */
export interface ManifestTool {
  name: string;
  description: string;
  inputSchema: JSONSchema;
  annotations?: ToolAnnotations;
  group: ToolGroup;
  when: ToolWhen;
  mode?: 'job';
}

// ToolDefinition<any>, matching `createRegistry`'s own internal storage type just above: a plain
// ToolDefinition[] (defaulting TArgs to Record<string, unknown>) can't structurally accept an array
// mixing different concrete TArgs (e.g. one tool typed ToolDefinition<{time: number}>) because a
// handler's argument type is contravariant -- `any` is this file's own established escape hatch
// for "heterogeneous tool definitions", not a loosening introduced here.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function buildManifest(tools: ToolDefinition<any>[]): ManifestTool[] {
  return tools.map((t) => ({ name: t.name, description: t.description, inputSchema: t.inputSchema, annotations: t.annotations, group: t.group, when: t.when, mode: t.mode }));
}
