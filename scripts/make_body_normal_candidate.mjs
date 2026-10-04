// Diagnostic only: quantize the deployed body's normals without re-exporting Blender
// or filtering any other attribute. Never overwrite the input or a deployed asset.
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, realpathSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { MeshoptEncoder } from 'meshoptimizer/encoder';
import { MeshoptDecoder } from 'meshoptimizer/decoder';

const [output, reportPath] = process.argv.slice(2);
assert(output && reportPath, 'Usage: node scripts/make_body_normal_candidate.mjs candidate.glb report.json');
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
await Promise.all([MeshoptEncoder.ready, MeshoptDecoder.ready]);
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
const input = 'public/models/sauna.glb';
const source = readFileSync(input);
assert.equal(source.readUInt32LE(0), 0x46546c67);
assert.equal(source.readUInt32LE(4), 2);
assert.equal(source.readUInt32LE(8), source.length);
const jsonLength = source.readUInt32LE(12);
const model = JSON.parse(source.subarray(20, 20 + jsonLength));
const original = structuredClone(model);
const binary = source.subarray(28 + jsonLength);
const normalIds = new Set(model.meshes.flatMap((mesh) => mesh.primitives.map((p) => p.attributes.NORMAL)));
assert(!normalIds.has(undefined));
const normalViews = new Map([...normalIds].map((id) => [model.accessors[id].bufferView, id]));
assert.equal(normalViews.size, normalIds.size);
for (const mesh of model.meshes)
  for (const primitive of mesh.primitives)
    for (const [semantic, id] of Object.entries(primitive.attributes))
      if (semantic !== 'NORMAL') assert(!normalViews.has(model.accessors[id].bufferView));
const chunks = [];
let length = 0;
let fallbackLength = 0;
const rows = [];
const append = (bytes) => {
  const offset = length;
  chunks.push(bytes, Buffer.alloc((4 - (bytes.length % 4)) % 4));
  length += Math.ceil(bytes.length / 4) * 4;
  return offset;
};
for (const [id, view] of model.bufferViews.entries()) {
  const ext = view.extensions?.KHR_meshopt_compression;
  const oldBytes = binary.subarray(
    ext?.byteOffset ?? view.byteOffset ?? 0,
    (ext?.byteOffset ?? view.byteOffset ?? 0) + (ext?.byteLength ?? view.byteLength),
  );
  let bytes = oldBytes;
  if (normalViews.has(id)) {
    const accessor = model.accessors[normalViews.get(id)];
    assert(ext && ext.buffer === 0 && ext.mode === 'ATTRIBUTES');
    assert.equal(accessor.componentType, 5126);
    assert.equal(accessor.type, 'VEC3');
    assert(!accessor.sparse && !accessor.byteOffset && !accessor.normalized);
    assert(!accessor.min && !accessor.max, 'Normal bounds need conversion for int8');
    assert.equal(ext.byteStride, 12);
    assert.equal(ext.count, accessor.count);
    assert.equal(view.byteLength, accessor.count * 12);
    const raw = new Uint8Array(view.byteLength);
    MeshoptDecoder.decodeGltfBuffer(raw, ext.count, ext.byteStride, oldBytes, ext.mode, ext.filter);
    const values = new Float32Array(raw.buffer);
    const padded = new Float32Array(accessor.count * 4);
    for (let i = 0; i < accessor.count; i++) padded.set(values.subarray(i * 3, i * 3 + 3), i * 4);
    const filtered = MeshoptEncoder.encodeFilterOct(padded, accessor.count, 4, 8);
    bytes = Buffer.from(MeshoptEncoder.encodeGltfBuffer(filtered, accessor.count, 4, 'ATTRIBUTES', 1));
    const restored = new Int8Array(accessor.count * 4);
    MeshoptDecoder.decodeGltfBuffer(
      new Uint8Array(restored.buffer),
      accessor.count,
      4,
      bytes,
      'ATTRIBUTES',
      'OCTAHEDRAL',
    );
    let maxAngleDegrees = 0;
    for (let i = 0; i < accessor.count; i++) {
      const a = values.subarray(i * 3, i * 3 + 3);
      const b = restored.subarray(i * 4, i * 4 + 3);
      const dot = a.reduce((sum, v, c) => sum + v * b[c], 0) / (Math.hypot(...a) * Math.hypot(...b));
      const angle = (Math.acos(Math.max(-1, Math.min(1, dot))) * 180) / Math.PI;
      assert(Number.isFinite(angle) && angle <= 1.5);
      maxAngleDegrees = Math.max(maxAngleDegrees, angle);
    }
    rows.push({
      accessor: normalViews.get(id),
      count: accessor.count,
      maxAngleDegrees,
      beforeBytes: oldBytes.length,
      afterBytes: bytes.length,
    });
    accessor.componentType = 5120;
    accessor.normalized = true;
    view.byteStride = 4;
    view.byteLength = accessor.count * 4;
    ext.byteStride = 4;
    ext.filter = 'OCTAHEDRAL';
  }
  if (ext) {
    view.byteOffset = fallbackLength;
    fallbackLength += Math.ceil(view.byteLength / 4) * 4;
    ext.byteOffset = append(bytes);
    ext.byteLength = bytes.length;
  } else {
    assert.equal(view.buffer, 0);
    view.byteOffset = append(bytes);
  }
  if (!normalViews.has(id)) assert.deepEqual(bytes, oldBytes);
}
// All scene, material, topology and other accessor metadata stay identical.
for (const key of ['nodes', 'meshes', 'materials', 'textures', 'images', 'scenes'])
  assert.deepEqual(model[key], original[key]);
for (const [id, accessor] of model.accessors.entries())
  if (!normalIds.has(id)) assert.deepEqual(accessor, original.accessors[id]);
assert.equal(model.buffers.length, 2);
model.buffers[0].byteLength = length;
model.buffers[1].byteLength = fallbackLength;
for (const key of ['extensionsUsed', 'extensionsRequired'])
  model[key] = [...new Set([...(model[key] ?? []), 'KHR_mesh_quantization'])];
let json = Buffer.from(JSON.stringify(model));
json = Buffer.concat([json, Buffer.alloc((4 - (json.length % 4)) % 4, 32)]);
const header = Buffer.alloc(20);
header.writeUInt32LE(0x46546c67, 0);
header.writeUInt32LE(2, 4);
header.writeUInt32LE(28 + json.length + length, 8);
header.writeUInt32LE(json.length, 12);
header.writeUInt32LE(0x4e4f534a, 16);
const binHeader = Buffer.alloc(8);
binHeader.writeUInt32LE(length);
binHeader.writeUInt32LE(0x004e4942, 4);
const result = Buffer.concat([header, json, binHeader, ...chunks]);
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
