import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import type { Page } from '@playwright/test';

// Substitute only the body's HTTP response, keeping deployed files and builds intact.
export async function useModelCandidate(page: Page) {
  const path = process.env.QA_BODY_MODEL;
  if (!path) return null;
  const bytes = await readFile(path);
  let requests = 0;
  await page.route('**/sauna.glb', async (route) => {
    requests++;
    await route.fulfill({ body: bytes, contentType: 'model/gltf-binary' });
  });
  return { sha256: createHash('sha256').update(bytes).digest('hex'), bytes: bytes.length, requests: () => requests };
}
