import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import { createAgentRegistry } from '../../src/agent';
import { createStudioStore } from '../../src/store/studio';
import { validate } from '../../src/agent/validate';

const EXPECTED_TOOL_NAMES = [
  'get_state',
  'get_agent_skill',
  'get_job',
  'list_jobs',
  'cancel_job',
  'say',
  'set_view',
  'list_library',
  'load_video',
  'request_file_upload',
  'remove_video',
  'play',
  'pause',
  'toggle_play',
  'seek',
  'step_frames',
  'set_playback',
  'capture_frame',
  'list_frames',
  'delete_frame',
  'generate_thumbnails',
  'add_note',
  'list_notes',
  'update_note',
  'delete_note',
  'add_chapter',
  'list_chapters',
  'update_chapter',
  'delete_chapter',
  'import_vtt',
  'list_boxes',
  'add_box',
  'update_box',
  'delete_box',
  'clear_boxes',
  'export_notes',
  'list_models',
  'load_model',
  'unload_model',
  'segment',
  'track',
  'detect_scenes',
  'find_similar_frames',
];

describe('createAgentRegistry (Task 4/5/6/7/8 DoD: registry.test.ts)', () => {
  it('registers exactly the session/library/playback/frames/notes/chapters/boxes/export/models/vision tools defined so far', () => {
    const registry = createAgentRegistry(createStudioStore());
    expect(registry.list().map((t) => t.name).sort()).toEqual([...EXPECTED_TOOL_NAMES].sort());
  });

  it('every registered tool has a non-empty name/description, a valid object-or-empty inputSchema, and a unique name', () => {
    const registry = createAgentRegistry(createStudioStore());
    const tools = registry.list();
    const seenNames = new Set<string>();

    for (const tool of tools) {
      expect(tool.name.length).toBeGreaterThan(0);
      expect(tool.description.length).toBeGreaterThan(0);
      expect(seenNames.has(tool.name)).toBe(false);
      seenNames.add(tool.name);

      // A schema that only ever describes an object at its root, matching every WebMCP host's
      // input contract (a single JSON object of named arguments).
      expect(validate(tool.inputSchema, {})).toEqual(
        tool.inputSchema.required && tool.inputSchema.required.length > 0 ? expect.objectContaining({ valid: false }) : { valid: true },
      );
    }
  });
});
