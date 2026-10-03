import { expect, test, type Page } from '@playwright/test';

// Counts the audio graph the page builds: the nodes created by type, the contexts, and the
// scheduled sources that started and have not ended yet. Keeps the context and the panners to read
// the spatial pose the 3D scene sets.
function observeAudioNodes() {
  const counts = { contexts: 0, created: {} as Record<string, number>, playing: 0 };
  const spatial = { context: null as AudioContext | null, panners: [] as PannerNode[] };
  Object.assign(window, { suiAudioNodes: counts, suiSpatial: spatial });
  const Context = window.AudioContext;
  window.AudioContext = class extends Context {
    constructor(options?: AudioContextOptions) {
      super(options);
      counts.contexts++;
      spatial.context = this;
    }
  };
  const base = BaseAudioContext.prototype as unknown as Record<string, (...args: unknown[]) => unknown>;
  for (const name of Object.getOwnPropertyNames(BaseAudioContext.prototype)) {
    if (!/^create(?!Buffer$|PeriodicWave$)/.test(name)) continue;
    const original = base[name];
    base[name] = function (this: BaseAudioContext, ...args: unknown[]) {
      counts.created[name] = (counts.created[name] ?? 0) + 1;
      const node = original.apply(this, args);
      if (name === 'createPanner') spatial.panners.push(node as PannerNode);
      return node;
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

// Where the 3D scene placed the listener and the two panners (the stove and the spout).
const spatialPose = (page: Page) =>
  page.evaluate(() => {
    const { context, panners } = (window as unknown as { suiSpatial: { context: AudioContext; panners: PannerNode[] } })
      .suiSpatial;
    const listener = context.listener;
    return {
      listener: [listener.positionX.value, listener.positionY.value, listener.positionZ.value],
      panners: panners.map((panner) => [panner.positionX.value, panner.positionY.value, panner.positionZ.value]),
    };
  });

// Enters with sound, then runs loyly three times and a whole round of the stages six times.
// `between` runs at the end of each round, back in the sauna. Returns the samples taken in the
// sauna after entering and after each round.
async function rounds(page: Page, query: string, between?: () => Promise<void>) {
  await page.addInitScript(observeAudioNodes);
  await page.goto(query);
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
    await between?.();
    samples.push(await settled(1));
  }
  return samples;
}

const created = (samples: AudioNodes[]) =>
  samples.slice(1).map((sample, i) => total(sample.created) - total(samples[i].created));

test('the audio graph does not grow over repeated stages and loyly', async ({ page }, info) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  const samples = await rounds(page, '?view=2d');
  const perRound = created(samples);
  await info.attach('audio-nodes', {
    body: JSON.stringify({ samples, rounds: perRound }),
    contentType: 'application/json',
  });
  expect(samples.at(-1)!.contexts).toBe(1);
  // Each round creates the same nodes; the ones before end (none keeps playing).
  expect(new Set(perRound).size).toBe(1);
  expect(errors).toEqual([]);
});

test('the 3D scene and its regeneration add no audio nodes', async ({ page }, info) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  const scene = page.locator('.sauna-3d-canvas');
  const ready = async () => {
    await expect(scene).toHaveAttribute('data-load-ms', /\d+/, { timeout: 20_000 });
    await expect(scene).toHaveAttribute('data-garden', 'ready', { timeout: 20_000 });
  };
  const definition = await (await page.request.get('models/sauna.scene.json')).json();
  const poses: Awaited<ReturnType<typeof spatialPose>>[] = [];
  const samples = await rounds(page, '?view=3d', async () => {
    await ready();
    poses.push(await spatialPose(page));
    // Back to 2D (the pose is released) and a new scene, which sets it again.
    await page.getByRole('button', { name: '2Dに切り替え' }).click();
    await expect(scene).toHaveCount(0);
    await page.getByRole('button', { name: '3Dを試す' }).click();
    await ready();
  });
  poses.push(await spatialPose(page));
  const perRound = created(samples);
  await info.attach('audio-nodes', {
    body: JSON.stringify({ samples, rounds: perRound, poses }),
    contentType: 'application/json',
  });
  expect(samples.at(-1)!.contexts).toBe(1);
  // The two spatial buses are made on entering only; scenes reuse them.
  expect(samples.at(-1)!.created.createPanner).toBe(2);
  expect(new Set(perRound).size).toBe(1);
  // The scene placed the panners and moved the listener to its camera.
  for (const pose of poses) {
    // AudioParam values are single precision.
    expect(pose.panners).toEqual([definition.stove, definition.water.spout].map((p: number[]) => p.map(Math.fround)));
    expect(pose.listener.some((value) => value !== 0)).toBe(true);
  }
  expect(errors).toEqual([]);
});
