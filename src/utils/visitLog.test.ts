import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { formatPreviousVisit, recordVisit } from './visitLog';

describe('visitLog', () => {
  let storage: Map<string, string>;

  beforeEach(() => {
    storage = new Map();
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => storage.set(key, value),
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('accumulates visits and returns the previous visit time', () => {
    expect(recordVisit({ at: 1000, sets: 2, seconds: 300 })).toEqual({ visits: 1, totalSets: 2, previousAt: null });
    expect(recordVisit({ at: 2000, sets: 3, seconds: 400 })).toEqual({ visits: 2, totalSets: 5, previousAt: 1000 });
  });

  it('keeps totals beyond the recent-visit limit', () => {
    for (let i = 0; i < 35; i++) recordVisit({ at: i, sets: 1, seconds: 60 });
    const saved = JSON.parse(storage.get('sui-visit-log')!);
    expect(saved.recent).toHaveLength(30);
    expect(saved.recent[0].at).toBe(5);
    expect(recordVisit({ at: 99, sets: 1, seconds: 60 })).toEqual({ visits: 36, totalSets: 36, previousAt: 34 });
  });

  it('starts over from broken or foreign data', () => {
    storage.set('sui-visit-log', '{not json');
    expect(recordVisit({ at: 1, sets: 1, seconds: 1 }).visits).toBe(1);
    storage.set('sui-visit-log', JSON.stringify({ visits: -1, totalSets: 2, recent: [] }));
    expect(recordVisit({ at: 1, sets: 1, seconds: 1 }).visits).toBe(1);
    storage.set(
      'sui-visit-log',
      JSON.stringify({ visits: 4, totalSets: 6, recent: [{ at: 'x' }, { at: 7, sets: 1, seconds: 2 }] }),
    );
    expect(recordVisit({ at: 8, sets: 1, seconds: 1 })).toEqual({ visits: 5, totalSets: 7, previousAt: 7 });
  });

  it('still counts this visit when storage throws', () => {
    const fail = () => {
      throw new Error('disabled');
    };
    vi.stubGlobal('localStorage', { getItem: fail, setItem: fail });
    expect(recordVisit({ at: 1, sets: 2, seconds: 3 })).toEqual({ visits: 1, totalSets: 2, previousAt: null });
  });

  it('formats the previous visit by calendar day', () => {
    const now = new Date(2026, 9, 17, 0, 30).getTime();
    expect(formatPreviousVisit(new Date(2026, 9, 17, 0, 5).getTime(), now)).toBe('今日');
    expect(formatPreviousVisit(new Date(2026, 9, 16, 23, 50).getTime(), now)).toBe('昨日');
    expect(formatPreviousVisit(new Date(2026, 9, 3, 12).getTime(), now)).toBe('10月3日');
    expect(formatPreviousVisit(new Date(2025, 11, 31, 12).getTime(), now)).toBe('2025年12月31日');
  });
});
