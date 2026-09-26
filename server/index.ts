import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getUiCapability, registerAppResource, registerAppTool, RESOURCE_MIME_TYPE } from '@modelcontextprotocol/ext-apps/server';
import { McpServer, type CallToolResult } from '@modelcontextprotocol/server';
import { z } from 'zod';
import type { ManifestTool } from '../src/agent/registry.js';
import { longPollCommands, type CommandBus, type DispatchResult } from './bus.js';
import { connectDomains, FRAME_DOMAINS, resourceDomains } from './csp.js';
import manifestData from './generated/tool-manifest.json' with { type: 'json' };
import { jsonSchemaAsStandardSchema } from './schema.js';

const manifest = manifestData as ManifestTool[];

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_MCP_APP_HTML_PATH = path.join(__dirname, '..', 'dist', 'mcp-app.html');

/** The built single-file studio: the MCP App resource, and (server/stdio.ts) the page a host
 * without MCP App rendering opens instead. */
export function readBundledAppHtml(): Promise<string> {
  return readFile(DEFAULT_MCP_APP_HTML_PATH, 'utf-8');
}
const RESOURCE_URI = 'ui://agent-video-studio/app.html';

/** `image` (posted separately from `result` -- see `bus.ts`'s own `ImagePayload` doc comment) becomes
 * a real MCP `image` content block alongside the JSON text block, rather than a giant base64
 * string inflating the text (Key Decisions: "`imageBase64` becomes an MCP `image` content block on
 * the awaiting response"). */
function toCallToolResult(result: Record<string, unknown>): CallToolResult {
  const { image, ...rest } = result as { image?: { base64: string; mimeType: string } };
  const content: CallToolResult['content'] = [{ type: 'text', text: JSON.stringify(rest) }];
  if (image) content.push({ type: 'image', data: image.base64, mimeType: image.mimeType });
  return { content, structuredContent: rest };
}

export interface CreateServerOptions {
  /** Reads the built MCP App HTML for the render tool's resource. Overridable so
   * `server/test/server.test.ts` doesn't depend on a real `npm run build` having produced
   * `dist/mcp-app.html` first. */
  readAppHtml?: () => Promise<string>;
  /** A page that can act as this session's UI in any browser tab (the site with `?bus=...`).
   * `open_video_studio` names it so an agent in a host that can't render MCP Apps (a Claude Code
   * session, for one) has somewhere to go instead of queuing commands no UI will run. */
  uiFallbackUrl?: string;
}

/**
 * Builds one MCP server instance bound to a single bus session (`busSessionId`, this server's own
 * concept -- see `server/bus.ts` -- generated once per MCP session at connection time, not the
 * MCP protocol's own session id, which a tool handler's context does not expose: confirmed live
 * against a real `NodeStreamableHTTPServerTransport` connection that the handler's second
 * argument carries no `sessionId` field). `server/http.ts`/`server/stdio.ts` each call this once
 * per session and keep the returned server alive for that session's lifetime.
 */
