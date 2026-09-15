import { Router } from 'express';
import { longPollCommands, type CommandBus } from './bus.js';

/** `/bus/result`'s own body can carry a base64-encoded image (`capture_frame`'s frame) -- Express's
 * default JSON body limit (100kb, confirmed via `createMcpExpressApp`'s own doc comment) rejects a
 * real captured frame outright ("PayloadTooLargeError: request entity too large", confirmed live
 * against a real browser tab posting a real frame). Both `server/http.ts` and `server/stdio.ts`
 * pass this to their own `createMcpExpressApp({ limit })` call. */
export const BUS_JSON_BODY_LIMIT = '10mb';

/**
 * The plain REST half of the command bus (Task 11), for a UI-less MCP client like Codex CLI: its
 * own MCP connection (stdio) has no way to render an iframe, so a normal browser tab of the site
 * (opened separately, `?bus=<this server's BUS_PORT origin>`) registers itself here instead and
 * polls/posts results the same way an MCP App's `poll_commands`/`post_result` tools do -- just
 * over plain HTTP JSON rather than MCP tool calls. Bound to one fixed `sessionId` by the caller
 * (`server/stdio.ts` and `server/http.ts` both use the single-user local-dev-server session,
 * matching "stdio uses one implicit session" -- there is exactly one browser tab a human opens
 * for their own Codex CLI session, not a multi-tenant concern).
 *
 * CORS is the caller's concern (its own `cors()` middleware, restricted to the dev origin and the
 * deployed GitHub Pages origin), not this router's -- a wildcard `Access-Control-Allow-Origin`
 * here would let any origin dispatch tool calls to a running instance and silently override the
 * caller's own restriction, since Express applies middleware in registration order.
 */
export function createBusRouter(bus: CommandBus, sessionId: string): Router {
  const router = Router();

  router.post('/bus/register', (req, res) => {
    const { instanceId, assetId } = req.body as { instanceId?: string; assetId?: string };
    if (!instanceId) {
      res.status(400).json({ ok: false, error: 'missing_instance_id' });
      return;
    }
    bus.registerInstance(sessionId, instanceId, assetId);
    res.json({ ok: true });
  });

  router.post('/bus/poll', async (req, res) => {
    const { instanceId } = req.body as { instanceId?: string };
    if (!instanceId) {
      res.status(400).json({ ok: false, error: 'missing_instance_id' });
      return;
    }
    // Same real long-poll (up to ~10s) as the poll_commands MCP tool -- see longPollCommands's own
    // doc comment on why this is shared rather than a plain non-blocking pollCommands() call.
    res.json(await longPollCommands(bus, sessionId, instanceId));
  });

  router.post('/bus/result', (req, res) => {
    const { instanceId, cmdId, result, imageBase64, mimeType } = req.body as {
      instanceId?: string;
      cmdId?: string;
      result?: Record<string, unknown>;
      imageBase64?: string;
      mimeType?: string;
    };
    if (!instanceId || !cmdId || !result) {
      res.status(400).json({ ok: false, error: 'missing_fields' });
      return;
    }
    const image = imageBase64 ? { base64: imageBase64, mimeType: mimeType ?? 'image/png' } : undefined;
    bus.postResult(sessionId, instanceId, cmdId, result, image);
    res.json({ ok: true });
  });

  return router;
}
