import { defineConfig, type Plugin } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { readFileSync } from 'node:fs';
import {
  PROBE_KINDS,
  PROBE_SCENES,
  probeSceneFile,
  splitProbeScene,
  type ProbeKind,
  type ProbeScene,
} from './src/components/3d/probeScenes';

// 3D専用チャンク（Three.js を含み、遅延ロード）は大きいことが前提なので、全体の警告上限はそれに合わせる。
// 代わりに、2D利用時に必ず取得する入口チャンクだけは従来の 500kB で警告する。
const LAZY_3D_CHUNK_LIMIT_KB = 850;
const ENTRY_CHUNK_LIMIT_KB = 500;

function entryChunkSizeGuard(limitKb: number): Plugin {
  return {
    name: 'entry-chunk-size-guard',
    apply: 'build',
    generateBundle(_options, bundle) {
      for (const chunk of Object.values(bundle)) {
        if (chunk.type !== 'chunk' || !chunk.isEntry) continue;
        const kb = Buffer.byteLength(chunk.code) / 1000;
        if (kb > limitKb) {
          this.warn(`入口チャンク ${chunk.fileName} が ${kb.toFixed(0)} kB あり、上限 ${limitKb} kB を超えています`);
        }
      }
    },
  };
}

// 照明プローブ（public/models/irradiance.bin・reflection.bin）を時間帯ごとのファイルに切り出して配信する。
// 3Dは今の時間帯の分だけを先に取得し、残りは準備完了の後に取る（src/components/3d/probeScenes.ts）。
// 焼き込み・診断スクリプトは従来の1ファイルを読むので、元のファイルはそのまま残す。
function probeScenes(base: string): Plugin {
  const split = (kind: ProbeKind, scene: ProbeScene) => {
    const header = JSON.parse(readFileSync(`public/models/${kind}.json`, 'utf8'));
    const file = readFileSync(`public/models/${kind}.bin`);
    const values = new Uint16Array(file.buffer.slice(file.byteOffset, file.byteOffset + file.byteLength));
    return Buffer.from(splitProbeScene(header, values, scene).buffer);
  };
  const files = PROBE_KINDS.flatMap((kind) => PROBE_SCENES.map((scene) => ({ kind, scene })));
  return {
    name: 'probe-scenes',
    configureServer(server) {
      server.middlewares.use((request, response, next) => {
        const path = request.url?.split('?')[0];
        const file = files.find(({ kind, scene }) => path === `${base}models/${probeSceneFile(kind, scene)}`);
        if (!file) return next();
        response.setHeader('Content-Type', 'application/octet-stream');
        response.end(split(file.kind, file.scene));
      });
    },
    generateBundle() {
      for (const { kind, scene } of files)
        this.emitFile({ type: 'asset', fileName: `models/${probeSceneFile(kind, scene)}`, source: split(kind, scene) });
    },
  };
}

const BASE = '/sauna-simulator/';

// https://vite.dev/config/
export default defineConfig({
  base: BASE,
  plugins: [react(), entryChunkSizeGuard(ENTRY_CHUNK_LIMIT_KB), probeScenes(BASE)],
  build: {
    chunkSizeWarningLimit: LAZY_3D_CHUNK_LIMIT_KB,
  },
  test: {
    environment: 'jsdom',
    setupFiles: ['./vitest.setup.ts'],
    globals: true,
    // Node 25 の組み込み Web Storage が jsdom の localStorage より優先され、警告を出すため無効化する
    // （このフラグを知らない古い Node では指定しない）
    execArgv: process.allowedNodeEnvironmentFlags.has('--experimental-webstorage')
      ? ['--no-experimental-webstorage']
      : [],
  },
});
