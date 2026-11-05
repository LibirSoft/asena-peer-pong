import { describe, expect, test } from 'bun:test';
import { pauseCommand, pauseRemainingSeconds } from '../web/pause';

describe('pause client helpers', () => {
  test('selects pause for seated players with an allowance and resume for either seated player', () => {
    const playing = { status: 'playing', pausesRemaining: { left: 2, right: 1 } } as const;
    expect(pauseCommand(playing, 'left')).toEqual({ t: 'pause' });
    expect(pauseCommand(playing, 'right')).toEqual({ t: 'pause' });

    const paused = { status: 'paused', pausesRemaining: { left: 0, right: 0 } } as const;
    expect(pauseCommand(paused, 'left')).toEqual({ t: 'resume' });
    expect(pauseCommand(paused, 'right')).toEqual({ t: 'resume' });
  });

  test('rejects spectators, exhausted allowances, and non-actionable room statuses', () => {
    expect(pauseCommand({ status: 'playing', pausesRemaining: { left: 0, right: 2 } }, 'left')).toBeNull();
    expect(pauseCommand({ status: 'playing', pausesRemaining: { left: 2, right: 2 } }, 'right')).toEqual({ t: 'pause' });
    expect(pauseCommand({ status: 'playing', pausesRemaining: { left: 2, right: 2 } }, 'spectator')).toBeNull();
    expect(pauseCommand({ status: 'paused', pausesRemaining: { left: 1, right: 1 } }, 'spectator')).toBeNull();

    for (const status of ['waiting', 'countdown', 'finished'] as const) {
      expect(pauseCommand({ status, pausesRemaining: { left: 2, right: 2 } }, 'left')).toBeNull();
    }
  });

  test('uses ceiling semantics for remaining seconds from the latest server value and local elapsed time', () => {
    expect(pauseRemainingSeconds(30_000, 1_000, 1_000)).toBe(30);
    expect(pauseRemainingSeconds(30_000, 1_000, 1_001)).toBe(30);
    expect(pauseRemainingSeconds(30_000, 1_000, 2_000)).toBe(29);
    expect(pauseRemainingSeconds(30_000, 1_000, 30_000)).toBe(1);
    expect(pauseRemainingSeconds(30_000, 1_000, 30_001)).toBe(1);
  });

  test('clamps the displayed remaining seconds at zero at and after the deadline', () => {
    expect(pauseRemainingSeconds(30_000, 1_000, 31_000)).toBe(0);
    expect(pauseRemainingSeconds(30_000, 1_000, 45_000)).toBe(0);
  });
});
