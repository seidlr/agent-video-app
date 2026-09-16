import { describe, expect, it } from 'vitest';
import { buildAskMessages, buildDescribeFrameMessages, buildDescribeRangeMessages, DEFAULT_DESCRIBE_PROMPT, joinPerFrameFallback } from '../../src/ml/vlmPrompts';

describe('buildDescribeFrameMessages', () => {
  it('uses the documented default prompt when none is given', () => {
    const messages = buildDescribeFrameMessages();
    expect(messages).toEqual([{ role: 'user', content: [{ type: 'image' }, { type: 'text', text: DEFAULT_DESCRIBE_PROMPT }] }]);
  });

  it('uses a caller-supplied prompt verbatim', () => {
    const messages = buildDescribeFrameMessages('What color is the car?');
    expect(messages).toEqual([{ role: 'user', content: [{ type: 'image' }, { type: 'text', text: 'What color is the car?' }] }]);
  });
});

describe('buildAskMessages', () => {
  it('places the question verbatim as the single image message text', () => {
    const messages = buildAskMessages('Is anyone wearing a hat?');
    expect(messages).toEqual([{ role: 'user', content: [{ type: 'image' }, { type: 'text', text: 'Is anyone wearing a hat?' }] }]);
  });
});

describe('buildDescribeRangeMessages', () => {
  it('places exactly one image placeholder per frame, before the text prompt', () => {
    const messages = buildDescribeRangeMessages(4, '0:00', '0:08');
    const content = messages[0]!.content;
    expect(content.filter((c) => c.type === 'image')).toHaveLength(4);
    expect(content.at(-1)).toEqual({ type: 'text', text: 'These are 4 frames from 0:00 to 0:08 in order; describe what happens and what changes.' });
  });

  it('scales the image-placeholder count with the frame count', () => {
    const messages = buildDescribeRangeMessages(12, '1:00', '1:30');
    expect(messages[0]!.content.filter((c) => c.type === 'image')).toHaveLength(12);
  });
});

describe('joinPerFrameFallback', () => {
  it('joins per-frame descriptions with their timestamps, in order', () => {
    const joined = joinPerFrameFallback([
      { time: 0, text: 'A red square.' },
      { time: 4, text: 'A blue circle.' },
    ]);
    expect(joined).toBe('[0s] A red square.\n[4s] A blue circle.');
  });

  it('returns an empty string for no frames', () => {
    expect(joinPerFrameFallback([])).toBe('');
  });
});
