// Diagnostic only: quantize the deployed body's normals without re-exporting Blender
// or filtering any other attribute. Never overwrite the input or a deployed asset.
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, realpathSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { quantizeBodyNormals } from './body_normal_oct.mjs';

const [output, reportPath, input = 'public/models/sauna.glb'] = process.argv.slice(2);
assert(
  output && reportPath,
  'Usage: node scripts/make_body_normal_candidate.mjs candidate.glb report.json [input.glb]',
);
for (const path of [output, reportPath]) {
  const target = resolve(path);
  assert(!target.startsWith(resolve('public') + '/'), 'Diagnostic outputs must be outside public/');
  const publicRoot = realpathSync('public');
  const parent = realpathSync(dirname(target));
  assert(parent !== publicRoot && !parent.startsWith(publicRoot + '/'), 'Output parent points into public/');
  try {
    assert(!realpathSync(target).startsWith(realpathSync('public') + '/'), 'Output symlink points into public/');
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
}
assert.notEqual(resolve(output), resolve(reportPath));
assert.notEqual(resolve(output), resolve(input));
assert.notEqual(resolve(reportPath), resolve(input));
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
const source = readFileSync(input);
const { result, rows } = await quantizeBodyNormals(source);
assert.equal(hash(readFileSync(input)), hash(source));
writeFileSync(output, result);
const report = {
  input,
  inputSha256: hash(source),
  outputSha256: hash(result),
  inputBytes: source.length,
  outputBytes: result.length,
  scriptSha256: hash(readFileSync(new URL(import.meta.url))),
  rows,
  note: 'Only NORMAL payloads and required layout/extension metadata changed. Non-normal payloads are byte-exact. Local angular bound only; world transform and visual quality are separate checks.',
};
writeFileSync(reportPath, JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify({ inputBytes: source.length, outputBytes: result.length, normals: rows.length }));
