// Read-only decoded attribute inventory; oct-normal candidate is never written to the GLB.
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { MeshoptDecoder } from 'meshoptimizer/decoder';
import { MeshoptEncoder } from 'meshoptimizer/encoder';
await Promise.all([MeshoptDecoder.ready, MeshoptEncoder.ready]);
const [output] = process.argv.slice(2);
assert(output, 'Usage: node scripts/diagnose_glb_attributes.mjs report.json');
const hash = (data) => createHash('sha256').update(data).digest('hex');
const path = 'public/models/sauna.glb';
const source = readFileSync(path);
assert.equal(source.readUInt32LE(0), 0x46546c67);
assert.equal(source.readUInt32LE(8), source.length);
const length = source.readUInt32LE(12);
const model = JSON.parse(source.subarray(20, 20 + length));
const binary = source.subarray(28 + length);
const rows = [];
const seen = new Set();
for (const mesh of model.meshes) {
  for (const primitive of mesh.primitives) {
    for (const [semantic, id] of Object.entries(primitive.attributes)) {
      if (seen.has(id)) continue;
      seen.add(id);
      const accessor = model.accessors[id];
      assert(!accessor.sparse && !accessor.byteOffset);
      assert([5123, 5126].includes(accessor.componentType));
      const bytes = accessor.componentType === 5126 ? 4 : 2;
      const width = { VEC2: 2, VEC3: 3, VEC4: 4 }[accessor.type];
      assert(width);
      const view = model.bufferViews[accessor.bufferView];
      const ext = view.extensions.KHR_meshopt_compression;
      assert.equal(ext.byteStride, width * bytes);
      assert.equal(ext.count, accessor.count);
      const decoded = new Uint8Array(view.byteLength);
      MeshoptDecoder.decodeGltfBuffer(
        decoded,
        ext.count,
        ext.byteStride,
        binary.subarray(ext.byteOffset, ext.byteOffset + ext.byteLength),
        ext.mode,
        ext.filter,
      );
      const raw = bytes === 4 ? new Float32Array(decoded.buffer) : new Uint16Array(decoded.buffer);
      const values = Float32Array.from(raw, (v) => (accessor.normalized ? v / 65535 : v));
      assert.equal(values.length, accessor.count * width);
      const min = Array(width).fill(Infinity);
      const max = Array(width).fill(-Infinity);
      for (let i = 0; i < values.length; i++) {
        assert(Number.isFinite(values[i]));
        min[i % width] = Math.min(min[i % width], values[i]);
        max[i % width] = Math.max(max[i % width], values[i]);
      }
      const row = {
        mesh: mesh.name,
        semantic,
        accessor: id,
        componentType: accessor.componentType,
        normalized: accessor.normalized ?? false,
        count: accessor.count,
        decodedBytes: decoded.length,
        compressedBytes: ext.byteLength,
        min,
        max,
      };
      if (semantic === 'NORMAL') {
        assert.equal(accessor.componentType, 5126);
        assert.equal(width, 3);
        const padded = new Float32Array(accessor.count * 4);
        for (let i = 0; i < accessor.count; i++) padded.set(values.subarray(i * 3, i * 3 + 3), i * 4);
        const filtered = MeshoptEncoder.encodeFilterOct(padded, accessor.count, 4, 8);
        const compressed = MeshoptEncoder.encodeGltfBuffer(filtered, accessor.count, 4, 'ATTRIBUTES');
        const restored = new Int8Array(accessor.count * 4);
        MeshoptDecoder.decodeGltfBuffer(
          new Uint8Array(restored.buffer),
          accessor.count,
          4,
          compressed,
          'ATTRIBUTES',
          'OCTAHEDRAL',
        );
        let maxAngle = 0;
        for (let i = 0; i < accessor.count; i++) {
          const a = [...values.subarray(i * 3, i * 3 + 3)];
          const b = [...restored.subarray(i * 4, i * 4 + 3)];
          const denom = Math.hypot(...a) * Math.hypot(...b);
          assert(denom > 0);
          const dot = a.reduce((sum, v, c) => sum + v * b[c], 0) / denom;
          maxAngle = Math.max(maxAngle, (Math.acos(Math.max(-1, Math.min(1, dot))) * 180) / Math.PI);
        }
        row.oct8 = { decodedBytes: accessor.count * 4, compressedBytes: compressed.length, maxAngleDegrees: maxAngle };
      }
      rows.push(row);
    }
  }
}
assert.equal(hash(readFileSync(path)), hash(source));
const totals = {};
for (const row of rows) {
  const total = (totals[row.semantic] ??= { count: 0, decodedBytes: 0, compressedBytes: 0 });
  total.count += row.count;
  total.decodedBytes += row.decodedBytes;
  total.compressedBytes += row.compressedBytes;
  if (row.oct8) {
    total.oct8DecodedBytes = (total.oct8DecodedBytes ?? 0) + row.oct8.decodedBytes;
    total.oct8CompressedBytes = (total.oct8CompressedBytes ?? 0) + row.oct8.compressedBytes;
    total.maxAngleDegrees = Math.max(total.maxAngleDegrees ?? 0, row.oct8.maxAngleDegrees);
  }
}
writeFileSync(
  output,
  JSON.stringify(
    {
      path,
      sha256: hash(source),
      scriptSha256: hash(readFileSync(new URL(import.meta.url))),
      method:
        'Unique accessors, decoded finite values. Oct8 roundtrip only; excludes runtime subdivision, driver allocation and visual validation.',
      totals,
      rows,
    },
    null,
    2,
  ) + '\n',
);
console.log(JSON.stringify(totals, null, 2));
