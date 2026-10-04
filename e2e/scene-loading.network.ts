import { switchSceneMode } from './settings-controls';
import { expect, test } from '@playwright/test';

// Measure opt-in loading after the 2D page is ready, including lazy JavaScript.
// These are explicit laboratory profiles, not labels for real mobile networks.
const profiles = [
  { name: '12 Mbps completion', mbps: 12, latency: 80, outcome: 'ready' },
  // Below the ~4.7 Mbps the lossless 16.4 MB model needed within the 30-second limit.
  { name: '4 Mbps completion', mbps: 4, latency: 150, outcome: 'ready' },
  // Below the ~3.0 Mbps the single 9.8 MB model needed; the scene without the garden fits.
  { name: '1.6 Mbps completion', mbps: 1.6, latency: 150, outcome: 'ready' },
  { name: '0.8 Mbps timeout', mbps: 0.8, latency: 150, outcome: 'timeout' },
  { name: '0.8 Mbps manual cancellation', mbps: 0.8, latency: 150, outcome: 'cancel' },
] as const;

for (const profile of profiles) {
  test(profile.name, async ({ page }, info) => {
    // The garden follows the ready scene at the same bandwidth.
    test.setTimeout(150_000);
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('Network.enable');
    await cdp.send('Network.setCacheDisabled', { cacheDisabled: true });
    const requests = new Map<
      string,
      {
        path: string;
        start: number;
        durationMs?: number;
        receivedBytes: number;
        encodedBytes?: number;
        cached?: boolean;
        failure?: string;
        canceled?: boolean;
      }
    >();
    cdp.on('Network.requestWillBeSent', (event) => {
      const path = new URL(event.request.url).pathname;
      if (path.includes('/models/') || /\/assets\/.*\.js$/.test(path)) {
        requests.set(event.requestId, { path, start: event.timestamp, receivedBytes: 0 });
      }
    });
    cdp.on('Network.responseReceived', (event) => {
      const item = requests.get(event.requestId);
      if (item) item.cached = !!(event.response.fromDiskCache || event.response.fromServiceWorker);
    });
    cdp.on('Network.requestServedFromCache', (event) => {
      const item = requests.get(event.requestId);
      if (item) item.cached = true;
    });
    cdp.on('Network.dataReceived', (event) => {
      const item = requests.get(event.requestId);
      if (item) item.receivedBytes += event.dataLength;
    });
    cdp.on('Network.loadingFinished', (event) => {
      const item = requests.get(event.requestId);
      if (item) {
        item.durationMs = (event.timestamp - item.start) * 1000;
        item.encodedBytes = event.encodedDataLength;
      }
    });
    cdp.on('Network.loadingFailed', (event) => {
      const item = requests.get(event.requestId);
      if (item) {
        item.durationMs = (event.timestamp - item.start) * 1000;
        item.failure = event.errorText;
        item.canceled = event.canceled;
      }
    });
    const scene = page.locator('.sauna-3d-canvas');
    const model = () => [...requests.values()].filter((item) => item.path.endsWith('/sauna.glb'));
    const garden = () => [...requests.values()].filter((item) => item.path.endsWith('/sauna-garden.glb'));
    let elapsedMs: number | undefined;
    let gardenElapsedMs: number | undefined;
    let internalGardenMs: number | undefined;
    let recoveryMs: number | undefined;
    let internalLoadMs: number | undefined;
    try {
      await page.goto('?view=2d');
      await page.getByRole('button', { name: '音なしで入室する' }).click();
      await expect(page.getByRole('heading', { name: 'サウナルーム' })).toBeVisible();
      expect(model()).toHaveLength(0);
      requests.clear();
      await cdp.send('Network.emulateNetworkConditionsByRule', {
        offline: false,
        matchedNetworkConditions: [
          {
            urlPattern: '',
            latency: profile.latency,
            downloadThroughput: (profile.mbps * 1_000_000) / 8,
            uploadThroughput: 750_000 / 8,
          },
        ],
      });
      const started = Date.now();
      await switchSceneMode(page, '3Dを試す');
      await expect(page.getByRole('status')).toContainText('読み込み中');
      // Wait for actual response bytes, not an artificially held request.
      await expect.poll(() => model()[0]?.receivedBytes ?? 0, { timeout: 15_000 }).toBeGreaterThan(0);
      await page.getByRole('button', { name: '水風呂へ', exact: true }).click();
      await expect(page.getByRole('heading', { name: '水風呂', exact: true })).toBeVisible();
      await expect(page.getByRole('status')).toContainText('読み込み中');
      if (profile.outcome === 'ready') {
        await expect(scene).toHaveAttribute('data-load-ms', /\d+/, { timeout: 30_000 });
        elapsedMs = Date.now() - started;
        internalLoadMs = Number(await scene.getAttribute('data-load-ms'));
        await expect(scene).toHaveAttribute('data-stage', 'water');
        expect(model()).toHaveLength(1);
        expect(model()[0].failure).toBeUndefined();
        expect(model()[0].encodedBytes).toBeGreaterThan(1_000_000);
        // Catch accidentally unthrottled execution while allowing scheduler noise.
        expect(model()[0].durationMs!).toBeGreaterThan(
          (model()[0].encodedBytes! / ((profile.mbps * 1_000_000) / 8)) * 700,
        );
        // The garden is requested only after the scene is ready, and the scene stays usable.
        await expect.poll(() => garden().length).toBe(1);
        expect(garden()[0].start).toBeGreaterThanOrEqual(model()[0].start + model()[0].durationMs! / 1000 - 0.001);
        if ((await scene.getAttribute('data-garden')) === 'loading')
          await expect(page.getByRole('status')).toContainText('庭の木々を読み込み中');
        await expect(scene).toHaveAttribute('data-garden', 'ready', { timeout: 80_000 });
        gardenElapsedMs = Date.now() - started;
        internalGardenMs = Number(await scene.getAttribute('data-garden-ms'));
        await expect(page.getByRole('status')).toHaveText('ドラッグ / スワイプで見回す');
        expect(garden()[0].failure).toBeUndefined();
        expect(garden()[0].encodedBytes).toBeGreaterThan(1_000_000);
        expect(garden()[0].durationMs!).toBeGreaterThan(
          (garden()[0].encodedBytes! / ((profile.mbps * 1_000_000) / 8)) * 700,
        );
      } else {
        if (profile.outcome === 'cancel') {
          await switchSceneMode(page, '2Dに切り替え');
        } else {
          await expect(page.getByRole('status')).toContainText('2Dで続けています', { timeout: 35_000 });
        }
        elapsedMs = Date.now() - started;
        if (profile.outcome === 'timeout') {
          expect(elapsedMs).toBeGreaterThanOrEqual(29_000);
          expect(elapsedMs).toBeLessThan(35_000);
        }
        await expect(scene).toHaveCount(0);
        expect(garden()).toHaveLength(0);
        await expect.poll(() => model()[0]?.canceled).toBe(true);
        expect(model()[0].receivedBytes).toBeGreaterThan(0);
        expect(model()[0].encodedBytes).toBeUndefined();
        await cdp.send('Network.emulateNetworkConditionsByRule', { offline: false, matchedNetworkConditions: [] });
        await page.getByRole('button', { name: '外気浴へ', exact: true }).click();
        await expect(page.getByRole('heading', { name: '外気浴', exact: true })).toBeVisible();
        await expect(scene).toHaveCount(0);
        expect(model()).toHaveLength(1);
        if (profile.outcome === 'timeout') {
          await switchSceneMode(page, '2Dに切り替え');
        }
        const retryStarted = Date.now();
        await switchSceneMode(page, '3Dを試す');
        await expect(scene).toHaveAttribute('data-load-ms', /\d+/, { timeout: 20_000 });
        recoveryMs = Date.now() - retryStarted;
        await expect(scene).toHaveAttribute('data-stage', 'totonou');
        expect(model()).toHaveLength(2);
        expect(model()[1].encodedBytes).toBeGreaterThan(1_000_000);
        await expect(scene).toHaveAttribute('data-garden', 'ready', { timeout: 20_000 });
        expect(garden()).toHaveLength(1);
      }
      await expect(scene.locator('canvas')).toHaveCount(1);
      await expect(page.locator('.sound-control')).toHaveAttribute('data-muted', 'true');
      expect([...requests.values()].some((item) => item.cached)).toBe(false);
      expect(errors).toEqual([]);
    } finally {
      await info.attach('network-loading', {
        body: JSON.stringify(
          {
            profile,
            browser: page.context().browser()?.version(),
            viewport: page.viewportSize(),
            elapsedMs,
            internalLoadMs,
            gardenElapsedMs,
            internalGardenMs,
            recoveryMs,
            requests: [...requests.values()],
            errors,
            limitations:
              'Local Vite preview, CDP bandwidth/latency, cache disabled, 2D shell already loaded; no CPU throttle, mobile device, packet loss or production CDN measurement.',
          },
          null,
          2,
        ),
        contentType: 'application/json',
      });
      await cdp.detach();
    }
  });
}
