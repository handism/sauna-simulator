// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import { MeshoptDecoder } from 'meshoptimizer/decoder';

// Exercise the real CLI used by Blender, including --lossless and compressed migration.
describe('body normal compression pipeline', () => {
  it('quantizes normals while retaining topology/other attributes and lossless mode', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'body-normal-pipeline-'));
    try {
      const arrays = [
        new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]),
        new Float32Array([0, 0, 1, -0.6, 0, 0.8, 0, -0.8, 0.6]),
        new Float32Array([0, 0, 1, 0, 0, 1]),
        new Uint16Array([0, 1, 2]),
      ];
      let offset = 0;
      const chunks: Buffer[] = [];
      const views = arrays.map((array) => {
        const bytes = Buffer.from(array.buffer);
        const view = { buffer: 0, byteOffset: offset, byteLength: bytes.length };
        chunks.push(bytes, Buffer.alloc((4 - (bytes.length % 4)) % 4));
        offset += Math.ceil(bytes.length / 4) * 4;
        return view;
      });
      const model = {
        asset: { version: '2.0' },
        scene: 0,
        scenes: [{ nodes: [0] }],
        nodes: [{ mesh: 0, scale: [2, 1, 0.5] }],
        meshes: [{ primitives: [{ attributes: { POSITION: 0, NORMAL: 1, TEXCOORD_0: 2 }, indices: 3 }] }],
        accessors: arrays.map((_, i) => ({
          bufferView: i,
          componentType: i === 3 ? 5123 : 5126,
          count: 3,
          type: i === 3 ? 'SCALAR' : i === 2 ? 'VEC2' : 'VEC3',
        })),
        bufferViews: views,
        buffers: [{ byteLength: offset }],
      };
      let json = Buffer.from(JSON.stringify(model));
      json = Buffer.concat([json, Buffer.alloc((4 - (json.length % 4)) % 4, 32)]);
      const header = Buffer.alloc(20);
      [0x46546c67, 2, 28 + json.length + offset, json.length, 0x4e4f534a].forEach((v, i) =>
        header.writeUInt32LE(v, i * 4),
      );
      const binHeader = Buffer.alloc(8);
      binHeader.writeUInt32LE(offset);
      binHeader.writeUInt32LE(0x004e4942, 4);
      const input = join(dir, 'input.glb');
      writeFileSync(input, Buffer.concat([header, json, binHeader, ...chunks]));
      const run = (source: string, name: string, ...flags: string[]) => {
        const output = join(dir, `${name}.glb`);
        execFileSync(
          process.execPath,
          [resolve('scripts/compress_web_glb.mjs'), source, output, join(dir, `${name}.json`), ...flags],
          { stdio: 'pipe' },
        );
        const bytes = readFileSync(output);
        const length = bytes.readUInt32LE(12);
        return {
          output,
          bytes,
          model: JSON.parse(bytes.subarray(20, 20 + length).toString()),
          bin: bytes.subarray(28 + length),
        };
      };
      const oct = run(input, 'oct');
      const exact = run(input, 'exact', '--lossless');
      expect(oct.model.accessors[1]).toMatchObject({ componentType: 5120, normalized: true });
      expect(oct.model.extensionsRequired).toContain('KHR_mesh_quantization');
      expect(exact.model.accessors[1].componentType).toBe(5126);
      expect(exact.model.extensionsRequired).not.toContain('KHR_mesh_quantization');
      expect(oct.model.meshes).toEqual(model.meshes);
      expect(oct.model.nodes).toEqual(model.nodes);
      await MeshoptDecoder.ready;
      for (const file of [oct, exact]) {
        for (const i of file === oct ? [0, 2, 3] : [0, 1, 2, 3]) {
          const view = file.model.bufferViews[i];
          const ext = view.extensions.KHR_meshopt_compression;
          const decoded = new Uint8Array(view.byteLength);
          MeshoptDecoder.decodeGltfBuffer(
            decoded,
            ext.count,
            ext.byteStride,
            file.bin.subarray(ext.byteOffset, ext.byteOffset + ext.byteLength),
            ext.mode,
            ext.filter,
          );
          expect(Buffer.from(decoded)).toEqual(Buffer.from(arrays[i].buffer));
        }
      }
      const migration = run(exact.output, 'migration', '--body-normals-only');
      expect(migration.model.accessors[1]).toMatchObject({ componentType: 5120, normalized: true });
      expect(run(input, 'repeat').bytes).toEqual(oct.bytes);
      expect(() => run(oct.output, 'double', '--body-normals-only')).toThrow();
      expect(() => run(exact.output, 'incompatible', '--body-normals-only', '--lossless')).toThrow();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
