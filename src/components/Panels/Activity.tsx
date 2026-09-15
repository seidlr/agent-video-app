import type { ReactElement } from 'react';
import { useStudio } from '../../store/studio';
import { ToolCallCard } from '../Activity/ToolCallCard';

/** Live feed of every tool call any transport made, most recent first (Task 4). */
export function Activity(): ReactElement {
  const activity = useStudio((s) => s.activity);

  if (activity.length === 0) {
    return (
      <p className="text-[13px] text-ink-3">
        No agent activity yet. Connect an agent (WebMCP, the scripting bridge, or an MCP host) and it will show up here as it calls tools.
      </p>
    );
  }

  const mostRecentFirst = [...activity].reverse();

  return (
    <div className="flex flex-col gap-1.5">
      {mostRecentFirst.map((call) => (
        <ToolCallCard key={call.id} call={call} />
      ))}
    </div>
  );
}
