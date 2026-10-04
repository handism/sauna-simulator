import { gpuMemory, observeGpuMemory, totalBytes, type GpuMemoryContext } from './gpu-memory';
import { chooseSceneSetting, switchSceneMode } from './settings-controls';
import { expect, test, type Page } from '@playwright/test';
import { useModelCandidate } from './model-candidate';

const stages = [
  ['水風呂へ', 'water'],
  ['外気浴へ', 'totonou'],
  ['もう一度サウナへ', 'sauna'],
] as const;

// Lets the scene draw a few frames after a change.
const frames = (page: Page, count = 10) =>
  page.evaluate(
    (count) =>
      new Promise<void>((resolve) => {
        const step = (left: number) => (left ? requestAnimationFrame(() => step(left - 1)) : resolve());
        step(count);
      }),
    count,
  );

test('GPU memory stays the same over stages, qualities and scene regeneration', async ({ page }, info) => {
  test.setTimeout(300_000);
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  const candidate = await useModelCandidate(page);
  await page.addInitScript(observeGpuMemory);
  // A fixed pixel ratio: the dynamic resolution resizes the render targets.
  await page.goto('?view=3d&resolution=fixed');
  await page.getByRole('button', { name: '音なしで入室する' }).click();
  const scene = page.locator('.sauna-3d-canvas');
  const ready = async () => {
    await expect(scene).toHaveAttribute('data-load-ms', /\d+/, { timeout: 20_000 });
    await expect(scene).toHaveAttribute('data-garden', 'ready', { timeout: 20_000 });
  };
  const quality = async (value: string) => {
    await chooseSceneSetting(page, '3Dの画質', value);
    await expect(scene).toHaveAttribute('data-quality', value);
  };
  const live = async () => {
    const contexts = await gpuMemory(page);
    const current = contexts.filter((context) => context.connected && !context.lost);
    expect(current).toHaveLength(1);
    return { current: current[0], contexts };
  };
  type Sample = { label: string; stage: string; quality: string; memory: GpuMemoryContext };
  const samples: Sample[] = [];
  const sample = async (label: string) => {
    await frames(page);
    const { current } = await live();
    const stage = (await scene.getAttribute('data-stage'))!;
    const value = (await scene.getAttribute('data-quality'))!;
    samples.push({ label, stage, quality: value, memory: current });
  };
  // Every stage and loyly at every quality, so a first upload (the steam's, a stage's geometry) is
  // not taken for growth.
  const warm = async () => {
    for (const value of ['high', 'standard', 'low']) {
      await quality(value);
      for (const [button, stage] of stages) {
        await page.getByRole('button', { name: button, exact: true }).click();
        await expect(scene).toHaveAttribute('data-stage', stage);
        if (stage === 'sauna') await page.getByRole('button', { name: 'ロウリュ' }).click();
        await frames(page);
      }
    }
  };
  const round = async (label: string) => {
    for (const value of ['low', 'high', 'standard']) {
      await quality(value);
      for (const [button, stage] of stages) {
        await page.getByRole('button', { name: button, exact: true }).click();
        await expect(scene).toHaveAttribute('data-stage', stage);
        // Loyly adds steam in the sauna.
        if (stage === 'sauna') await page.getByRole('button', { name: 'ロウリュ' }).click();
        await sample(label);
      }
    }
  };

  await ready();
  await sample('loaded');
  await warm();
  await round('first');
  await round('second');
  const released: GpuMemoryContext[] = [];
  for (let i = 0; i < 3; i++) {
    await switchSceneMode(page, '2Dに切り替え');
    await expect(scene).toHaveCount(0);
    const contexts = await gpuMemory(page);
    expect(contexts.filter((context) => context.connected && !context.lost)).toHaveLength(0);
    released.push(contexts.at(-1)!);
    await switchSceneMode(page, '3Dを試す');
    await ready();
    await warm();
    await round(`regenerated ${i + 1}`);
  }
  const all = await gpuMemory(page);
  if (candidate) expect(candidate.requests()).toBe(4);
  await info.attach('gpu-memory', {
    body: JSON.stringify(
      {
        samples,
        released,
        contexts: all,
        bodyCandidate: candidate && {
          sha256: candidate.sha256,
          bytes: candidate.bytes,
          requests: candidate.requests(),
        },
      },
      null,
      2,
    ),
    contentType: 'application/json',
  });

  // The same stage and quality hold the same memory in every round and every new scene.
  const byKey = new Map<string, Set<number>>();
  for (const { label, stage, quality: value, memory } of samples) {
    if (label === 'loaded') continue;
    const key = `${stage}/${value}`;
    byKey.set(key, (byKey.get(key) ?? new Set()).add(totalBytes(memory)));
  }
  for (const [key, totals] of byKey) expect([...totals], key).toHaveLength(1);
  // A scene that went back to 2D deleted its buffers and targets (three keeps a few 1×1 and 16×16
  // textures of its own), and lost its context, which frees the rest and the drawing buffer at once
  // rather than when the context is collected.
  for (const context of released) {
    expect(context.lost, `context ${context.id}`).toBe(true);
    expect(context.bytes.buffer + context.bytes.renderbuffer, `context ${context.id}`).toBe(0);
  }
  expect(all.flatMap((context) => context.unknownFormats)).toEqual([]);
  expect(errors).toEqual([]);
});
