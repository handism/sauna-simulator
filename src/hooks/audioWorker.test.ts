import { describe, it, expect, vi, beforeEach } from 'vitest';

describe('audioWorker', () => {
  let postMessageSpy: any;
  let getRandomValuesSpy: any;
  let originalGetRandomValues: any;

  beforeEach(async () => {
    vi.resetModules();
    postMessageSpy = vi.fn();

    // Backup original getRandomValues
    originalGetRandomValues = self.crypto.getRandomValues.bind(self.crypto);

    // We spy on it to ensure it's called with the correct chunks
    getRandomValuesSpy = vi.fn((array: any) => {
      // populate with some deterministic value
      for(let i=0; i<array.length; i++) {
         array[i] = 2147483647;
      }
      return array;
    });

    self.crypto.getRandomValues = getRandomValuesSpy;
    self.postMessage = postMessageSpy;

    // Import the worker file which will attach onmessage to self
    await import('./audioWorker.ts');
  });

  it('should process saunaNoise with length less than maxElements', () => {
    const onmessage = self.onmessage as ((e: MessageEvent) => void) | null;
    expect(onmessage).toBeDefined();

    const mockEvent = {
      data: {
        id: 'test-sauna-1',
        type: 'saunaNoise',
        length: 100,
      }
    } as MessageEvent;

    onmessage!(mockEvent);

    expect(getRandomValuesSpy).toHaveBeenCalledTimes(1);
    expect(getRandomValuesSpy.mock.calls[0][0].length).toBe(100);

    expect(postMessageSpy).toHaveBeenCalledTimes(1);
    const [payload, transferList] = postMessageSpy.mock.calls[0];
    expect(payload.id).toBe('test-sauna-1');
    expect(payload.data).toBeInstanceOf(Float32Array);
    expect(payload.data.length).toBe(100);
    expect(transferList).toBeDefined();
    expect(transferList[0]).toBe(payload.data.buffer);
  });

  it('should process windNoise with length greater than maxElements (chunking)', () => {
    const onmessage = self.onmessage as ((e: MessageEvent) => void) | null;

    const length = 20000;
    const mockEvent = {
      data: {
        id: 'test-wind-1',
        type: 'windNoise',
        length: length,
      }
    } as MessageEvent;

    onmessage!(mockEvent);

    // maxElements is 16384, so 20000 should be chunked into 16384 and 3616
    expect(getRandomValuesSpy).toHaveBeenCalledTimes(2);
    expect(getRandomValuesSpy.mock.calls[0][0].length).toBe(16384);
    expect(getRandomValuesSpy.mock.calls[1][0].length).toBe(3616);

    expect(postMessageSpy).toHaveBeenCalledTimes(1);
    const [payload, transferList] = postMessageSpy.mock.calls[0];
    expect(payload.id).toBe('test-wind-1');
    expect(payload.data).toBeInstanceOf(Float32Array);
    expect(payload.data.length).toBe(length);
    expect(transferList).toBeDefined();
    expect(transferList[0]).toBe(payload.data.buffer);
  });

  it('should process default (white noise) type', () => {
    const onmessage = self.onmessage as ((e: MessageEvent) => void) | null;

    const mockEvent = {
      data: {
        id: 'test-default-1',
        type: 'unknownNoise',
        length: 50,
      }
    } as MessageEvent;

    onmessage!(mockEvent);

    expect(getRandomValuesSpy).toHaveBeenCalledTimes(1);

    expect(postMessageSpy).toHaveBeenCalledTimes(1);
    const [payload] = postMessageSpy.mock.calls[0];
    expect(payload.id).toBe('test-default-1');
    expect(payload.data.length).toBe(50);
  });
});
