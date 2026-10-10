import { expect, test } from '@playwright/test';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { chooseSceneSetting } from './settings-controls';
import { rendererCaptureStyle, settleRenderer } from './scene-capture';

type Gate = {
  held: boolean;
  now: number;
  wall: number;
  entered: number;
  count: number;
  key: number;
  advance: () => Promise<void>;
};
type ReviewWindow = Window & { mirrorReview: Gate };

// A controlled 60-Hz sequence, not real-time performance. Hold all application rAF
// callbacks while capturing PNGs so TAA, waves and lighting do not advance unseen.
function installGate() {
  const native = requestAnimationFrame.bind(window);
  const cancel = cancelAnimationFrame.bind(window);
  const realNow = Date.now.bind(Date);
  const pending = new Map<number, FrameRequestCallback>();
  const state: Gate = {
    held: false,
    now: 0,
    wall: 0,
    entered: 0,
    count: 0,
    key: 0,
    advance: () =>
      new Promise<void>((resolve) =>
        native(() => {
          state.now += 1000 / 60;
          state.wall += 1000 / 60;
          const callbacks = [...pending.values()];
          pending.clear();
          for (const callback of callbacks) callback(state.now);
          state.count++;
          native(() => native(() => resolve()));
        }),
      ),
  };
  (window as unknown as ReviewWindow).mirrorReview = state;
  Date.now = () => state.wall || realNow();
  document.addEventListener(
    'click',
    (event) => {
      if ((event.target as Element).closest('button')?.textContent?.includes('音なしで入室する'))
        state.entered = Date.now();
    },
    true,
  );
  window.requestAnimationFrame = (callback) => {
    const id = native((time) => {
      if (state.held) pending.set(id, callback);
      else {
        state.now = time;
        callback(time);
      }
    });
    return id;
  };
  window.cancelAnimationFrame = (id) => {
    pending.delete(id);
    cancel(id);
  };
  localStorage.setItem('sui-quality', 'high');
}

const sha = (bytes: Buffer | string) => createHash('sha256').update(bytes).digest('hex');
for (const minute of [12, 27]) {
  for (const [order, mode] of ['product', 'continuous', 'continuous', 'product'].entries()) {
    test(`mirror steps ${minute} ${order} ${mode}`, async ({ page, browser }, info) => {
      test.setTimeout(240_000);
      const errors: string[] = [];
      const patches: { url: string; before: string; after: string }[] = [];
      page.on('pageerror', (e) => errors.push(e.message));
      page.on('console', (m) => {
        if (m.type() === 'error') errors.push(m.text());
      });
      await page.addInitScript(installGate);
      await page.route('**/assets/SaunaScene-*.js', async (route) => {
        const response = await route.fetch();
        const source = await response.text();
        const pattern = /(\w+)\[0\]=Math\.round\((\w+)\.time\*500\)\/500/g;
        expect([...source.matchAll(pattern)]).toHaveLength(1);
        const modified = source.replace(
          pattern,
          (_all, state: string, light: string) =>
            `${state}[0]=${mode === 'product' ? `Math.round(${light}.time*500)/500` : `${light}.time`},window.mirrorReview.key=${state}[0]`,
        );
        patches.push({ url: route.request().url(), before: sha(source), after: sha(modified) });
        await route.fulfill({ response, body: modified });
      });
      await page.goto('?view=3d&warmup=split&resolution=fixed&frameRate=full');
      await page.getByRole('button', { name: '音なしで入室する' }).click();
      const scene = page.locator('.sauna-3d-canvas');
      await expect(scene).toHaveAttribute('data-garden', 'ready', { timeout: 30_000 });
      await expect(scene).toHaveAttribute('data-warmup', 'split');
      await expect(scene).toHaveAttribute('data-warmup-undrawn', '0');
      await expect(scene).toHaveAttribute('data-garden-warmup-undrawn', '0');
      await page.getByRole('button', { name: '水風呂へ', exact: true }).click();
      await expect(scene).toHaveAttribute('data-stage', 'water');
      await page.emulateMedia({ reducedMotion: 'reduce' });
      await page.evaluate((value) => {
        const gate = (window as unknown as ReviewWindow).mirrorReview;
        gate.wall = gate.entered + (value * 60 + 90) * 1000;
      }, minute);
      await chooseSceneSetting(page, '3Dの時間帯', 'auto');
      await expect(scene).toHaveAttribute('data-time-of-day', minute === 12 ? '0.500' : '1.500');
      await settleRenderer(page);
      await page.emulateMedia({ reducedMotion: 'no-preference' });
      await page.getByRole('button', { name: '景色だけ見る', exact: true }).click();
      await page.evaluate(() => {
        (window as unknown as ReviewWindow).mirrorReview.held = true;
      });
      await page.waitForTimeout(100);
      const samples = [];
      for (let frame = 0; frame <= 60; frame++) {
        await page.evaluate(() => (window as unknown as ReviewWindow).mirrorReview.advance());
        const before = await page.evaluate(() => {
          const g = (window as unknown as ReviewWindow).mirrorReview;
          return { count: g.count, now: g.now, wall: g.wall, key: g.key };
        });
        const file = `frame-${String(frame).padStart(3, '0')}.png`;
        const png = await scene
          .locator('canvas')
          .screenshot({ path: info.outputPath(file), style: rendererCaptureStyle });
        expect(await page.evaluate(() => (window as unknown as ReviewWindow).mirrorReview.count)).toBe(before.count);
        samples.push({
          frame,
          file,
          sha256: sha(png),
          ...before,
          data: await scene.evaluate((e) => ({ ...(e as HTMLElement).dataset })),
        });
      }
      expect(patches).toHaveLength(1);
      expect(errors).toEqual([]);
      const hashes = Object.fromEntries(
        [
          'src/components/3d/SaunaScene.tsx',
          'src/components/3d/lighting.ts',
          'src/components/3d/planarReflection.ts',
          'e2e/mirror-steps.visual.ts',
          'public/models/sauna.glb',
          'public/models/sauna-garden.glb',
        ].map((file) => [file, sha(readFileSync(file))]),
      );
      await info.attach('mirror-steps', {
        contentType: 'application/json',
        body: JSON.stringify({
          minute,
          mode,
          order,
          browser: browser.version(),
          browserName: browser.browserType().name(),
          viewport: page.viewportSize(),
          dir: info.outputDir,
          hashes,
          patches,
          samples,
          errors,
          limits:
            'Controlled 60-Hz timestamps, midpoint only, static water view. Diagnostic continuous variant, not a product change or performance verdict.',
        }),
      });
    });
  }
}
