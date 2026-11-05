import type { Role, RoomView } from '../src/game/protocol';

export type PauseCommand = { t: 'pause' } | { t: 'resume' };

export function pauseCommand(
  room: Pick<RoomView, 'status' | 'pausesRemaining'>,
  role: Role,
): PauseCommand | null {
  if (role === 'spectator') return null;
  if (room.status === 'paused') return { t: 'resume' };
  if (room.status === 'playing' && room.pausesRemaining[role] > 0) return { t: 'pause' };
  return null;
}

export function pauseRemainingSeconds(remainingMs: number, receivedAt: number, now: number): number {
  const elapsedMs = Math.max(0, now - receivedAt);
  return Math.max(0, Math.ceil((remainingMs - elapsedMs) / 1000));
}
