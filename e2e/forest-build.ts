import { expect, type Page } from '@playwright/test';
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';

/** Check the bundle actually fetched by the browser, not just the intended server settings. */
export async function verifyForestBuild(page: Page) {
  const baseline = process.env.FOREST_BASELINE_DIST;
  const dist = baseline ?? 'dist';
  const bundles = readdirSync(join(dist, 'assets')).filter((f) => /^SaunaScene-.*\.js$/.test(f));
  expect(bundles).toHaveLength(1);
  const bundle = bundles[0];
  const resource = `/assets/${bundle}`;
  await expect
    .poll(() =>
      page.evaluate(
        (suffix) =>
          performance.getEntriesByType('resource').some((entry) => new URL(entry.name).pathname.endsWith(suffix)),
        resource,
      ),
    )
    .toBe(true);
  const sha = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');
  const response = await page.request.get(new URL(`assets/${bundle}`, page.url()).href);
  expect(response.ok()).toBe(true);
  const servedHash = sha(await response.body());
  expect(servedHash).toBe(sha(readFileSync(join(dist, 'assets', bundle))));
  return {
    baseline: !!baseline,
    bundle,
    bundleHash: servedHash,
    sourceHash: sha(
      readFileSync(baseline ? join(dirname(baseline), 'farForest.before.ts') : 'src/components/3d/farForest.ts'),
    ),
  };
}
