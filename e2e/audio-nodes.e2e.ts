import { expect, test, type Page } from '@playwright/test';

// Counts the audio graph the page builds (2D, so no GPU is needed): the nodes created by type,
// the contexts, and the scheduled sources that started and have not ended yet.
function observeAudioNodes() {
  const counts = { contexts: 0, created: {} as Record<string, number>, playing: 0 };
  Object.assign(window, { suiAudioNodes: counts });
  const Context = window.AudioContext;
  window.AudioContext = class extends Context {
    constructor(options?: AudioContextOptions) {
      super(options);
      counts.contexts++;
    }
  };
  const base = BaseAudioContext.prototype as unknown as Record<string, (...args: unknown[]) => unknown>;
  for (const name of Object.getOwnPropertyNames(BaseAudioContext.prototype)) {
    if (!/^create(?!Buffer$|PeriodicWave$)/.test(name)) continue;
    const original = base[name];
    base[name] = function (this: BaseAudioContext, ...args: unknown[]) {
      counts.created[name] = (counts.created[name] ?? 0) + 1;
      return original.apply(this, args);
    };
  }
  // AudioBufferSourceNode has its own start (with an offset and a duration).
  for (const prototype of [AudioScheduledSourceNode.prototype, AudioBufferSourceNode.prototype]) {
    const start = prototype.start as (...args: number[]) => void;
    prototype.start = function (this: AudioScheduledSourceNode, ...args: number[]) {
      counts.playing++;
      this.addEventListener('ended', () => counts.playing--, { once: true });
      return start.apply(this, args);
    };
  }
}

type AudioNodes = { contexts: number; created: Record<string, number>; playing: number };
const nodes = (page: Page) => page.evaluate(() => (window as unknown as { suiAudioNodes: AudioNodes }).suiAudioNodes);
const total = (created: Record<string, number>) => Object.values(created).reduce((sum, count) => sum + count, 0);

test('the audio graph does not grow over repeated stages and loyly', async ({ page }, info) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.addInitScript(observeAudioNodes);
  await page.goto('?view=2d');
  await page.getByRole('button', { name: '音ありで入室する' }).click();
  const heading = page.getByRole('heading', { name: 'サウナルーム' });
  await expect(heading).toBeVisible();
  // Fades out over 1.2 s; a loyly sounds for 2 s.
  const settled = async (playing: number) => {
    await expect.poll(async () => (await nodes(page)).playing, { timeout: 10_000 }).toBe(playing);
    return nodes(page);
  };
  const samples = [await settled(1)];
  for (let round = 0; round < 6; round++) {
    for (let i = 0; i < 3; i++) await page.getByRole('button', { name: 'ロウリュ (Löyly)' }).click();
    await page.getByRole('button', { name: '限界.. 水風呂へ 💧', exact: true }).click();
    await expect(page.getByRole('heading', { name: '水風呂' })).toBeVisible();
    await settled(1);
    await page.getByRole('button', { name: '外気浴へ 🍃', exact: true }).click();
    await expect(page.getByRole('heading', { name: '外気浴' })).toBeVisible();
    // Binaural beats (2), wind and its LFO.
    await settled(4);
    await page.getByRole('button', { name: 'もう一度サウナへ 🔄', exact: true }).click();
    await expect(heading).toBeVisible();
    samples.push(await settled(1));
  }
  const rounds = samples.slice(1).map((sample, i) => total(sample.created) - total(samples[i].created));
  await info.attach('audio-nodes', { body: JSON.stringify({ samples, rounds }), contentType: 'application/json' });
  expect(samples.at(-1)!.contexts).toBe(1);
  // Each round creates the same nodes; the ones before end (none keeps playing).
  expect(new Set(rounds).size).toBe(1);
  expect(errors).toEqual([]);
});
