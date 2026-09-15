/**
 * A ~120-line JSON Schema (draft-07-ish) validator covering exactly what the tool manifest's
 * inputSchemas need: type, required, enum, minimum/maximum, items, properties. No dependency
 * (ajv et al. are 20-100x this file for features none of our schemas use) -- see the plan's
 * Global Constraints on the tool registry's validator.
 */

export interface JSONSchema {
  type?: JSONSchemaType | JSONSchemaType[];
  enum?: readonly unknown[];
  minimum?: number;
  maximum?: number;
  items?: JSONSchema;
  properties?: Record<string, JSONSchema>;
  required?: readonly string[];
  [key: string]: unknown;
}

export type JSONSchemaType = 'string' | 'number' | 'integer' | 'boolean' | 'array' | 'object' | 'null';

export type ValidationResult = { valid: true } | { valid: false; path: string; message: string };

function typeOfValue(value: unknown): JSONSchemaType | 'undefined' {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  if (typeof value === 'number') return 'number';
  if (typeof value === 'string') return 'string';
  if (typeof value === 'boolean') return 'boolean';
  if (typeof value === 'object') return 'object';
  return 'undefined';
}

function matchesType(schemaType: JSONSchemaType, value: unknown): boolean {
  if (schemaType === 'integer') return typeof value === 'number' && Number.isInteger(value);
  return typeOfValue(value) === schemaType;
}

function describeTypes(types: JSONSchemaType[]): string {
  return types.length === 1 ? types[0]! : types.join(' | ');
}

/** Validates `value` against `schema`, returning the first violation found (depth-first,
 * property/index declaration order) with a JSON-path-like `path` (`$`, `$.foo`, `$.foo[2].bar`)
 * pinpointing exactly where it failed -- callers (the tool registry) surface this directly to
 * the calling agent so a malformed call is fixable without guessing. */
export function validate(schema: JSONSchema, value: unknown, path = '$'): ValidationResult {
  if (schema.type !== undefined) {
    const types = Array.isArray(schema.type) ? schema.type : [schema.type];
    if (!types.some((t) => matchesType(t, value))) {
      return { valid: false, path, message: `expected ${describeTypes(types)}, got ${typeOfValue(value)}` };
    }
  }

  if (schema.enum !== undefined && !schema.enum.includes(value)) {
    return { valid: false, path, message: `expected one of ${JSON.stringify(schema.enum)}, got ${JSON.stringify(value)}` };
  }

  if (typeof value === 'number') {
    if (schema.minimum !== undefined && value < schema.minimum) {
      return { valid: false, path, message: `must be >= ${schema.minimum}, got ${value}` };
    }
    if (schema.maximum !== undefined && value > schema.maximum) {
      return { valid: false, path, message: `must be <= ${schema.maximum}, got ${value}` };
    }
  }

  if (Array.isArray(value) && schema.items) {
    for (let i = 0; i < value.length; i++) {
      const result = validate(schema.items, value[i], `${path}[${i}]`);
      if (!result.valid) return result;
    }
  }

  if (schema.properties && typeOfValue(value) === 'object') {
    const obj = value as Record<string, unknown>;
    for (const key of schema.required ?? []) {
      if (!(key in obj)) {
        return { valid: false, path, message: `missing required property "${key}"` };
      }
    }
    for (const [key, propSchema] of Object.entries(schema.properties)) {
      if (!(key in obj)) continue; // optional and absent -- nothing to check
      const result = validate(propSchema, obj[key], `${path}.${key}`);
      if (!result.valid) return result;
    }
  }

  return { valid: true };
}
