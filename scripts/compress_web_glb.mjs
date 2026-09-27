// Narrow postprocessor for our Blender export. Preserve scene/material metadata,
// images, topology and attribute order; fail on layouts we have not verified.
// Positions, normals and UVs go through the exponential filter at the fewest mantissa bits
// that keep every vertex within TOLERANCE (outputs stay float32, so accessors are unchanged);
// indices, colors and images stay byte-exact. `--lossless` skips the filters.
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { MeshoptEncoder } from 'meshoptimizer/encoder';
import { MeshoptDecoder } from 'meshoptimizer/decoder';

const EXTENSION = 'KHR_meshopt_compression';
const VERSION = 1;
// World metres for positions, degrees for normals, UV units (1/8192: 1/8 texel at 1024 px).
const TOLERANCE = { POSITION: 1e-4, NORMAL: 0.1, TEXCOORD_0: 1 / 8192, TEXCOORD_1: 1 / 8192 };
// Normals are unit vectors: one exponent per vector. Positions/UVs: one per component.
const EXP_MODE = {
  POSITION: 'SharedComponent',
  NORMAL: 'SharedVector',
  TEXCOORD_0: 'SharedComponent',
  TEXCOORD_1: 'SharedComponent',
};

const args = process.argv.slice(2);
const lossless = args.includes('--lossless');
const [input, output, reportPath] = args.filter((arg) => arg !== '--lossless');
assert(
  input && output && reportPath && args.length <= 4,
  'Usage: node scripts/compress_web_glb.mjs input.glb output.glb report.json [--lossless]',
);
await Promise.all([MeshoptEncoder.ready, MeshoptDecoder.ready]);
const source = readFileSync(input);
assert.equal(source.readUInt32LE(0), 0x46546c67);
assert.equal(source.readUInt32LE(4), 2);
assert.equal(source.readUInt32LE(8), source.length);
const jsonLength = source.readUInt32LE(12);
const model = JSON.parse(source.subarray(20, 20 + jsonLength));
assert.equal(model.buffers.length, 1);
for (const name of ['EXT_meshopt_compression', EXTENSION])
  assert(!model.extensionsUsed?.includes(name), 'Input is already compressed');
const binary = source.subarray(28 + jsonLength);

// Which attribute each accessor holds, and the largest world scale it is drawn at.
const semantics = new Map();
const worldScale = new Map();
const mark = (accessor, semantic) => {
  assert(
    !semantics.has(accessor) || semantics.get(accessor) === semantic,
    `Accessor ${accessor} is shared across semantics`,
  );
  semantics.set(accessor, semantic);
};
for (const mesh of model.meshes)
  for (const primitive of mesh.primitives) {
    assert(!primitive.targets, 'Morph targets are not supported');
    for (const [semantic, accessor] of Object.entries(primitive.attributes)) mark(accessor, semantic);
    if (primitive.indices !== undefined) mark(primitive.indices, 'INDICES');
  }
const visit = (index, parentScale) => {
  const node = model.nodes[index];
  assert(!node.matrix, 'Node matrices are not supported');
  const scale = parentScale * Math.max(...(node.scale ?? [1, 1, 1]).map(Math.abs));
  if (node.mesh !== undefined)
    for (const primitive of model.meshes[node.mesh].primitives)
      for (const accessor of Object.values(primitive.attributes))
        worldScale.set(accessor, Math.max(worldScale.get(accessor) ?? 0, scale));
  for (const child of node.children ?? []) visit(child, scale);
};
for (const scene of model.scenes) for (const root of scene.nodes) visit(root, 1);

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
const verification = {
  compressedViews: 0,
  exactViews: 0,
  filteredViews: 0,
  imageViews: imageViews.size,
  bits: {},
  maxError: {},
};

// Largest error of a decoded attribute in the unit of its tolerance.
function error(semantic, original, restored, count, scale) {
  let maximum = 0;
  for (let i = 0; i < count; i++) {
    let value;
    if (semantic === 'NORMAL') {
      let dot = 0;
      let a = 0;
      let b = 0;
      for (let c = 0; c < 3; c++) {
        dot += original[i * 3 + c] * restored[i * 3 + c];
        a += original[i * 3 + c] ** 2;
        b += restored[i * 3 + c] ** 2;
      }
      value = (Math.acos(Math.min(1, dot / Math.sqrt(a * b))) * 180) / Math.PI;
    } else if (semantic === 'POSITION') {
      value = scale * Math.hypot(...[0, 1, 2].map((c) => original[i * 3 + c] - restored[i * 3 + c]));
    } else {
      value = Math.max(...[0, 1].map((c) => Math.abs(original[i * 2 + c] - restored[i * 2 + c])));
    }
    assert(Number.isFinite(value), `Non-finite ${semantic}`);
    maximum = Math.max(maximum, value);
  }
  return maximum;
}

