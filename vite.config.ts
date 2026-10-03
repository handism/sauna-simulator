import { defineConfig, type Plugin } from 'vitest/config';
import react from '@vitejs/plugin-react';

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

// https://vite.dev/config/
export default defineConfig({
  base: '/sauna-simulator/',
  plugins: [react(), entryChunkSizeGuard(ENTRY_CHUNK_LIMIT_KB)],
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
