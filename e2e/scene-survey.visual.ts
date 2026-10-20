import { chooseSceneSetting } from './settings-controls';
import { expect, test } from '@playwright/test';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';

// Capture through public controls, without a test-only camera API. These are
// review artifacts, not golden-image assertions or a visual-quality pass.
test('capture all seated views for manual geometry and lighting review', async ({ page, browser }, info) => {
  // 216 captures: three stages, three times of day, eight headings, three pitches.
  test.setTimeout(360_000);
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  const samples: object[] = [];
  await page.goto('?sound=off&quality&view=3d&frameRate=full');
  await page.getByRole('button', { name: '入室する', exact: true }).click();
  const scene = page.locator('.sauna-3d-canvas');
  const canvas = scene.locator('canvas');
  await expect(scene).toHaveAttribute('data-load-ms', /\d+/, { timeout: 20_000 });
  // The woodland foliage loads after the ready scene.
  await expect(scene).toHaveAttribute('data-garden', 'ready', { timeout: 20_000 });
  const original = await canvas.elementHandle();
  await chooseSceneSetting(page, '3Dの画質', 'standard');
  // Optional season/weather passes; the defaults keep the summer/clear survey.
  const season = process.env.SURVEY_SEASON ?? 'summer';
  const weather = process.env.SURVEY_WEATHER ?? 'clear';
  if (season !== 'summer') await chooseSceneSetting(page, '3Dの季節', season);
  if (weather !== 'clear') await chooseSceneSetting(page, '天気', weather);
  const press = async (key: string, count: number) => {
    await scene.focus();
    for (let n = 0; n < count; n++) await page.keyboard.press(key);
  };
  const stages = [
    ['sauna', '水風呂へ'],
    ['water', '外気浴へ'],
    ['totonou', 'もう一度サウナへ'],
  ] as const;
  for (const [stage, next] of stages) {
    await expect(scene).toHaveAttribute('data-stage', stage);
    await page.getByRole('button', { name: '景色だけ見る', exact: true }).click();
    // Wait for the UI/scene opacity transitions, not just the stage attribute.
    await page.waitForTimeout(1200);
    for (const lighting of ['day', 'evening', 'night']) {
      await chooseSceneSetting(page, '3Dの時間帯', lighting);
      await expect(scene).toHaveAttribute('data-lighting', lighting);
      for (let heading = 0; heading < 8; heading++) {
        // Force the lower clamp, then use a fixed count to reach near-level
        // (-.85 + 14*.06 = -.01 rad) and finally the upper clamp.
        await press('ArrowDown', 32);
        for (const pitch of ['down', 'level', 'up']) {
          if (pitch === 'level') await press('ArrowUp', 14);
          if (pitch === 'up') await press('ArrowUp', 32);
          const file = `${stage}-${lighting}-${heading}-${pitch}.jpg`;
          await canvas.screenshot({ path: info.outputPath(file), type: 'jpeg', quality: 85 });
          samples.push({
            stage,
            lighting,
            file,
            headingDegrees: (heading * 0.8 * 180) / Math.PI,
            pitchRadians: pitch === 'down' ? -0.85 : pitch === 'up' ? 0.85 : -0.01,
            metrics: await scene.evaluate((element) => ({ ...(element as HTMLElement).dataset })),
          });
        }
        await press('ArrowRight', 10);
      }
      // Restore the exact initial heading before the next lighting pass.
      await press('ArrowLeft', 80);
    }
    expect(await original!.evaluate((element) => element === document.querySelector('.sauna-3d-canvas canvas'))).toBe(
      true,
    );
    await page.getByRole('button', { name: '操作を表示', exact: true }).click();
    await page.getByRole('button', { name: next, exact: true }).click();
  }
  await expect(scene).toHaveAttribute('data-stage', 'sauna');
  expect(errors).toEqual([]);
  const hashes = Object.fromEntries(
    await Promise.all(
      [
        'sauna.glb',
        'sauna-garden.glb',
        'sauna.scene.json',
        'irradiance.json',
        'irradiance.bin',
        'reflection.json',
        'reflection.bin',
      ].map(async (file) => [
        file,
        createHash('sha256')
          .update(await readFile(`public/models/${file}`))
          .digest('hex'),
      ]),
    ),
  );
  await info.attach('survey', {
    contentType: 'application/json',
    body: JSON.stringify(
      {
        browser: browser.version(),
        viewport: page.viewportSize(),
        deviceScaleFactor: 1,
        quality: 'standard',
        season,
        weather,
        reducedMotion: true,
        muted: true,
        hashes,
        sourceHashes: Object.fromEntries(
          await Promise.all(
            [
              'src/components/3d/farForest.ts',
              'src/components/3d/refraction.ts',
              'src/components/3d/waterEffects.ts',
              'src/components/3d/seasonalLight.ts',
              'src/components/3d/seasonal-light.json',
              'src/components/3d/irradiance.ts',
              'src/components/3d/waterBottom.ts',
              'src/components/3d/deckIrradiance.ts',
              'src/components/3d/depthPrepass.ts',
              'src/components/3d/shadowMask.ts',
              'src/components/3d/SaunaScene.tsx',
              'src/components/3d/gardenDetails.ts',
              'src/components/3d/woodlandCrowns.ts',
              'src/components/3d/modelMaterials.ts',
              'src/components/3d/crownNormals.ts',
              'src/components/3d/leafCluster.ts',
            ].map(async (file) => [
              file,
              createHash('sha256')
                .update(await readFile(file))
                .digest('hex'),
            ]),
          ),
        ),
        errors,
        samples,
        note: 'Manual visual review required. Angles are relative to each initial seated heading. No performance or Cycles equivalence claim.',
      },
      null,
      2,
    ),
  });
});
