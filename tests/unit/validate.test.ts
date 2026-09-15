import { describe, expect, it } from 'vitest';
import { validate, type JSONSchema } from '../../src/agent/validate';

describe('validate', () => {
  it('accepts a value matching a simple string schema', () => {
    expect(validate({ type: 'string' }, 'hello')).toEqual({ valid: true });
  });

  it('rejects a type mismatch and reports the root path', () => {
    const result = validate({ type: 'string' }, 42);
    expect(result).toMatchObject({ valid: false, path: '$' });
    expect(result.valid).toBe(false);
    if (!result.valid) expect(result.message).toMatch(/string/);
  });

  it('accepts integer and rejects a non-integer number for type:integer', () => {
    expect(validate({ type: 'integer' }, 5)).toEqual({ valid: true });
    const result = validate({ type: 'integer' }, 5.5);
    expect(result.valid).toBe(false);
  });

  it('validates object properties and reports the nested offending path', () => {
    const schema: JSONSchema = {
      type: 'object',
      properties: { time: { type: 'number' }, label: { type: 'string' } },
      required: ['time'],
    };
    expect(validate(schema, { time: 1.5, label: 'a' })).toEqual({ valid: true });

    const result = validate(schema, { time: 'not-a-number', label: 'a' });
    expect(result).toMatchObject({ valid: false, path: '$.time' });
  });

  it('rejects a missing required property, naming it in the message', () => {
    const schema: JSONSchema = { type: 'object', properties: { time: { type: 'number' } }, required: ['time'] };
    const result = validate(schema, {});
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.path).toBe('$');
      expect(result.message).toMatch(/time/);
    }
  });

  it('validates enum membership', () => {
    const schema: JSONSchema = { type: 'string', enum: ['png', 'jpeg', 'webp'] };
    expect(validate(schema, 'png')).toEqual({ valid: true });
    const result = validate(schema, 'bmp');
    expect(result.valid).toBe(false);
  });

  it('validates numeric minimum and maximum', () => {
    const schema: JSONSchema = { type: 'number', minimum: 0, maximum: 1 };
    expect(validate(schema, 0.5)).toEqual({ valid: true });
    expect(validate(schema, -0.1).valid).toBe(false);
    expect(validate(schema, 1.1).valid).toBe(false);
  });

  it('validates array items and reports the offending index in the path', () => {
    const schema: JSONSchema = { type: 'array', items: { type: 'number' } };
    expect(validate(schema, [1, 2, 3])).toEqual({ valid: true });
    const result = validate(schema, [1, 'two', 3]);
    expect(result).toMatchObject({ valid: false, path: '$[1]' });
  });

  it('validates nested object-within-array-within-object schemas end to end', () => {
    const schema: JSONSchema = {
      type: 'object',
      properties: {
        boxes: {
          type: 'array',
          items: {
            type: 'object',
            properties: { x: { type: 'number' }, label: { type: 'string' } },
            required: ['x'],
          },
        },
      },
      required: ['boxes'],
    };
    const result = validate(schema, { boxes: [{ x: 0.1, label: 'a' }, { x: 'oops' }] });
    expect(result).toMatchObject({ valid: false, path: '$.boxes[1].x' });
  });

  it('treats a schema with no type as accepting anything', () => {
    expect(validate({}, 'anything')).toEqual({ valid: true });
    expect(validate({}, 42)).toEqual({ valid: true });
  });

  it('allows an optional property to be omitted', () => {
    const schema: JSONSchema = { type: 'object', properties: { label: { type: 'string' } } };
    expect(validate(schema, {})).toEqual({ valid: true });
  });

  it('rejects null for a non-nullable type but accepts it for type:null', () => {
    expect(validate({ type: 'string' }, null).valid).toBe(false);
    expect(validate({ type: 'null' }, null)).toEqual({ valid: true });
  });
});
