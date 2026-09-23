import { afterEach, describe, expect, it, vi } from 'vitest';
import { readPreference, writePreference } from './preferences';

describe('preferences', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('returns a stored allowed value and falls back for unknown or missing values', () => {
    const storage = new Map<string, string>([
      ['mode', 'b'],
      ['bad', 'x'],
    ]);
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => storage.set(key, value),
    });
    expect(readPreference('mode', ['a', 'b'], 'a')).toBe('b');
    expect(readPreference('bad', ['a', 'b'], 'a')).toBe('a');
    expect(readPreference('missing', ['a', 'b'], 'a')).toBe('a');
    writePreference('mode', 'a');
    expect(storage.get('mode')).toBe('a');
  });

  it('keeps working when storage throws', () => {
    const fail = () => {
      throw new Error('disabled');
    };
    vi.stubGlobal('localStorage', { getItem: fail, setItem: fail });
    expect(readPreference('mode', ['a', 'b'], 'a')).toBe('a');
    expect(() => writePreference('mode', 'b')).not.toThrow();
  });
});
