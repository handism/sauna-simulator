import '@testing-library/jest-dom';
import { vi } from 'vitest';

class MockWorker {
  onmessage: ((e: MessageEvent) => void) | null = null;
  postMessage(message: any) {
    const { id, type, length } = message;
    queueMicrotask(() => {
      if (this.onmessage) {
        const data = new Float32Array(length);
        this.onmessage({
          data: { id, data }
        } as MessageEvent);
      }
    });
  }
  terminate() {}
}

vi.stubGlobal('Worker', MockWorker);
if (typeof window !== 'undefined') {
  window.URL.createObjectURL = window.URL.createObjectURL || vi.fn(() => 'mock-url');
  window.URL.revokeObjectURL = window.URL.revokeObjectURL || vi.fn();

  if (!window.crypto) {
    (window as any).crypto = {};
  }
  if (!window.crypto.getRandomValues) {
    window.crypto.getRandomValues = function (buffer: any) {
      return require('crypto').webcrypto.getRandomValues(buffer);
    };
  }
}

