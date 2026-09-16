/**
 * Pure chat-message builders for the VLM tools (Task 12), split out from vlm.worker.ts so they're
 * unit-testable without a worker/model in the loop. Matches the standard transformers.js VLM chat
 * shape: one `{type:'image'}` placeholder per frame the caller is about to pass to
 * `processor(images, text)`, followed by a single `{type:'text'}` turn.
 */

export interface ImagePlaceholder {
  type: 'image';
}
export interface TextTurn {
  type: 'text';
  text: string;
}
export interface ChatMessage {
  role: 'user';
  content: (ImagePlaceholder | TextTurn)[];
}

export const DEFAULT_DESCRIBE_PROMPT = 'Describe this video frame in two sentences: people, objects, on-screen text, and what is happening.';

export function buildDescribeFrameMessages(prompt: string = DEFAULT_DESCRIBE_PROMPT): ChatMessage[] {
  return [{ role: 'user', content: [{ type: 'image' }, { type: 'text', text: prompt }] }];
}

/** `ask_about_frame` reuses this exact shape with the question in place of the describe prompt --
 * no separate builder needed, since the message structure is identical either way. */
export function buildAskMessages(question: string): ChatMessage[] {
  return buildDescribeFrameMessages(question);
}

export function buildDescribeRangeMessages(frameCount: number, from: string, to: string): ChatMessage[] {
  const images: ImagePlaceholder[] = Array.from({ length: frameCount }, () => ({ type: 'image' }));
  const text: TextTurn = { type: 'text', text: `These are ${frameCount} frames from ${from} to ${to} in order; describe what happens and what changes.` };
  return [{ role: 'user', content: [...images, text] }];
}

/** `describe_range`'s own fallback when a tier rejects multi-image input (per the plan's Key
 * Decisions): joins per-frame `describe_frame` results, timestamped, in order. */
export function joinPerFrameFallback(frames: { time: number; text: string }[]): string {
  return frames.map((f) => `[${f.time}s] ${f.text}`).join('\n');
}