function encode(bytes, count, stride, mode) {
  const compressed = MeshoptEncoder.encodeGltfBuffer(bytes, count, stride, mode, VERSION);
  const decoded = new Uint8Array(bytes.length);
  MeshoptDecoder.decodeGltfBuffer(decoded, count, stride, compressed, mode, 'NONE');
  return { compressed, decoded };
}

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
  const accessorIndex = model.accessors.indexOf(accessor);
  assert(!accessor.sparse && !accessor.byteOffset && !view.byteStride);
  const stride = widths[accessor.type] * sizes[accessor.componentType];
  assert.equal(stride * accessor.count, bytes.length);
  const semantic = semantics.get(accessorIndex);
  assert(semantic, `View ${index} is not used by a mesh`);
  // INDICES preserves index bytes exactly (TRIANGLES may rotate each triangle).
  const mode = semantic === 'INDICES' ? 'INDICES' : 'ATTRIBUTES';
  const exact = encode(bytes, accessor.count, stride, mode);
  assert.deepEqual(Buffer.from(exact.decoded), bytes, `Round-trip mismatch in view ${index}`);
  let compressed = exact.compressed;
  let filter = 'NONE';
  const tolerance = TOLERANCE[semantic];
  if (!lossless && tolerance !== undefined) {
    assert.equal(accessor.componentType, 5126);
    const original = new Float32Array(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.length));
    for (let bits = 8; bits <= 23; bits++) {
      const filtered = MeshoptEncoder.encodeFilterExp(original, accessor.count, stride, bits, EXP_MODE[semantic]);
      const candidate = MeshoptEncoder.encodeGltfBuffer(filtered, accessor.count, stride, mode, VERSION);
      const decoded = new Uint8Array(bytes.length);
      MeshoptDecoder.decodeGltfBuffer(decoded, accessor.count, stride, candidate, mode, 'EXPONENTIAL');
      const restored = new Float32Array(decoded.buffer);
      const measured = error(semantic, original, restored, accessor.count, worldScale.get(accessorIndex) ?? 1);
      if (measured > tolerance) continue;
      if (candidate.length < compressed.length) {
        compressed = candidate;
        filter = 'EXPONENTIAL';
        verification.bits[semantic] ??= {};
        verification.bits[semantic][bits] = (verification.bits[semantic][bits] ?? 0) + 1;
        verification.maxError[semantic] = Math.max(verification.maxError[semantic] ?? 0, measured);
        // Bounds must describe the decoded positions.
        for (const [key, operation] of [
          ['min', Math.min],
          ['max', Math.max],
        ]) {
          if (!accessor[key]) continue;
          const width = widths[accessor.type];
          accessor[key] = accessor[key].map((_, component) => {
            let value = key === 'min' ? Infinity : -Infinity;
            for (let i = component; i < restored.length; i += width) value = operation(value, restored[i]);
            return value;
          });
        }
      }
      break;
    }
  }
  if (filter === 'NONE') verification.exactViews++;
  else verification.filteredViews++;
  view.buffer = 1;
  view.byteOffset = fallbackLength;
  fallbackLength += bytes.length;
  fallbackLength = Math.ceil(fallbackLength / 4) * 4;
  view.extensions = {
    [EXTENSION]: {
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
model.buffers = [{ byteLength }, { byteLength: fallbackLength, extensions: { [EXTENSION]: { fallback: true } } }];
for (const key of ['extensionsUsed', 'extensionsRequired']) model[key] = [...(model[key] ?? []), EXTENSION];
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
      extension: EXTENSION,
      version: VERSION,
      filter: lossless ? null : { name: 'EXPONENTIAL', mode: EXP_MODE, tolerance: TOLERANCE },
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
console.log(`${source.length} -> ${result.length} bytes (${lossless ? 'lossless' : 'filtered'})`);
