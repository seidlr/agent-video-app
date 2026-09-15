import type { Registry, ToolDefinition, ToolResult } from './registry';

export interface AgentToolDescriptor {
  name: string;
  description: string;
  inputSchema: object;
  group: ToolDefinition['group'];
  when: ToolDefinition['when'];
  annotations?: ToolDefinition['annotations'];
}

/**
 * `window.agentVideo`: a plain JSON-in/JSON-out scripting surface for agents that drive the page
 * via arbitrary JS execution (Claude in Chrome / Claude Desktop's browser via `javascript_tool`)
 * rather than a WebMCP-aware host. Same registry as every other transport, so results and
 * Activity logging are identical regardless of which surface an agent used.
 */
export interface AgentVideoBridge {
  version: string;
  listTools(): AgentToolDescriptor[];
  describe(name: string): AgentToolDescriptor | null;
  call(name: string, args?: unknown): Promise<ToolResult>;
  state(): Promise<ToolResult>;
}

function toDescriptor(tool: ToolDefinition): AgentToolDescriptor {
  return { name: tool.name, description: tool.description, inputSchema: tool.inputSchema as object, group: tool.group, when: tool.when, annotations: tool.annotations };
}

export function createBridge(registry: Registry): AgentVideoBridge {
  return {
    version: '1.0.0',
    listTools: () => registry.list().map(toDescriptor),
    describe: (name) => {
      const tool = registry.get(name);
      return tool ? toDescriptor(tool) : null;
    },
    call: (name, args) => registry.call(name, args, { via: 'bridge' }),
    state: () => registry.call('get_state', {}, { via: 'bridge' }),
  };
}

/** Fills `<script type="application/json" id="agent-tools">` with the current tool catalog, so a
 * host that only reads the page's static HTML (no JS execution) can still discover the tools --
 * e.g. an agent that fetches the page source before deciding whether/how to interact with it. */
export function publishAgentToolsElement(registry: Registry): void {
  if (typeof document === 'undefined') return;
  const el = document.getElementById('agent-tools');
  if (!el) return;
  el.textContent = JSON.stringify({ tools: registry.list().map(toDescriptor) });
}

/** Mounts `window.agentVideo` and publishes the initial `#agent-tools` catalog snapshot. Unlike
 * WebMCP's `getTools()`, this element has no live-update signal for a non-JS-executing reader, so
 * it always lists every tool regardless of the currently loaded source's local/yt eligibility. */
export function mountBridge(registry: Registry): AgentVideoBridge {
  const bridge = createBridge(registry);
  if (typeof window !== 'undefined') {
    (window as unknown as { agentVideo: AgentVideoBridge }).agentVideo = bridge;
  }
  publishAgentToolsElement(registry);
  return bridge;
}
