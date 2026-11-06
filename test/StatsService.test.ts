import { describe, expect, test } from 'bun:test';
import { mockComponent } from '@asenajs/asena/test';
import type { MatchEndedEvent } from '../src/services/GameService';
import { MmrService } from '../src/services/MmrService';
import { StatsService } from '../src/services/StatsService';

const make = () => {
  const { instance: mmr } = mockComponent(MmrService, {
    overrides: { initialRating: 1000, kFactor: 32 },
  });
  const { instance: stats } = mockComponent(StatsService, { overrides: { mmr } });
  return stats;
};

const match = (overrides: Partial<MatchEndedEvent> = {}): MatchEndedEvent => ({
  matchId: crypto.randomUUID(),
  code: 'ABCDE',
  winner: { side: 'left', name: 'Ayse' },
  loser: { side: 'right', name: 'Mehmet' },
  score: { left: 7, right: 3 },
  reason: 'score',
  durationMs: 1234,
  ...overrides,
});

describe('StatsService', () => {
  test('initializes player ratings and records the first match snapshots', () => {
    const stats = make();

    stats.record(match({ matchId: 'match-1' }));

    expect(stats.leaderboard(20)).toEqual([
      { name: 'Ayse', wins: 1, losses: 0, pointsFor: 7, pointsAgainst: 3, mmr: 1016 },
      { name: 'Mehmet', wins: 0, losses: 1, pointsFor: 3, pointsAgainst: 7, mmr: 984 },
    ]);
    expect(stats.recentMatches(20)).toHaveLength(1);
    expect(stats.recentMatches(20)[0]).toMatchObject({
      matchId: 'match-1',
      mmr: {
        winner: { before: 1000, after: 1016, delta: 16 },
        loser: { before: 1000, after: 984, delta: -16 },
      },
    });
  });

  test('ignores a duplicate match ID before changing stats or creating players', () => {
    const stats = make();
    const completed = match({ matchId: 'duplicate' });
    stats.record(completed);
    const players = structuredClone(stats.leaderboard(20));

    stats.record({
      ...completed,
      winner: { side: 'left', name: 'Ghost' },
      loser: { side: 'right', name: 'Phantom' },
    });

    expect(stats.leaderboard(20)).toEqual(players);
    expect(stats.recentMatches(20)).toHaveLength(1);
    expect(stats.totals()).toEqual({ matchesPlayed: 1, playersSeen: 2 });
  });

  test('ignores a replay after its public history entry has been evicted', () => {
    const stats = make();
    const original = match({ matchId: 'original' });
    stats.record(original);
    for (let i = 0; i < 101; i++) stats.record(match({ matchId: `new-${i}` }));
    const players = structuredClone(stats.leaderboard(20));
    const history = structuredClone(stats.recentMatches(100));

    stats.record(original);

    expect(stats.leaderboard(20)).toEqual(players);
    expect(stats.recentMatches(100)).toEqual(history);
    expect(stats.recentMatches(100).some((record) => record.matchId === 'original')).toBe(false);
  });

  test('rates distinct rematches in the same room from the current ratings', () => {
    const stats = make();

    stats.record(match({ matchId: 'first' }));
    stats.record(match({ matchId: 'second' }));

    const [second, first] = stats.recentMatches(20);
    expect(stats.recentMatches(20)).toHaveLength(2);
    expect(second.mmr.winner.before).toBe(first.mmr.winner.after);
    expect(second.mmr.loser.before).toBe(first.mmr.loser.after);
    expect(second.mmr.winner.before).toBe(1016);
    expect(second.mmr.loser.before).toBe(984);
  });

  test('rates score and forfeit outcomes identically', () => {
    const scored = make();
    const forfeited = make();

    scored.record(match({ matchId: 'score', reason: 'score' }));
    forfeited.record(match({ matchId: 'forfeit', reason: 'forfeit', score: { left: 0, right: 0 } }));

    expect(forfeited.recentMatches(1)[0].mmr).toEqual(scored.recentMatches(1)[0].mmr);
    expect(forfeited.leaderboard(20).map((player) => player.mmr)).toEqual([1016, 984]);
  });

  test('preserves same-identity aggregates with zero rating changes', () => {
    const stats = make();

    stats.record(match({
      matchId: 'self',
      winner: { side: 'left', name: 'Ayse' },
      loser: { side: 'right', name: 'AYSE' },
    }));

    expect(stats.leaderboard(20)).toEqual([
      { name: 'Ayse', wins: 1, losses: 1, pointsFor: 10, pointsAgainst: 10, mmr: 1000 },
    ]);
    expect(stats.recentMatches(1)[0].mmr).toEqual({
      winner: { before: 1000, after: 1000, delta: 0 },
      loser: { before: 1000, after: 1000, delta: 0 },
    });
  });

  test('sorts the leaderboard by MMR before the existing tie-breakers', () => {
    const stats = make();
    const between = (matchId: string, winner: string, loser: string) => match({
      matchId,
      winner: { side: 'left', name: winner },
      loser: { side: 'right', name: loser },
    });

    stats.record(between('1', 'Ayse', 'Mehmet'));
    stats.record(between('2', 'Ayse', 'Can'));
    stats.record(between('3', 'Deniz', 'Ayse'));
    stats.record(between('4', 'Deniz', 'Ayse'));
    stats.record(between('5', 'Ece', 'Deniz'));

    const players = stats.leaderboard(20);
    const ece = players.find((player) => player.name === 'Ece');
    const ayse = players.find((player) => player.name === 'Ayse');
    expect(ece?.wins).toBe(1);
    expect(ayse?.wins).toBe(2);
    expect(ece!.mmr).toBeGreaterThan(ayse!.mmr);
    expect(players.indexOf(ece!)).toBeLessThan(players.indexOf(ayse!));
  });
});
