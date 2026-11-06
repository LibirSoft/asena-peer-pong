import { describe, expect, test } from 'bun:test';
import { mockComponent } from '@asenajs/asena/test';
import { MmrService } from '../src/services/MmrService';

describe('MmrService', () => {
  test('uses the default initial rating and splits an equal match 16/-16', () => {
    const { instance: mmr } = mockComponent(MmrService);

    expect(mmr.getInitialRating()).toBe(1000);
    expect(mmr.update(1000, 1000)).toEqual({
      winner: { before: 1000, after: 1016, delta: 16 },
      loser: { before: 1000, after: 984, delta: -16 },
    });
  });

  test('rewards favorites and underdogs asymmetrically', () => {
    const { instance: mmr } = mockComponent(MmrService);

    expect(mmr.update(1200, 1000)).toEqual({
      winner: { before: 1200, after: 1208, delta: 8 },
      loser: { before: 1000, after: 992, delta: -8 },
    });
    expect(mmr.update(1000, 1200)).toEqual({
      winner: { before: 1000, after: 1024, delta: 24 },
      loser: { before: 1200, after: 1176, delta: -24 },
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
      winner: { before: 1200, after: 1208, delta: 8 },
      loser: { before: 1200, after: 1192, delta: -8 },
    });
  });
});