export function createServer(busSessionId: string, bus: CommandBus, options: CreateServerOptions = {}): McpServer {
  const readAppHtml = options.readAppHtml ?? readBundledAppHtml;
  const server = new McpServer({ name: 'agent-video-studio', version: '0.1.4' });

  // Whether this client said it can render MCP Apps (the `io.modelcontextprotocol/ui` extension).
  // Logged to stderr -- a host's extension log -- because "the studio never appeared" is otherwise
  // indistinguishable between "host can't render apps" and "host tried and failed".
  let clientRendersApps = false;
  server.server.oninitialized = () => {
    const client = server.server.getClientVersion();
    const ui = getUiCapability(server.server.getClientCapabilities());
    clientRendersApps = ui !== undefined;
    console.error(`[agent-video-studio] client ${client?.name ?? 'unknown'} ${client?.version ?? ''}: MCP Apps UI ${ui ? `advertised ${JSON.stringify(ui)}` : 'not advertised'}`);
  };

  registerAppTool(
    server,
    'open_video_studio',
    {
      title: 'Open Agent Video Studio',
      description: 'Renders the Agent Video Studio MCP App and, optionally, loads a video into it: a bundled sample, a video already in your library, a CORS-enabled URL, or a YouTube link. Call this first to get a UI instance, then drive it with every other registered tool.',
      inputSchema: z.object({
        source: z.enum(['sample', 'library', 'url', 'youtube']).optional(),
        id: z.string().optional(),
        url: z.string().optional(),
      }),
      // The tool names its UI and who may call it; everything about how that UI is sandboxed lives
      // on the resource below (MCP Apps spec). No `domain`: the format is host-issued (e.g.
      // `{hash}.claudemcpcontent.com`) and the studio needs no stable origin -- it talks to this
      // server over postMessage, and its CDNs allow any origin.
      _meta: {
        ui: {
          resourceUri: RESOURCE_URI,
          visibility: ['model', 'app'],
        },
      },
    },
    async (args): Promise<CallToolResult> => {
      const instanceId = randomUUID();
      bus.registerInstance(busSessionId, instanceId);
      let text = 'Opened Agent Video Studio.';
      if (options.uiFallbackUrl && !clientRendersApps) {
        text = `This host did not advertise MCP Apps support, so the studio will not render here. Open ${options.uiFallbackUrl} in a browser tab -- that tab becomes the UI for every tool -- then call load_video.`;
      } else if (options.uiFallbackUrl) {
        text += ` If the studio does not appear in this conversation, open ${options.uiFallbackUrl} in a browser tab instead -- that tab becomes the UI for every tool (then call load_video). Don't open it if the studio did appear: it would take over from it.`;
      }
      return {
        content: [{ type: 'text', text }],
        structuredContent: { instanceId, load: args, ...(options.uiFallbackUrl ? { uiUrl: options.uiFallbackUrl } : {}) },
      };
    },
  );

  registerAppResource(server, 'Agent Video Studio', RESOURCE_URI, { mimeType: RESOURCE_MIME_TYPE }, async () => ({
    contents: [
      {
        uri: RESOURCE_URI,
        mimeType: RESOURCE_MIME_TYPE,
        text: await readAppHtml(),
        _meta: {
          ui: {
            csp: { connectDomains: connectDomains(), resourceDomains: resourceDomains(), frameDomains: FRAME_DOMAINS },
            prefersBorder: false,
          },
        },
      },
    ],
  }));

  for (const tool of manifest) {
    if (tool.name === 'get_job') continue; // special-cased below: checked against the bus's own store first.
    server.registerTool(
      tool.name,
      {
        title: tool.name,
        description: tool.description,
        inputSchema: jsonSchemaAsStandardSchema(tool.inputSchema),
        annotations: tool.annotations,
        _meta: { ui: { visibility: ['model'] } },
      },
      async (rawArgs: unknown): Promise<CallToolResult> => {
        const { expectedAssetId, requestId, ...rest } = (rawArgs ?? {}) as { expectedAssetId?: string; requestId?: string };
        const result = await bus.dispatch(busSessionId, { name: tool.name, args: rest, expectedAssetId, requestId });
        return toCallToolResult(result as Record<string, unknown>);
      },
    );
  }

  // get_job is also a normal manifest tool (dispatched to the browser's own registry.jobs store),
  // but a jobId the bus itself minted (a dispatch()'s own cmdId, returned when a command outran
  // the 25s dispatch wait) means nothing to the browser -- check the bus's own store first.
  const getJobTool = manifest.find((t) => t.name === 'get_job')!;
  server.registerTool(
    'get_job',
    {
      title: 'get_job',
      description: getJobTool.description,
      inputSchema: jsonSchemaAsStandardSchema(getJobTool.inputSchema),
      annotations: getJobTool.annotations,
      _meta: { ui: { visibility: ['model'] } },
    },
    async (rawArgs: unknown): Promise<CallToolResult> => {
      const args = rawArgs as { jobId: string };
      const busJob = bus.getJob(busSessionId, args.jobId);
      if (busJob.error !== 'unknown_job') return toCallToolResult(busJob as unknown as Record<string, unknown>);
      const result = await bus.dispatch(busSessionId, { name: 'get_job', args });
      return toCallToolResult(result as Record<string, unknown>);
    },
  );

  server.registerTool(
    'list_instances',
    { title: 'list_instances', description: 'Lists every rendered Agent Video Studio UI instance in this session and which one is active.', inputSchema: z.object({}) },
    async (): Promise<CallToolResult> => toCallToolResult({ ok: true, summary: 'Not tracked separately from the bus session.', instances: [] }),
  );

  server.registerTool(
    'poll_commands',
    {
      title: 'poll_commands',
      description: 'App-only: long-polls (up to 10s) for the next command queued for this UI instance.',
      inputSchema: z.object({ instanceId: z.string() }),
      _meta: { ui: { visibility: ['app'] } },
    },
    async (args: { instanceId: string }): Promise<CallToolResult> => {
      const polled = await longPollCommands(bus, busSessionId, args.instanceId);
      return toCallToolResult(polled as unknown as Record<string, unknown>);
    },
  );

  server.registerTool(
    'post_result',
    {
      title: 'post_result',
      description: 'App-only: posts a dispatched command\'s result back to the server. Pass imageBase64/mimeType alongside result for a tool that produced an image (e.g. capture_frame) -- it becomes a real image content block rather than inflating the JSON result.',
      inputSchema: z.object({
        instanceId: z.string(),
        cmdId: z.string(),
        result: z.record(z.string(), z.unknown()),
        imageBase64: z.string().optional(),
        mimeType: z.string().optional(),
      }),
      _meta: { ui: { visibility: ['app'] } },
    },
    async (args: { instanceId: string; cmdId: string; result: Record<string, unknown>; imageBase64?: string; mimeType?: string }): Promise<CallToolResult> => {
      const image = args.imageBase64 ? { base64: args.imageBase64, mimeType: args.mimeType ?? 'image/png' } : undefined;
      bus.postResult(busSessionId, args.instanceId, args.cmdId, args.result, image);
      return toCallToolResult({ ok: true });
    },
  );

  server.registerTool(
    'activate_instance',
    { title: 'activate_instance', description: 'App-only: reclaims focus for a previously rendered UI instance.', inputSchema: z.object({ instanceId: z.string() }), _meta: { ui: { visibility: ['app'] } } },
    async (args: { instanceId: string }): Promise<CallToolResult> => {
      bus.activateInstance(busSessionId, args.instanceId);
      return toCallToolResult({ ok: true });
    },
  );

  server.registerTool(
    'retire_instance',
    { title: 'retire_instance', description: 'App-only: retires a UI instance on teardown.', inputSchema: z.object({ instanceId: z.string() }), _meta: { ui: { visibility: ['app'] } } },
    async (args: { instanceId: string }): Promise<CallToolResult> => {
      bus.retireInstance(busSessionId, args.instanceId);
      return toCallToolResult({ ok: true });
    },
  );

  return server;
}

export type { DispatchResult };
