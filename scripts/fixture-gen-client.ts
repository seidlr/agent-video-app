// Browser-side fixture generator, run by scripts/make-fixture-video.ts under Playwright
// (Node has no WebCodecs, so encoding has to happen in a real browser). Renders an 8s@30fps
// 640x360 clip: four 2s color scenes (hard cuts, for scene-detection tests) with a moving
// white square 0-2s (for tracking) and the word AGENT burned into the last scene (for OCR),
// plus an audio track (440Hz tone 0-5s, then a spoken sentence 5-7.5s, for transcription/
// speaker/audio-event tests). Writes the finished mp4 bytes onto `window.__fixtureResult`.

import { AudioBufferSource, BufferTarget, CanvasSource, Mp4OutputFormat, Output, Quality } from 'mediabunny';

declare global {
  interface Window {
    __fixtureResult?: { ok: true; base64: string } | { ok: false; error: string };
  }
}

const WIDTH = 640;
const HEIGHT = 360;
const FPS = 30;
const DURATION = 8;
// AAC (mp4a.40.x) encoders in Chromium reject unusual rates like 16000 Hz mono at high
// bitrate/profile combos ("encoder configuration not supported"); 48000 is universally
// supported. Task 8's audio extraction resamples to 16kHz mono for ASR regardless of the
// container track's native rate, so this only affects how the fixture itself is encoded.
const SAMPLE_RATE = 48000;

const SCENES: { from: number; to: number; color: string }[] = [
  { from: 0, to: 2, color: '#ff0000' },
  { from: 2, to: 4, color: '#00aa00' },
  { from: 4, to: 6, color: '#0000ff' },
  { from: 6, to: 8, color: '#ffdd00' },
];

function drawFrame(ctx: CanvasRenderingContext2D, t: number): void {
  const scene = SCENES.find((s) => t >= s.from && t < s.to) ?? SCENES[SCENES.length - 1]!;
  ctx.fillStyle = scene.color;
  ctx.fillRect(0, 0, WIDTH, HEIGHT);

  if (scene.from === 0) {
    // 0-2s: white 60px square moving left -> right (x from 10% to 60% of width)
    const progress = (t - scene.from) / (scene.to - scene.from);
    const x = WIDTH * (0.1 + progress * 0.5) - 30;
    const y = HEIGHT / 2 - 30;
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(x, y, 60, 60);
  }

  if (scene.from === 6) {
    // 6-8s: "AGENT" burned in for OCR tests
    ctx.fillStyle = '#000000';
    ctx.font = '48px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('AGENT', WIDTH / 2, HEIGHT / 2);
  }
}

// Chromium's AAC encoder pads the muxed duration by its encoder delay/priming (observed: one
// AAC frame = 1024 samples, times 3, at 48kHz = 64ms) beyond the sample count actually pushed.
// Undershooting the source by that same amount keeps the container's reported duration at the
// intended 8.0s (checked empirically against the DoD's 8.0 +/- 0.05s tolerance).
const AAC_ENCODER_PADDING_SAMPLES = 3 * 1024;

async function buildAudio(): Promise<AudioBuffer> {
  const ac = new AudioContext({ sampleRate: SAMPLE_RATE });
  const totalSamples = DURATION * SAMPLE_RATE - AAC_ENCODER_PADDING_SAMPLES;
  const buffer = ac.createBuffer(1, totalSamples, SAMPLE_RATE);
  const data = buffer.getChannelData(0);

  // 0-5s: 440Hz tone at moderate volume
  const toneEnd = 5 * SAMPLE_RATE;
  for (let i = 0; i < toneEnd; i++) {
    data[i] = Math.sin((2 * Math.PI * 440 * i) / SAMPLE_RATE) * 0.2;
  }

  // 5-7.5s: the spoken sentence, decoded at the same sample rate
  const resp = await fetch('/tests/fixtures/sentence.wav');
  const arrayBuffer = await resp.arrayBuffer();
  const sentenceBuffer = await ac.decodeAudioData(arrayBuffer);
  const sentenceData = sentenceBuffer.getChannelData(0);
  const startSample = 5 * SAMPLE_RATE;
  for (let i = 0; i < sentenceData.length && startSample + i < totalSamples; i++) {
    data[startSample + i] = sentenceData[i] ?? 0;
  }

  await ac.close();
  return buffer;
}

async function run(): Promise<void> {
  const canvas = document.createElement('canvas');
  canvas.width = WIDTH;
  canvas.height = HEIGHT;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('2d context unavailable');

  const output = new Output({
    format: new Mp4OutputFormat(),
    target: new BufferTarget(),
  });

  const videoSource = new CanvasSource(canvas, { codec: 'avc', bitrate: new Quality('high') });
  output.addVideoTrack(videoSource, { frameRate: FPS });

  const audioBuffer = await buildAudio();
  const audioSource = new AudioBufferSource({ codec: 'aac', bitrate: new Quality('high') });
  output.addAudioTrack(audioSource);

  await output.start();

  const frameCount = DURATION * FPS;
  for (let frame = 0; frame < frameCount; frame++) {
    const t = frame / FPS;
    drawFrame(ctx, t);
    await videoSource.add(t, 1 / FPS);
  }
  videoSource.close();

  await audioSource.add(audioBuffer);
  audioSource.close();

  await output.finalize();

  const buffer = output.target.buffer;
  if (!buffer) throw new Error('mediabunny produced no output buffer');

  let binary = '';
  const bytes = new Uint8Array(buffer);
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  window.__fixtureResult = { ok: true, base64: btoa(binary) };
  document.getElementById('status')!.textContent = 'done';
}

run().catch((error: unknown) => {
  const message = error instanceof Error ? `${error.message}\n${error.stack}` : String(error);
  window.__fixtureResult = { ok: false, error: message };
  document.getElementById('status')!.textContent = 'error';
  console.error(error);
});
