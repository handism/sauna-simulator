// Diagnostic only: split uint32 triangles without changing any referenced vertex bytes.
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, realpathSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { createHash } from 'node:crypto';
import { MeshoptDecoder } from 'meshoptimizer/decoder';
import { MeshoptEncoder } from 'meshoptimizer/encoder';

const [output, reportPath, input = 'public/models/sauna-garden.glb'] = process.argv.slice(2);
assert(output && reportPath, 'Usage: node scripts/make_garden_index_candidate.mjs output.glb report.json [input.glb]');
const publicRoot = realpathSync('public');
for (const path of [output, reportPath]) {
  const target = resolve(path);
  assert.notEqual(target, resolve(input));
  const parent = realpathSync(dirname(target));
  assert(parent !== publicRoot && !parent.startsWith(publicRoot + '/'));
  try {
    const existing = realpathSync(target);
    assert.notEqual(existing, realpathSync(input));
    assert(existing !== publicRoot && !existing.startsWith(publicRoot + '/'));
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
}
assert.notEqual(resolve(output), resolve(reportPath));
await Promise.all([MeshoptDecoder.ready, MeshoptEncoder.ready]);
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
const source = readFileSync(input);
assert.equal(source.readUInt32LE(0), 0x46546c67);
assert.equal(source.readUInt32LE(4), 2);
assert.equal(source.readUInt32LE(8), source.length);
const jsonLength = source.readUInt32LE(12);
const model = JSON.parse(source.subarray(20, 20 + jsonLength));
const original = structuredClone(model);
const binary = source.subarray(28 + jsonLength);
const payloads = model.bufferViews.map((view) => {
  const ext = view.extensions.KHR_meshopt_compression;
  assert.equal(ext.buffer, 0);
  return binary.subarray(ext.byteOffset, ext.byteOffset + ext.byteLength);
});
const decode = (id) => {
  const accessor = model.accessors[id];
  assert(!accessor.sparse && !accessor.byteOffset);
  const view = model.bufferViews[accessor.bufferView];
  const ext = view.extensions.KHR_meshopt_compression;
  assert.equal(ext.count, accessor.count);
  const bytes = new Uint8Array(view.byteLength);
  MeshoptDecoder.decodeGltfBuffer(
    bytes,
    ext.count,
    ext.byteStride,
    payloads[accessor.bufferView],
    ext.mode,
    ext.filter,
  );
  const filtered = new Uint8Array(view.byteLength);
  MeshoptDecoder.decodeGltfBuffer(filtered, ext.count, ext.byteStride, payloads[accessor.bufferView], ext.mode, 'NONE');
  return { bytes, filtered, filter: ext.filter ?? 'NONE', stride: ext.byteStride };
};
const add = (sourceId, bytes, count, stride, mode, bounds, filtered = bytes, filter = 'NONE') => {
  const encoded = MeshoptEncoder.encodeGltfBuffer(filtered, count, stride, mode, 1);
  const restored = new Uint8Array(bytes.length);
  MeshoptDecoder.decodeGltfBuffer(restored, count, stride, encoded, mode, filter);
  assert.deepEqual(restored, bytes);
  const viewId = model.bufferViews.length;
  model.bufferViews.push({
    buffer: 1,
    byteLength: bytes.length,
    ...(mode === 'ATTRIBUTES' ? { byteStride: stride } : {}),
    extensions: {
      KHR_meshopt_compression: {
        buffer: 0,
        byteLength: encoded.length,
        byteStride: stride,
        count,
        mode,
        filter,
      },
    },
  });
  payloads.push(encoded);
  const accessor = { ...model.accessors[sourceId], bufferView: viewId, count };
  if (mode === 'INDICES') accessor.componentType = 5123;
  if (bounds) Object.assign(accessor, bounds);
  model.accessors.push(accessor);
  return model.accessors.length - 1;
};
const rows = [];
for (const mesh of model.meshes) {
  mesh.primitives = mesh.primitives.flatMap((primitive) => {
    const accessor = model.accessors[primitive.indices];
    if (accessor.componentType !== 5125) return [primitive];
    assert.equal(primitive.mode ?? 4, 4);
    assert(!primitive.targets && !primitive.extensions, 'Unsupported primitive metadata');
    const raw = decode(primitive.indices).bytes;
    const indices = new Uint32Array(raw.buffer);
    assert.equal(indices.length % 3, 0);
    const attributes = Object.entries(primitive.attributes).map(([semantic, id]) => ({ semantic, id, ...decode(id) }));
    const vertexCount = model.accessors[primitive.attributes.POSITION].count;
    const batches = [];
    let map = new Map();
    let localIndices = [];
    const flush = () => {
      if (!localIndices.length) return;
      const ids = [...map.keys()];
      const attrs = {};
      for (const attr of attributes) {
        assert.equal(model.accessors[attr.id].count, vertexCount);
        const bytes = new Uint8Array(ids.length * attr.stride);
        const filtered = new Uint8Array(bytes.length);
        ids.forEach((id, local) =>
          filtered.set(attr.filtered.subarray(id * attr.stride, (id + 1) * attr.stride), local * attr.stride),
        );
        ids.forEach((id, local) =>
          bytes.set(attr.bytes.subarray(id * attr.stride, (id + 1) * attr.stride), local * attr.stride),
        );
        let bounds;
        if (attr.semantic === 'POSITION') {
          assert.equal(model.accessors[attr.id].componentType, 5126);
          assert.equal(attr.stride, 12);
          const values = new Float32Array(bytes.buffer);
          const min = [Infinity, Infinity, Infinity],
            max = [-Infinity, -Infinity, -Infinity];
          for (let i = 0; i < values.length; i++) {
            assert(Number.isFinite(values[i]));
            min[i % 3] = Math.min(min[i % 3], values[i]);
            max[i % 3] = Math.max(max[i % 3], values[i]);
          }
          bounds = { min, max };
        } else assert(!model.accessors[attr.id].min && !model.accessors[attr.id].max);
        attrs[attr.semantic] = add(
          attr.id,
          bytes,
          ids.length,
          attr.stride,
          'ATTRIBUTES',
          bounds,
          filtered,
          attr.filter,
        );
      }
      const local = new Uint16Array(localIndices);
      // Verify each triangle corner's index and every attribute against the original stream.
      const start = batches.reduce((sum, b) => sum + b.indexCount, 0);
      for (let i = 0; i < local.length; i++) assert.equal(ids[local[i]], indices[start + i]);
      const indexId = add(primitive.indices, new Uint8Array(local.buffer), local.length, 2, 'INDICES', {
        min: [0],
        max: [ids.length - 1],
      });
      batches.push({
        primitive: { ...primitive, attributes: attrs, indices: indexId },
        vertices: ids.length,
        indexCount: local.length,
      });
      map = new Map();
      localIndices = [];
    };
    for (let i = 0; i < indices.length; i += 3) {
      const triangle = [...indices.subarray(i, i + 3)];
      triangle.forEach((id) => assert(id < vertexCount));
      if (map.size + new Set(triangle.filter((id) => !map.has(id))).size > 65535) flush();
      for (const id of triangle) {
        if (!map.has(id)) map.set(id, map.size);
        localIndices.push(map.get(id));
      }
    }
    flush();
    rows.push({
      mesh: mesh.name,
      originalVertices: vertexCount,
      originalIndexBytes: raw.length,
      batches: batches.map(({ vertices, indexCount }) => ({ vertices, indexCount })),
      addedVertices: batches.reduce((sum, b) => sum + b.vertices, 0) - vertexCount,
    });
    return batches.map((b) => b.primitive);
  });
}
// Remove unreachable original accessors/views so the candidate really saves buffers.
const used = new Set(
  model.meshes.flatMap((mesh) => mesh.primitives.flatMap((p) => [p.indices, ...Object.values(p.attributes)])),
);
const accessorMap = new Map([...used].map((id, index) => [id, index]));
model.accessors = [...used].map((id) => model.accessors[id]);
for (const mesh of model.meshes)
  for (const p of mesh.primitives) {
    p.indices = accessorMap.get(p.indices);
    p.attributes = Object.fromEntries(Object.entries(p.attributes).map(([key, id]) => [key, accessorMap.get(id)]));
  }
const views = [...new Set(model.accessors.map((a) => a.bufferView))];
const viewMap = new Map(views.map((id, index) => [id, index]));
const chunks = [];
let length = 0;
let fallbackLength = 0;
model.bufferViews = views.map((id) => {
  const view = model.bufferViews[id];
  const ext = view.extensions.KHR_meshopt_compression;
  const bytes = payloads[id];
  view.byteOffset = fallbackLength;
  fallbackLength += Math.ceil(view.byteLength / 4) * 4;
  ext.byteOffset = length;
  chunks.push(bytes, Buffer.alloc((4 - (bytes.length % 4)) % 4));
  length += Math.ceil(bytes.length / 4) * 4;
  return view;
});
for (const a of model.accessors) a.bufferView = viewMap.get(a.bufferView);
assert.equal(model.buffers.length, 2);
model.buffers[0].byteLength = length;
model.buffers[1].byteLength = fallbackLength;
for (const key of ['nodes', 'materials', 'textures', 'images', 'scenes']) assert.deepEqual(model[key], original[key]);
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
  inputSha256: hash(source),
  outputSha256: hash(result),
  scriptSha256: hash(readFileSync(new URL(import.meta.url))),
  inputBytes: source.length,
  outputBytes: result.length,
  decodedBeforeBytes: original.bufferViews.reduce((n, v) => n + v.byteLength, 0),
  decodedAfterBytes: model.bufferViews.reduce((n, v) => n + v.byteLength, 0),
  rows,
  note: 'Triangle order and decoded vertex bytes preserved; split bounds recomputed. Driver memory, visual equality and GPU time require browser checks.',
};
writeFileSync(reportPath, JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify(report));
