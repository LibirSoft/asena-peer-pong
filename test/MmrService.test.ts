import { describe, expect, test } from 'bun:test';
import { mockComponent } from '@asenajs/asena/test';
import { MmrService } from '../src/services/MmrService';

describe('MmrService', () => {
  test('classifies fixed band boundaries and the default initial rating', () => {
    const { instance: mmr } = mockComponent(MmrService);
    const cases = [
      [-1, 'Çırak'],
      [0, 'Çırak'],
      [999, 'Çırak'],
      [1000, 'Usta'],
      [1001, 'Usta'],
      [1499, 'Usta'],
      [1500, 'Efsane'],
      [1501, 'Efsane'],
      [100000, 'Efsane'],
    ] as const;

    for (const [rating, band] of cases) expect(mmr.bandFor(rating)).toBe(band);
    expect(mmr.getInitialRating()).toBe(1000);
    expect(mmr.bandFor(mmr.getInitialRating())).toBe('Usta');
  });

  test('uses the default initial rating and splits an equal match 16/-16', () => {
    const { instance: mmr } = mockComponent(MmrService);

    expect(mmr.getInitialRating()).toBe(1000);
    expect(mmr.update(1000, 1000)).toEqual({
      winner: { before: 1000, after: 1016, delta: 16, beforeBand: 'Usta', afterBand: 'Usta' },
      loser: { before: 1000, after: 984, delta: -16, beforeBand: 'Usta', afterBand: 'Çırak' },
    });
  });

  test('rewards favorites and underdogs asymmetrically', () => {
    const { instance: mmr } = mockComponent(MmrService);

    expect(mmr.update(1200, 1000)).toEqual({
      winner: { before: 1200, after: 1208, delta: 8, beforeBand: 'Usta', afterBand: 'Usta' },
      loser: { before: 1000, after: 992, delta: -8, beforeBand: 'Usta', afterBand: 'Çırak' },
    });
    expect(mmr.update(1000, 1200)).toEqual({
      winner: { before: 1000, after: 1024, delta: 24, beforeBand: 'Usta', afterBand: 'Usta' },
      loser: { before: 1200, after: 1176, delta: -24, beforeBand: 'Usta', afterBand: 'Usta' },
    });
  });

  test('attaches bands when updates cross either threshold', () => {
    const { instance: mmr } = mockComponent(MmrService);

    expect(mmr.update(999, 999)).toEqual({
      winner: { before: 999, after: 1015, delta: 16, beforeBand: 'Çırak', afterBand: 'Usta' },
      loser: { before: 999, after: 983, delta: -16, beforeBand: 'Çırak', afterBand: 'Çırak' },
    });
    expect(mmr.update(1499, 1499)).toEqual({
      winner: { before: 1499, after: 1515, delta: 16, beforeBand: 'Usta', afterBand: 'Efsane' },
      loser: { before: 1499, after: 1483, delta: -16, beforeBand: 'Usta', afterBand: 'Usta' },
    });
  });

  test('returns integral zero-sum rating changes', () => {
    const { instance: mmr } = mockComponent(MmrService);

    for (const [winner, loser] of [
      [1000, 1000],
      [1200, 1000],
      [1000, 1200],
      [1001, 999],
      [2400, 400],
    ]) {
      const result = mmr.update(winner, loser);
      for (const change of [result.winner, result.loser]) {
        expect(Number.isInteger(change.before)).toBe(true);
        expect(Number.isInteger(change.after)).toBe(true);
        expect(Number.isInteger(change.delta)).toBe(true);
        expect(change.beforeBand).toBe(mmr.bandFor(change.before));
        expect(change.afterBand).toBe(mmr.bandFor(change.after));
      }
      expect(result.winner.delta + result.loser.delta).toBe(0);
      expect(result.winner.after - result.winner.before).toBe(result.winner.delta);
      expect(result.loser.after - result.loser.before).toBe(result.loser.delta);
    }
  });

  test('uses configured initial rating and K-factor overrides', () => {
    const { instance: mmr } = mockComponent(MmrService, {
      overrides: { initialRating: 1200, kFactor: 16 },
    });

    expect(mmr.getInitialRating()).toBe(1200);
    expect(mmr.update(1200, 1200)).toEqual({
      winner: { before: 1200, after: 1208, delta: 8, beforeBand: 'Usta', afterBand: 'Usta' },
      loser: { before: 1200, after: 1192, delta: -8, beforeBand: 'Usta', afterBand: 'Usta' },
    });
  });
});
