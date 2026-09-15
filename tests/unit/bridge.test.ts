import { afterEach, describe, expect, it, vi } from 'vitest';
import { createRegistry, type ToolResult } from '../../src/agent/registry';
import { createBridge, publishAgentToolsElement } from '../../src/agent/bridge';

function fakeDeps() {
  return { pushActivity: vi.fn(), updateActivity: vi.fn() };
}

function defineExampleTool(registry: ReturnType<typeof createRegistry>): void {
  registry.define<{ n: number }>({
    name: 'double',
    description: 'Doubles a number.',
    inputSchema: { type: 'object', properties: { n: { type: 'number' } }, required: ['n'] },
    group: 'session',
    when: 'always',
    handler: (args): ToolResult => ({ ok: true, summary: String(args.n * 2), value: args.n * 2 }),
  });
}

describe('createBridge', () => {
  it('listTools() returns every registered tool as a plain descriptor', () => {
    const registry = createRegistry(fakeDeps());
    defineExampleTool(registry);
    const bridge = createBridge(registry);

    expect(bridge.listTools()).toEqual([
      { name: 'double', description: 'Doubles a number.', inputSchema: { type: 'object', properties: { n: { type: 'number' } }, required: ['n'] }, group: 'session', when: 'always', annotations: undefined },
    ]);
  });

  it('describe() returns null for an unknown tool', () => {
    const registry = createRegistry(fakeDeps());
    const bridge = createBridge(registry);
    expect(bridge.describe('nope')).toBeNull();
  });

  it('call() delegates to registry.call with via:"bridge"', async () => {
    const registry = createRegistry(fakeDeps());
    defineExampleTool(registry);
    const bridge = createBridge(registry);

    const result = await bridge.call('double', { n: 21 });
    expect(result).toEqual({ ok: true, summary: '42', value: 42 });
  });

  it('state() calls get_state through the registry', async () => {
    const registry = createRegistry(fakeDeps());
    registry.define({
      name: 'get_state',
      description: 'State.',
      inputSchema: { type: 'object', properties: {} },
      group: 'session',
      when: 'always',
      handler: (): ToolResult => ({ ok: true, summary: 'idle' }),
    });
    const bridge = createBridge(registry);
    expect(await bridge.state()).toEqual({ ok: true, summary: 'idle' });
  });
});

describe('publishAgentToolsElement', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('fills #agent-tools with the JSON tool catalog when the element exists', () => {
    const el = { textContent: '' };
    vi.stubGlobal('document', { getElementById: (id: string) => (id === 'agent-tools' ? el : null) });

    const registry = createRegistry(fakeDeps());
    defineExampleTool(registry);
    publishAgentToolsElement(registry);

    const published = JSON.parse(el.textContent) as { tools: { name: string }[] };
    expect(published.tools.map((t) => t.name)).toEqual(['double']);
  });

  it('does nothing when document is undefined (non-DOM environment)', () => {
    const registry = createRegistry(fakeDeps());
    expect(() => publishAgentToolsElement(registry)).not.toThrow();
  });
});
