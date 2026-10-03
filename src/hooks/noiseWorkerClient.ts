import AudioWorker from './audioWorker?worker';

export type NoiseType = 'whiteNoise' | 'saunaNoise' | 'windNoise';

// ノイズ生成用 Worker への要求窓口。Worker は最初の要求で作り、ページ内の全エンジンで共有する。
let audioWorker: Worker | null = null;
let msgIdCounter = 0;
type ResolverType = {
  resolve: (data: Float32Array<ArrayBuffer>) => void;
  reject: (reason?: unknown) => void;
  timeoutId: ReturnType<typeof setTimeout>;
};
const resolvers = new Map<number, ResolverType>();
const ongoingGenerations = new Map<string, Promise<Float32Array<ArrayBuffer>>>();

// Worker が落ちたら待機中の要求をタイムアウトまで待たせず失敗させ、次の要求で作り直す
function failPendingGenerations(reason: unknown) {
  resolvers.forEach(({ reject, timeoutId }) => {
    clearTimeout(timeoutId);
    reject(reason);
  });
  resolvers.clear();
  audioWorker?.terminate();
  audioWorker = null;
}

// A wrapper to handle concurrent requests to the worker
export function generateNoise(type: NoiseType, length: number): Promise<Float32Array<ArrayBuffer>> {
  const cacheKey = `${type}-${length}`;
  const existingPromise = ongoingGenerations.get(cacheKey);
  if (existingPromise) {
    return existingPromise;
  }

  const promise = new Promise<Float32Array<ArrayBuffer>>((resolve, reject) => {
    if (!audioWorker) {
      audioWorker = new AudioWorker();
      audioWorker.onmessage = (e) => {
        const { id, data } = e.data;
        const resolver = resolvers.get(id);
        if (resolver) {
          clearTimeout(resolver.timeoutId);
          resolver.resolve(data);
          resolvers.delete(id);
        }
      };
      audioWorker.onerror = (e) => {
        console.error('AudioWorker error:', e);
        failPendingGenerations(new Error('AudioWorker failed'));
      };
    }

    const id = msgIdCounter++;
    const timeoutId = setTimeout(() => {
      resolvers.delete(id);
      reject(new Error(`Worker timeout for message id ${id}`));
    }, 10000);

    resolvers.set(id, { resolve, reject, timeoutId });
    audioWorker.postMessage({ id, type, length });
  }).finally(() => {
    ongoingGenerations.delete(cacheKey);
  });

  ongoingGenerations.set(cacheKey, promise);
  return promise;
}
