// Run with Bun: uses the production TypeScript slicer, without writing model assets.
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import * as THREE from 'three';
import { MeshoptDecoder } from 'meshoptimizer/decoder';
import { MeshoptEncoder } from 'meshoptimizer/encoder';
import { sliceUnderwater } from '../src/components/3d/refraction.ts';

await Promise.all([MeshoptDecoder.ready, MeshoptEncoder.ready]);
const [output] = process.argv.slice(2);
assert(output, 'Usage: bun scripts/diagnose_body_normal_slice.mjs report.json');
const hash = (data) => createHash('sha256').update(data).digest('hex');
const path = 'public/models/sauna.glb';
const source = readFileSync(path);
assert.equal(source.readUInt32LE(0), 0x46546c67);
assert.equal(source.readUInt32LE(8), source.length);
const length = source.readUInt32LE(12);
const model = JSON.parse(source.subarray(20, 20 + length));
const binary = source.subarray(28 + length);
const definitionPath = 'public/models/sauna.scene.json';
const definition = readFileSync(definitionPath);
const level = JSON.parse(definition).water.center[1];
const widths = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4 };
const types = { 5123: Uint16Array, 5125: Uint32Array, 5126: Float32Array };
const names = { POSITION: 'position', NORMAL: 'normal', TEXCOORD_0: 'uv', TEXCOORD_1: 'uv1', COLOR_0: 'color' };
const cache = new Map();
function attribute(id) {
  if (cache.has(id)) return cache.get(id).clone();
  const accessor = model.accessors[id];
  assert(!accessor.sparse && !accessor.byteOffset);
  const width = widths[accessor.type];
  const Typed = types[accessor.componentType];
  assert(width && Typed);
  const view = model.bufferViews[accessor.bufferView];
  const ext = view.extensions.KHR_meshopt_compression;
  assert.equal(ext.count, accessor.count);
  assert.equal(ext.byteStride, width * Typed.BYTES_PER_ELEMENT);
  const decoded = new Uint8Array(view.byteLength);
  MeshoptDecoder.decodeGltfBuffer(
    decoded,
    ext.count,
    ext.byteStride,
    binary.subarray(ext.byteOffset, ext.byteOffset + ext.byteLength),
    ext.mode,
    ext.filter,
  );
  const result = new THREE.BufferAttribute(new Typed(decoded.buffer), width, accessor.normalized ?? false);
  for (let i = 0; i < result.count; i++)
    for (let c = 0; c < width; c++) assert(Number.isFinite(result.getComponent(i, c)));
  cache.set(id, result);
  return result.clone();
}
function oct8(normal) {
  const padded = new Float32Array(normal.count * 4);
  for (let i = 0; i < normal.count; i++) for (let c = 0; c < 3; c++) padded[i * 4 + c] = normal.getComponent(i, c);
  const filtered = MeshoptEncoder.encodeFilterOct(padded, normal.count, 4, 8);
  const compressed = MeshoptEncoder.encodeGltfBuffer(filtered, normal.count, 4, 'ATTRIBUTES');
  const restored = new Int8Array(normal.count * 4);
  MeshoptDecoder.decodeGltfBuffer(
    new Uint8Array(restored.buffer),
    normal.count,
    4,
    compressed,
    'ATTRIBUTES',
    'OCTAHEDRAL',
  );
  // GLTFLoader exposes VEC3/stride-4 normals as interleaved normalized int8.
  return new THREE.InterleavedBufferAttribute(new THREE.InterleavedBuffer(restored, 4), 3, 0, true);
}
const rows = [];
const a = new THREE.Vector3();
const b = new THREE.Vector3();
function visit(id, parent) {
  const node = model.nodes[id];
  assert(!node.skin);
  const local = node.matrix
    ? new THREE.Matrix4().fromArray(node.matrix)
    : new THREE.Matrix4().compose(
        new THREE.Vector3().fromArray(node.translation ?? [0, 0, 0]),
        new THREE.Quaternion().fromArray(node.rotation ?? [0, 0, 0, 1]),
        new THREE.Vector3().fromArray(node.scale ?? [1, 1, 1]),
      );
  const world = parent.clone().multiply(local);
  if (node.mesh !== undefined) {
    const mesh = model.meshes[node.mesh];
    for (const [primitiveId, primitive] of mesh.primitives.entries()) {
      assert(!primitive.targets && (primitive.mode ?? 4) === 4);
      const baseline = new THREE.BufferGeometry();
      for (const [semantic, accessor] of Object.entries(primitive.attributes)) {
        assert(names[semantic], `Unsupported ${semantic}`);
        baseline.setAttribute(names[semantic], attribute(accessor));
      }
      if (primitive.indices !== undefined) baseline.setIndex(attribute(primitive.indices));
      const candidate = baseline.clone();
      // prepareModel hides this legacy closed volume before applyRefraction runs.
      const hiddenWater = model.materials[primitive.material]?.name === 'V4 | clear spring water';
      const originalCount = baseline.getAttribute('position').count;
      assert(baseline.getAttribute('normal'));
      candidate.setAttribute('normal', oct8(baseline.getAttribute('normal')));
      const referenceCut = hiddenWater
        ? { triangles: 0, materials: new Set() }
        : sliceUnderwater(baseline, world, level);
      const candidateCut = hiddenWater
        ? { triangles: 0, materials: new Set() }
        : sliceUnderwater(candidate, world, level);
      assert.deepEqual(candidateCut, referenceCut);
      assert.deepEqual(candidate.index?.array, baseline.index?.array);
      assert.deepEqual(candidate.groups, baseline.groups);
      for (const name of Object.keys(baseline.attributes))
        if (name !== 'normal') assert.deepEqual(candidate.getAttribute(name).array, baseline.getAttribute(name).array);
      const normal = candidate.getAttribute('normal');
      assert(normal.normalized);
      assert((normal.isInterleavedBufferAttribute ? normal.data.array : normal.array) instanceof Int8Array);
      const normalMatrix = new THREE.Matrix3().getNormalMatrix(world);
      let maxOriginal = 0;
      let maxInserted = 0;
      let maxWorld = 0;
      let maxLengthError = 0;
      for (let i = 0; i < normal.count; i++) {
        a.fromBufferAttribute(baseline.getAttribute('normal'), i);
        b.fromBufferAttribute(normal, i);
        assert(Number.isFinite(b.length()) && b.length() > 0);
        maxLengthError = Math.max(maxLengthError, Math.abs(b.length() - 1));
        const angle = THREE.MathUtils.radToDeg(a.angleTo(b));
        if (i < originalCount) maxOriginal = Math.max(maxOriginal, angle);
        else maxInserted = Math.max(maxInserted, angle);
        maxWorld = Math.max(
          maxWorld,
          THREE.MathUtils.radToDeg(a.applyMatrix3(normalMatrix).angleTo(b.applyMatrix3(normalMatrix))),
        );
      }
      rows.push({
        node: node.name,
        mesh: mesh.name,
        primitive: primitiveId,
        hiddenWater,
        originalVertices: originalCount,
        insertedVertices: normal.count - originalCount,
        addedTriangles: referenceCut.triangles,
        wetMaterials: [...referenceCut.materials],
        maxOriginalDegrees: maxOriginal,
        maxInsertedDegrees: maxInserted,
        maxWorldDegrees: maxWorld,
        maxLengthError,
        baselineNormalBytes: baseline.getAttribute('normal').array.byteLength,
        candidateNormalBytes: (normal.isInterleavedBufferAttribute ? normal.data.array : normal.array).byteLength,
      });
      baseline.dispose();
      candidate.dispose();
    }
  }
  for (const child of node.children ?? []) visit(child, world);
}
for (const root of model.scenes[model.scene ?? 0].nodes) visit(root, new THREE.Matrix4());
assert.equal(hash(readFileSync(path)), hash(source));
const totals = { primitives: rows.length, slicedPrimitives: rows.filter((r) => r.insertedVertices > 0).length };
for (const key of [
  'originalVertices',
  'insertedVertices',
  'addedTriangles',
  'baselineNormalBytes',
  'candidateNormalBytes',
])
  totals[key] = rows.reduce((sum, r) => sum + r[key], 0);
for (const key of ['maxOriginalDegrees', 'maxInsertedDegrees', 'maxWorldDegrees', 'maxLengthError'])
  totals[key] = Math.max(...rows.map((r) => r[key]));
writeFileSync(
  output,
  JSON.stringify(
    {
      path,
      sha256: hash(source),
      definitionSha256: hash(definition),
      level,
      scriptSha256: hash(readFileSync(new URL(import.meta.url))),
      slicerSha256: hash(readFileSync('src/components/3d/refraction.ts')),
      method:
        'Decoded active-scene primitives; oct8 roundtrip followed by production sliceUnderwater. Exact topology and non-normal attributes. CPU backing bytes only; no images, WebGL allocation or driver measurement.',
      totals,
      rows,
    },
    null,
    2,
  ) + '\n',
);
console.log(JSON.stringify(totals, null, 2));
