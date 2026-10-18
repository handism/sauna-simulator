// Check the scoped asset replacement after the normal web export/compression path.
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { MeshoptDecoder } from 'meshoptimizer/decoder';

await MeshoptDecoder.ready;
const [beforePath, afterPath, output] = process.argv.slice(2);
assert(beforePath && afterPath && output, 'before.glb after.glb report.json');
const hash = (data) => createHash('sha256').update(data).digest('hex');
const edited = new Set(['Blackened bronze', 'V2 | warm open-grain timber', 'V2 | mineral charcoal stone']);
function inspect(path) {
  const bytes = readFileSync(path);
  const size = bytes.readUInt32LE(12);
  const model = JSON.parse(bytes.subarray(20, 20 + size));
  const binary = bytes.subarray(28 + size);
  function accessor(id) {
    const a = model.accessors[id];
    assert(!a.sparse);
    const view = model.bufferViews[a.bufferView];
    const ext = view.extensions.KHR_meshopt_compression;
    const decoded = new Uint8Array(view.byteLength);
    MeshoptDecoder.decodeGltfBuffer(
      decoded,
      ext.count,
      ext.byteStride,
      binary.subarray(ext.byteOffset, ext.byteOffset + ext.byteLength),
      ext.mode,
      ext.filter,
    );
    return {
      count: a.count,
      type: a.type,
      componentType: a.componentType,
      normalized: a.normalized ?? false,
      offset: a.byteOffset ?? 0,
      stride: ext.byteStride,
      sha256: hash(decoded),
    };
  }
  const untouched = {};
  const props = [];
  let triangles = 0;
  for (const node of model.nodes) {
    if (node.mesh === undefined) continue;
    for (const p of model.meshes[node.mesh].primitives) {
      const name = model.materials[p.material].name;
      const count = model.accessors[p.indices].count / 3;
      triangles += count;
      if (name.startsWith('Loyly | ')) props.push({ name, triangles: count });
      if (edited.has(name) || name.startsWith('Loyly | ')) continue;
      (untouched[name] ??= []).push({
        transform: { translation: node.translation, rotation: node.rotation, scale: node.scale, matrix: node.matrix },
        indices: accessor(p.indices),
        attributes: Object.fromEntries(
          Object.entries(p.attributes)
            .sort(([a], [b]) => a.localeCompare(b))
            .map(([k, id]) => [k, accessor(id)]),
        ),
      });
    }
  }
  const imageHashes = model.images
    .map((im) => {
      const v = model.bufferViews[im.bufferView];
      return hash(binary.subarray(v.byteOffset, v.byteOffset + v.byteLength));
    })
    .sort();
  return { sha256: hash(bytes), bytes: bytes.length, triangles, untouched, props, imageHashes };
}
const before = inspect(beforePath);
const after = inspect(afterPath);
assert.deepEqual(after.untouched, before.untouched, 'Geometry outside the three shared source materials changed');
assert.deepEqual(after.imageHashes, before.imageHashes, 'Packed images changed');
assert.equal(after.props.length, 5);
assert(after.triangles - before.triangles < 12_000, 'Unexpected geometry expansion');
const report = {
  before: { sha256: before.sha256, bytes: before.bytes, triangles: before.triangles },
  after: { sha256: after.sha256, bytes: after.bytes, triangles: after.triangles },
  unchangedMaterialGroups: Object.keys(before.untouched).length,
  packedImagesUnchanged: true,
  scope:
    'decoded geometry and node transforms outside the three shared edited materials; source exporter verifies blend hash',
  props: after.props,
};
writeFileSync(output, JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify(report));
