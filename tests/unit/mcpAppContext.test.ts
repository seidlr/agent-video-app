import { afterEach, describe, expect, it, vi } from 'vitest';
import { isMcpAppContext } from '../../src/agent/mcpApp';

/** A minimal `window`: which origin the page is on, its query string, and whether it is framed. */
function stubWindow({ origin, search = '', framed = false }: { origin: string; search?: string; framed?: boolean }): void {
  const self = { location: { origin, search } } as Record<string, unknown>;
  self.self = self;
  self.top = framed ? {} : self;
  vi.stubGlobal('window', self);
}

describe('isMcpAppContext', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('a normal top-level tab of the site is not an MCP App view', () => {
    stubWindow({ origin: 'https://seidlr.github.io' });
    expect(isMcpAppContext()).toBe(false);
  });

  it('an opaque-origin sandbox (srcdoc / sandboxed iframe) is', () => {
    stubWindow({ origin: 'null', framed: true });
    expect(isMcpAppContext()).toBe(true);
  });

  it('?mcp=1 forces it', () => {
    stubWindow({ origin: 'http://localhost:3000', search: '?mcp=1' });
    expect(isMcpAppContext()).toBe(true);
  });

  // Hosts may serve the view from a real sandbox origin rather than an opaque one (the MCP Apps
  // spec's `domain`, e.g. `{hash}.claudemcpcontent.com`); origin 'null' alone missed those and the
  // studio booted as a plain site that never talked to the host.
  it('a page framed on a real origin is, too', () => {
    stubWindow({ origin: 'https://0123456789abcdef.claudemcpcontent.com', framed: true });
    expect(isMcpAppContext()).toBe(true);
  });
});
