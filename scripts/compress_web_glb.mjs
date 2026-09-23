// Narrow postprocessor for our Blender export. Preserve scene/material metadata,
// images, topology and attribute order; fail on layouts we have not verified.
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { MeshoptEncoder } from 'meshoptimizer/encoder';
import { MeshoptDecoder } from 'meshoptimizer/decoder';

const [input, output, reportPath, bitsArgument] = process.argv.slice(2);
assert(
  input && output && reportPath,
  'Usage: node scripts/compress_web_glb.mjs input.glb output.glb report.json [float-bits]',
);
const bits = bitsArgument === undefined ? null : Number(bitsArgument);
assert(bits === null || (Number.isInteger(bits) && bits >= 16 && bits <= 24));
await Promise.all([MeshoptEncoder.ready, MeshoptDecoder.ready]);
const source = readFileSync(input);
assert.equal(source.readUInt32LE(0), 0x46546c67);
assert.equal(source.readUInt32LE(4), 2);
assert.equal(source.readUInt32LE(8), source.length);
const jsonLength = source.readUInt32LE(12);
const model = JSON.parse(source.subarray(20, 20 + jsonLength));
assert.equal(model.buffers.length, 1);
assert(!model.extensionsUsed?.includes('EXT_meshopt_compression'), 'Input is already compressed');
const binary = source.subarray(28 + jsonLength);
const chunks = [];
let byteLength = 0;
let fallbackLength = 0;
const append = (bytes) => {
  const offset = byteLength;
  chunks.push(bytes);
  const padding = Buffer.alloc((4 - (bytes.length % 4)) % 4);
  chunks.push(padding);
  byteLength += bytes.length + padding.length;
  return offset;
};
const widths = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4 };
const sizes = { 5123: 2, 5125: 4, 5126: 4 };
const imageViews = new Set(model.images.map((image) => image.bufferView));
const verification = { compressedViews: 0, exactViews: 0, imageViews: imageViews.size, maxAbsoluteError: {} };
for (const [index, view] of model.bufferViews.entries()) {
  assert.equal(view.buffer, 0);
  assert(!view.extensions);
  const bytes = binary.subarray(view.byteOffset ?? 0, (view.byteOffset ?? 0) + view.byteLength);
  assert.equal(bytes.length, view.byteLength);
  if (imageViews.has(index)) {
    view.byteOffset = append(bytes);
    continue;
  }
  const accessors = model.accessors.filter((accessor) => accessor.bufferView === index);
  assert.equal(accessors.length, 1);
  const accessor = accessors[0];
  assert(!accessor.sparse && !accessor.byteOffset && !view.byteStride);
  const stride = widths[accessor.type] * sizes[accessor.componentType];
  assert.equal(stride * accessor.count, bytes.length);
  // INDICES preserves index bytes exactly (TRIANGLES may rotate each triangle).
  const mode = accessor.type === 'SCALAR' ? 'INDICES' : 'ATTRIBUTES';
  const filter = bits !== null && accessor.componentType === 5126 ? 'EXPONENTIAL' : 'NONE';
  const encodedInput =
    filter === 'EXPONENTIAL'
      ? MeshoptEncoder.encodeFilterExp(
          new Float32Array(bytes.buffer, bytes.byteOffset, bytes.length / 4),
          accessor.count,
          stride,
          bits,
          'Separate',
        )
      : bytes;
  const compressed = MeshoptEncoder.encodeGltfBuffer(encodedInput, accessor.count, stride, mode, 0);
  const decoded = new Uint8Array(bytes.length);
  MeshoptDecoder.decodeGltfBuffer(decoded, accessor.count, stride, compressed, mode, filter);
  if (filter === 'NONE') {
    assert.deepEqual(Buffer.from(decoded), bytes, `Round-trip mismatch in view ${index}`);
    verification.exactViews++;
  } else {
    const original = new Float32Array(bytes.buffer, bytes.byteOffset, bytes.length / 4);
    const restored = new Float32Array(decoded.buffer);
    let maximum = 0;
    for (let i = 0; i < original.length; i++) {
      assert(Number.isFinite(restored[i]));
      maximum = Math.max(maximum, Math.abs(original[i] - restored[i]));
    }
    const kind = accessor.type;
    verification.maxAbsoluteError[kind] = Math.max(verification.maxAbsoluteError[kind] ?? 0, maximum);
    // Bounds must describe quantized positions too.
    for (const [key, operation] of [
      ['min', Math.min],
      ['max', Math.max],
    ]) {
      if (!accessor[key]) continue;
      accessor[key] = accessor[key].map((_, component) => {
        let value = key === 'min' ? Infinity : -Infinity;
        for (let i = component; i < restored.length; i += widths[kind]) value = operation(value, restored[i]);
        return value;
      });
    }
  }
  view.buffer = 1;
  view.byteOffset = fallbackLength;
  fallbackLength += bytes.length;
  fallbackLength = Math.ceil(fallbackLength / 4) * 4;
  view.extensions = {
    EXT_meshopt_compression: {
      buffer: 0,
      byteOffset: append(Buffer.from(compressed)),
      byteLength: compressed.length,
      byteStride: stride,
      count: accessor.count,
      mode,
      filter,
    },
  };
  verification.compressedViews++;
}
model.buffers = [
  { byteLength },
  { byteLength: fallbackLength, extensions: { EXT_meshopt_compression: { fallback: true } } },
];
for (const key of ['extensionsUsed', 'extensionsRequired'])
  model[key] = [...(model[key] ?? []), 'EXT_meshopt_compression'];
let json = Buffer.from(JSON.stringify(model));
json = Buffer.concat([json, Buffer.alloc((4 - (json.length % 4)) % 4, 32)]);
const header = Buffer.alloc(20);
header.writeUInt32LE(0x46546c67, 0);
header.writeUInt32LE(2, 4);
header.writeUInt32LE(28 + json.length + byteLength, 8);
header.writeUInt32LE(json.length, 12);
header.writeUInt32LE(0x4e4f534a, 16);
const binHeader = Buffer.alloc(8);
binHeader.writeUInt32LE(byteLength);
binHeader.writeUInt32LE(0x004e4942, 4);
const result = Buffer.concat([header, json, binHeader, ...chunks]);
const hash = (data) => createHash('sha256').update(data).digest('hex');
writeFileSync(output, result);
writeFileSync(
  reportPath,
  JSON.stringify(
    {
      codec: 'meshoptimizer 1.1.1',
      extension: 'EXT_meshopt_compression',
      version: 0,
      floatBits: bits,
      inputBytes: source.length,
      outputBytes: result.length,
      inputSha256: hash(source),
      outputSha256: hash(result),
      verification,
    },
    null,
    2,
  ) + '\n',
);
console.log(`${source.length} -> ${result.length} bytes (${bits ?? 'lossless'})`);
