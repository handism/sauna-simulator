// Check Firefox startup without a server or product page.
// node scripts/diagnose_firefox_launch.mjs <out.json>
import { firefox } from 'playwright';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const out = process.argv[2];
if (!out) throw new Error('usage: diagnose_firefox_launch.mjs <out.json>');
const root = fileURLToPath(new URL('../', import.meta.url));
const hash = (value) => createHash('sha256').update(value).digest('hex');
const report = {
  checkedAt: new Date().toISOString(),
  playwright: JSON.parse(readFileSync(resolve(root, 'node_modules/playwright/package.json'))).version,
  platform: process.platform,
  osVersion:
    process.platform === 'darwin'
      ? execFileSync('/usr/bin/sw_vers', ['-productVersion'], { encoding: 'utf8' }).trim()
      : null,
  architecture: process.arch,
  inputSha256: hash(readFileSync(resolve(root, 'bun.lock'))),
  scriptSha256: hash(readFileSync(fileURLToPath(import.meta.url))),
  probe: 'firefox.launch({ headless: true, timeout: 15000 }); newPage(); setContent(static HTML)',
  appRequested: false,
  pageCreated: false,
  result: 'pending',
};
let browser;
try {
  browser = await firefox.launch({ headless: true, timeout: 15_000 });
  report.browserVersion = browser.version();
  const page = await browser.newPage();
  report.pageCreated = true;
  await page.setContent('<h1>Firefox preflight</h1>');
  if ((await page.locator('h1').textContent()) !== 'Firefox preflight') throw new Error('Static HTML mismatch');
  report.result = 'static HTML passed; product not tested';
} catch (error) {
  const log = String(error);
  mkdirSync(dirname(resolve(out)), { recursive: true });
  writeFileSync(`${out}.log`, log);
  report.result = report.pageCreated ? 'page failed' : 'blocked before page creation';
  report.profileFolderError = log.includes('Could not find profile folder');
  report.logSha256 = hash(log);
  report.errorSummary = report.profileFolderError ? 'Could not find profile folder' : log.split('\n')[0];
  process.exitCode = 1;
} finally {
  await browser?.close();
  mkdirSync(dirname(resolve(out)), { recursive: true });
  writeFileSync(out, JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify(report, null, 2));
}
