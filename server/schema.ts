import type { JSONSchema } from '../src/agent/validate.js';
import { validate } from '../src/agent/validate.js';

/**
 * Wraps this app's own JSON Schema (the exact shape every `ManifestTool.inputSchema` already is)
 * in the Standard Schema V1 interface `@modelcontextprotocol/server`'s `registerTool` requires
 * (confirmed live: a plain JSON-Schema object is rejected outright -- "must be a Standard Schema
 * ... or a raw Zod shape"). Reuses this app's own `validate()` (already used by every other
 * transport) for `~standard.validate` rather than converting to zod, and returns the manifest's
 * own schema verbatim for `~standard.jsonSchema` -- confirmed live that this produces the exact
 * same wire-format `inputSchema` in `tools/list` as the source JSON Schema, byte for byte.
 */
export interface StandardSchemaWithJSON {
  readonly '~standard': {
    readonly version: 1;
    readonly vendor: string;
    readonly validate: (value: unknown) => { value: unknown } | { issues: { message: string }[] };
    readonly jsonSchema: {
      readonly input: () => Record<string, unknown>;
      readonly output: () => Record<string, unknown>;
    };
  };
}

export function jsonSchemaAsStandardSchema(schema: JSONSchema): StandardSchemaWithJSON {
  return {
    '~standard': {
      version: 1,
      vendor: 'agent-video-studio',
      validate: (value: unknown) => {
        const result = validate(schema, value);
        if (result.valid) return { value };
        return { issues: [{ message: `${result.path}: ${result.message}` }] };
      },
      jsonSchema: {
        input: () => schema as unknown as Record<string, unknown>,
        output: () => schema as unknown as Record<string, unknown>,
      },
    },
  };
}
