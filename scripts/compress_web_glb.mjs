// Narrow postprocessor for our Blender export. Preserve scene/material metadata,
// images, topology and attribute order; fail on layouts we have not verified.
// Positions, normals and UVs go through the exponential filter at the fewest mantissa bits
// that keep every vertex within TOLERANCE (outputs stay float32, so accessors are unchanged);
// indices, colors and images stay byte-exact. `--lossless` skips the filters.
// `--garden path` moves the GARDEN nodes into a second GLB that the browser loads after the
// scene is ready (SaunaScene.tsx): they are most of the bytes and none of the architecture.
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
// Tree foliage, ferns and the overhead bough: above and away from the water, without textures.
// The browser redraws the static shadows when they arrive (the maple uplight's falls on them).
const GARDEN = [
  'Fine canopy leaves',
  'V6 clustered tree leaves',
  'Woodland fern',
  'V5 overhead canopy bough',
  'V11 maple clustered lobed foliage 0',
  'V11 maple clustered lobed foliage 1',
  'V11 maple clustered lobed foliage 2',
];

const args = process.argv.slice(2);
const lossless = args.includes('--lossless');
const gardenFlag = args.indexOf('--garden');
const gardenPath = gardenFlag < 0 ? undefined : args[gardenFlag + 1];
const positional = args.filter(
  (arg, i) => arg !== '--lossless' && (gardenFlag < 0 || (i !== gardenFlag && i !== gardenFlag + 1)),
);
const [input, output, reportPath] = positional;
assert(
  input && output && reportPath && positional.length === 3 && (gardenFlag < 0 || gardenPath),
  'Usage: node scripts/compress_web_glb.mjs input.glb output.glb report.json [--garden garden.glb] [--lossless]',
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

// Copies the nodes that `keep` selects, with only what they use, into a model and binary of
// their own. Scene roots only (the export has no hierarchy); meshes may not cross the split.
function subset(keep) {
  const map = (list, used) => {
    const indices = [...used].sort((a, b) => a - b);
    return { items: indices.map((i) => structuredClone(list[i])), index: new Map(indices.map((old, i) => [old, i])) };
  };
  const roots = model.scenes[model.scene ?? 0].nodes;
  assert.equal(model.scenes.length, 1);
  assert.equal(roots.length, model.nodes.length);
  assert(model.nodes.every((node) => !node.children));
  const nodes = roots.filter((i) => keep(model.nodes[i]));
  const meshes = new Set(nodes.flatMap((i) => model.nodes[i].mesh ?? []));
  for (const [i, node] of model.nodes.entries())
    if (node.mesh !== undefined && meshes.has(node.mesh)) assert(nodes.includes(i), 'Mesh shared across the split');
  const materials = new Set();
  const accessors = new Set();
  for (const mesh of meshes)
    for (const primitive of model.meshes[mesh].primitives) {
      if (primitive.material !== undefined) materials.add(primitive.material);
      for (const accessor of Object.values(primitive.attributes)) accessors.add(accessor);
      if (primitive.indices !== undefined) accessors.add(primitive.indices);
    }
  // Texture references are objects with an `index` under a key ending in 'Texture'.
  const textureRefs = (value, found = []) => {
    if (value && typeof value === 'object')
      for (const [key, child] of Object.entries(value)) {
        if (/Texture$/.test(key) && child && typeof child.index === 'number') found.push(child);
        textureRefs(child, found);
      }
    return found;
  };
  const textures = new Set([...materials].flatMap((i) => textureRefs(model.materials[i]).map((ref) => ref.index)));
  const images = new Set([...textures].map((i) => model.textures[i].source));
  const samplers = new Set([...textures].flatMap((i) => model.textures[i].sampler ?? []));
  const views = new Set([
    ...[...accessors].map((i) => model.accessors[i].bufferView),
    ...[...images].map((i) => model.images[i].bufferView),
  ]);
  const N = map(model.nodes, nodes);
  const M = map(model.meshes, meshes);
  const Mat = map(model.materials, materials);
  const A = map(model.accessors, accessors);
  const T = map(model.textures ?? [], textures);
  const I = map(model.images ?? [], images);
  const S = map(model.samplers ?? [], samplers);
  const V = map(model.bufferViews, views);
  for (const node of N.items) node.mesh = M.index.get(node.mesh);
  for (const mesh of M.items)
    for (const primitive of mesh.primitives) {
      if (primitive.material !== undefined) primitive.material = Mat.index.get(primitive.material);
      for (const key of Object.keys(primitive.attributes))
        primitive.attributes[key] = A.index.get(primitive.attributes[key]);
      if (primitive.indices !== undefined) primitive.indices = A.index.get(primitive.indices);
    }
  for (const material of Mat.items) for (const ref of textureRefs(material)) ref.index = T.index.get(ref.index);
  for (const texture of T.items) {
    texture.source = I.index.get(texture.source);
    if (texture.sampler !== undefined) texture.sampler = S.index.get(texture.sampler);
  }
  for (const item of [...A.items, ...I.items]) item.bufferView = V.index.get(item.bufferView);
  const parts = [];
  let length = 0;
  for (const view of V.items) {
    const bytes = binary.subarray(view.byteOffset ?? 0, (view.byteOffset ?? 0) + view.byteLength);
    view.byteOffset = length;
    parts.push(bytes, Buffer.alloc((4 - (bytes.length % 4)) % 4));
    length += Math.ceil(bytes.length / 4) * 4;
  }
  const used = JSON.stringify(Mat.items);
  const result = {
    ...model,
    scenes: [{ ...model.scenes[0], nodes: N.items.map((_, i) => i) }],
    nodes: N.items,
    meshes: M.items,
    materials: Mat.items,
    accessors: A.items,
    bufferViews: V.items,
    buffers: [{ byteLength: length }],
    extensionsUsed: (model.extensionsUsed ?? []).filter((name) => used.includes(`"${name}"`)),
  };
  for (const [key, part] of [
    ['textures', T],
    ['images', I],
    ['samplers', S],
  ])
    if (part.items.length) result[key] = part.items;
    else delete result[key]; // glTF arrays may not be empty.
  return { model: result, binary: Buffer.concat(parts) };
}

// Compresses one model; its bufferViews index `binary`. Returns the GLB and its checks.
function compress(model, binary) {
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
  const imageViews = new Set((model.images ?? []).map((image) => image.bufferView));
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
  return { result: Buffer.concat([header, json, binHeader, ...chunks]), verification };
}

const hash = (data) => createHash('sha256').update(data).digest('hex');
const outputs = [[output, gardenPath ? subset((node) => !GARDEN.includes(node.name)) : { model, binary }]];
if (gardenPath) {
  const garden = subset((node) => GARDEN.includes(node.name));
  assert.equal(garden.model.nodes.length, GARDEN.length, 'Missing garden nodes');
  outputs.push([gardenPath, garden]);
}
const files = {};
for (const [path, part] of outputs) {
  const { result, verification } = compress(part.model, part.binary);
  writeFileSync(path, result);
  files[path.split('/').pop()] = {
    outputBytes: result.length,
    outputSha256: hash(result),
    nodes: part.model.nodes.length,
    triangles: part.model.meshes
      .flatMap((mesh) => mesh.primitives)
      .reduce((sum, primitive) => sum + part.model.accessors[primitive.indices].count / 3, 0),
    verification,
  };
  console.log(`${path}: ${result.length} bytes (${lossless ? 'lossless' : 'filtered'})`);
}
writeFileSync(
  reportPath,
  JSON.stringify(
    {
      codec: 'meshoptimizer 1.1.1',
      extension: EXTENSION,
      version: VERSION,
      filter: lossless ? null : { name: 'EXPONENTIAL', mode: EXP_MODE, tolerance: TOLERANCE },
      inputBytes: source.length,
      inputSha256: hash(source),
      files,
    },
    null,
    2,
  ) + '\n',
);
