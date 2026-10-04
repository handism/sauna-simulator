// Read-only inventory and triangle-order-preserving 16-bit partition estimate.
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { MeshoptDecoder } from 'meshoptimizer/decoder';
await MeshoptDecoder.ready;
const [output] = process.argv.slice(2);
assert(output, 'Usage: node scripts/diagnose_glb_indices.mjs report.json');
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
const files = [];
for (const path of ['public/models/sauna.glb', 'public/models/sauna-garden.glb']) {
  const source = readFileSync(path);
  assert.equal(source.readUInt32LE(0), 0x46546c67);
  assert.equal(source.readUInt32LE(8), source.length);
  const jsonLength = source.readUInt32LE(12);
  const model = JSON.parse(source.subarray(20, 20 + jsonLength));
  const binary = source.subarray(28 + jsonLength);
  const rows = [];
  for (const [meshIndex, mesh] of model.meshes.entries()) {
    for (const primitive of mesh.primitives) {
      assert.equal(primitive.mode ?? 4, 4);
      const accessor = model.accessors[primitive.indices];
      assert(!accessor.sparse && !accessor.byteOffset);
      const view = model.bufferViews[accessor.bufferView];
      const ext = view.extensions.KHR_meshopt_compression;
      assert.equal(ext.mode, 'INDICES');
      assert.equal(ext.filter, 'NONE');
      const decoded = new Uint8Array(view.byteLength);
      MeshoptDecoder.decodeGltfBuffer(
        decoded,
        ext.count,
        ext.byteStride,
        binary.subarray(ext.byteOffset, ext.byteOffset + ext.byteLength),
        ext.mode,
        ext.filter,
      );
      assert([5123, 5125].includes(accessor.componentType));
      const indices =
        accessor.componentType === 5125 ? new Uint32Array(decoded.buffer) : new Uint16Array(decoded.buffer);
      assert.equal(indices.length % 3, 0);
      const vertices = model.accessors[primitive.attributes.POSITION].count;
      let maximum = 0;
      const used = new Set();
      for (const index of indices) {
        assert(index < vertices);
        maximum = Math.max(maximum, index);
        used.add(index);
      }
      let batch = new Set();
      let batches = 1;
      let partitionVertices = 0;
      for (let i = 0; i < indices.length; i += 3) {
        const triangle = [...indices.subarray(i, i + 3)];
        const added = new Set(triangle.filter((index) => !batch.has(index))).size;
        // 65535 is the primitive-restart sentinel in WebGL2's uint16 drawElements.
        if (batch.size + added > 65535) {
          partitionVertices += batch.size;
          batches++;
          batch = new Set();
        }
        triangle.forEach((index) => batch.add(index));
      }
      partitionVertices += batch.size;
      const sizes = { 5120: 1, 5121: 1, 5122: 2, 5123: 2, 5125: 4, 5126: 4 };
      const widths = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4 };
      const vertexStride = Object.values(primitive.attributes).reduce((sum, id) => {
        const attr = model.accessors[id];
        return sum + (model.bufferViews[attr.bufferView].byteStride ?? sizes[attr.componentType] * widths[attr.type]);
      }, 0);
      rows.push({
        mesh: mesh.name ?? meshIndex,
        vertices,
        usedVertices: used.size,
        maximum,
        componentType: accessor.componentType,
        indexBytes: decoded.length,
        vertexStride,
        directUint16: maximum < 65535,
        batches,
        partitionVertices,
        duplicatedVertices: partitionVertices - used.size,
        estimatedNetBytesSaved: decoded.length - indices.length * 2 - (partitionVertices - vertices) * vertexStride,
      });
    }
  }
  files.push({ path, sha256: hash(source), rows });
  assert.equal(hash(readFileSync(path)), hash(source), 'Source changed during inventory');
}
writeFileSync(
  output,
  JSON.stringify(
    {
      scriptSha256: hash(readFileSync(new URL(import.meta.url))),
      method:
        'Decoded indices; greedy contiguous triangle batches, at most 65535 unique vertices. Byte estimates exclude driver allocation and extra draw-call cost.',
      files,
    },
    null,
    2,
  ) + '\n',
);
console.log(
  JSON.stringify(
    files.map(({ path, rows }) => ({ path, uint32: rows.filter((r) => r.componentType === 5125) })),
    null,
    2,
  ),
);
