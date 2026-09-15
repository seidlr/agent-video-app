import { Router } from 'express';
import type { CommandBus } from './bus.js';

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

  router.post('/bus/poll', (req, res) => {
    const { instanceId } = req.body as { instanceId?: string };
    if (!instanceId) {
      res.status(400).json({ ok: false, error: 'missing_instance_id' });
      return;
    }
    res.json(bus.pollCommands(sessionId, instanceId));
  });

  router.post('/bus/result', (req, res) => {
    const { instanceId, cmdId, result } = req.body as { instanceId?: string; cmdId?: string; result?: Record<string, unknown> };
    if (!instanceId || !cmdId || !result) {
      res.status(400).json({ ok: false, error: 'missing_fields' });
      return;
    }
    bus.postResult(sessionId, instanceId, cmdId, result);
    res.json({ ok: true });
  });

  return router;
}
