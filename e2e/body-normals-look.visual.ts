import { expect, test } from '@playwright/test';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { useModelCandidate } from './model-candidate';
import { chooseSceneSetting } from './settings-controls';
import { rendererCaptureStyle, settleRenderer } from './scene-capture';

const quality = process.env.CAPTURE_QUALITY ?? 'standard';
const dpr = Number(process.env.CAPTURE_DPR ?? 1.5);
if (!['standard', 'high'].includes(quality) || !Number.isFinite(dpr) || dpr <= 0)
  throw new Error('Invalid capture settings');
test.use({ viewport: { width: 1200, height: 800 }, deviceScaleFactor: dpr });

type Gate = { held: boolean; count: number; advance: () => Promise<void> };
// Hold application rAF callbacks during PNG capture, including TAA history updates.
// Playwright's isolated-world screenshot rAF is unaffected. This is not an FPS test.
function installGate() {
  const native = window.requestAnimationFrame.bind(window);
  const cancel = window.cancelAnimationFrame.bind(window);
  const pending = new Map<number, FrameRequestCallback>();
  const gate: Gate = {
    held: false,
    count: 0,
    advance: () =>
      new Promise<void>((resolve) =>
        native((time) => {
          const callbacks = [...pending.values()];
          pending.clear();
          for (const callback of callbacks) callback(time);
          gate.count++;
          native(() => native(() => resolve()));
        }),
      ),
  };
  window.requestAnimationFrame = (callback) => {
    const id = native((time) => {
      if (gate.held) pending.set(id, callback);
      else callback(time);
    });
    return id;
  };
  window.cancelAnimationFrame = (id) => {
    pending.delete(id);
    cancel(id);
  };
  (window as unknown as { normalGate: Gate }).normalGate = gate;
}

for (const view of ['condensation', 'water'] as const) {
  test(`capture body normals while turning at ${view}`, async ({ page, browser }, info) => {
    test.setTimeout(300_000);
    const candidate = await useModelCandidate(page);
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    page.on('console', (e) => {
      if (e.type() === 'error') errors.push(e.text());
    });
    await page.addInitScript(installGate);
    const bytes = readFileSync('public/models/sauna.glb');
    const model = JSON.parse(bytes.subarray(20, 20 + bytes.readUInt32LE(12)).toString());
    const bead = model.nodes.find((n: { name?: string }) => n.name === 'Glass condensation bead');
    const [x, y, z] = bead.translation as number[];
    const camera = { position: [x - 0.12, y, z - 0.38], target: [x, y, z], fov: 38 };
    if (view === 'condensation')
      await page.route('**/sauna.scene.json', async (route) => {
        const definition = await (await route.fetch()).json();
        definition.views.sauna = camera;
        await route.fulfill({ json: definition });
      });
    await page.goto('?view=3d&resolution=fixed&frameRate=full');
    await page.getByRole('button', { name: '音なしで入室する' }).click();
    const scene = page.locator('.sauna-3d-canvas');
    const canvas = scene.locator('canvas');
    await expect(scene).toHaveAttribute('data-garden', 'ready', { timeout: 30_000 });
    await chooseSceneSetting(page, '3Dの画質', quality);
    await expect(scene).toHaveAttribute('data-quality', quality);
    await expect(scene).toHaveAttribute('data-pixel-ratio', String(dpr));
    if (view === 'water') {
      await page.getByRole('button', { name: '水風呂へ', exact: true }).click();
      await expect(scene).toHaveAttribute('data-stage', 'water');
    }
    await page.getByRole('button', { name: 'UI非表示', exact: true }).click();
    await page.waitForTimeout(1500);
    const samples = [];
    for (const lighting of ['day', 'evening', 'night']) {
      await chooseSceneSetting(page, '3Dの時間帯', lighting);
      await expect(scene).toHaveAttribute('data-lighting', lighting);
      await settleRenderer(page);
      await expect(scene).toHaveAttribute('data-temporal', 'on');
      const box = (await canvas.boundingBox())!;
      const startX = box.x + box.width / 2;
      const startY = box.y + box.height / 2;
      await page.mouse.move(startX, startY);
      await page.mouse.down();
      await page.evaluate(() => {
        (window as unknown as { normalGate: Gate }).normalGate.held = true;
      });
      await page.waitForTimeout(100);
      for (let step = 0; step <= 24; step++) {
        // Out and back, one CSS pixel / simulated frame. Reduced motion freezes waves,
        // isolating normal quantization under camera rotation with production TAA enabled.
        const offset = step <= 12 ? step : 24 - step;
        await page.mouse.move(startX + offset, startY);
        await page.evaluate(() => (window as unknown as { normalGate: Gate }).normalGate.advance());
        const count = await page.evaluate(() => (window as unknown as { normalGate: Gate }).normalGate.count);
        const file = `${view}-${lighting}-${String(step).padStart(2, '0')}.png`;
        await canvas.screenshot({ path: info.outputPath(file), style: rendererCaptureStyle });
        expect(await page.evaluate(() => (window as unknown as { normalGate: Gate }).normalGate.count)).toBe(count);
        samples.push({
          file,
          lighting,
          step,
          offset,
          count,
          metrics: await scene.evaluate((e) => ({ ...(e as HTMLElement).dataset })),
        });
      }
      await page.mouse.up();
      await page.evaluate(async () => {
        const gate = (window as unknown as { normalGate: Gate }).normalGate;
        gate.held = false;
        await gate.advance();
      });
    }
    expect(errors).toEqual([]);
    if (candidate) expect(candidate.requests()).toBe(1);
    const hashes = Object.fromEntries(
      [
        'e2e/body-normals-look.visual.ts',
        'public/models/sauna.glb',
        'public/models/sauna-garden.glb',
        'public/models/sauna.scene.json',
        'src/components/3d/temporalAA.ts',
      ].map((path) => [path, createHash('sha256').update(readFileSync(path)).digest('hex')]),
    );
    await info.attach('body-normals-look', {
      contentType: 'application/json',
      body: JSON.stringify({
        view,
        camera: view === 'condensation' ? camera : null,
        quality,
        dpr,
        browser: browser.version(),
        hashes,
        bodyCandidate: candidate && {
          sha256: candidate.sha256,
          bytes: candidate.bytes,
          requests: candidate.requests(),
        },
        errors,
        samples,
      }),
    });
  });
}
