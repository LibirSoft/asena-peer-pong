import { afterEach, beforeEach, describe, expect, jest, mock, test } from 'bun:test';
import { createTestUlakStub, mockComponent } from '@asenajs/asena/test';
import type { PongPhysics } from '../src/game/PongPhysics';
import type { ServerMessage, Side } from '../src/game/protocol';
import { GameService } from '../src/services/GameService';
import { RoomService, type Room } from '../src/services/RoomService';

interface MatchInspection {
  physics: PongPhysics;
  loop?: ReturnType<typeof setInterval>;
  countdown?: ReturnType<typeof setTimeout>;
  pauseTimeout?: ReturnType<typeof setTimeout>;
  startedAt: number;
}

const games: GameService[] = [];

function makeGame(targetScore = 20) {
  const { instance: rooms } = mockComponent(RoomService, {
    overrides: { defaultTargetScore: targetScore, events: { emit: mock(() => true) } },
  });
  const events = { emit: mock((_name: string, _data?: unknown) => true) };
  const logger = { info: mock(), warn: mock(), error: mock() };
  const socket = createTestUlakStub('/ws/game');
  const { instance: game } = mockComponent(GameService, { overrides: { rooms, socket, events, logger } });
  games.push(game);

  const room = rooms.create({ targetScore });
  rooms.join(room.code, 'a', 'Ayşe');
  rooms.join(room.code, 'b', 'Mehmet');
  rooms.join(room.code, 'watcher', 'Zeynep');
  return { game, rooms, events, logger, socket, room };
}

function matchOf(game: GameService, room: Room): MatchInspection | undefined {
  return (game as unknown as { matches: Map<string, MatchInspection> }).matches.get(room.code);
}

function messagesOf<T extends ServerMessage['t']>(
  socket: ReturnType<typeof createTestUlakStub>,
  t: T,
): Array<Extract<ServerMessage, { t: T }>> {
  return socket.to.mock.calls
    .map(([, message]) => message as ServerMessage)
    .filter((message): message is Extract<ServerMessage, { t: T }> => message.t === t);
}

async function startMatch(game: GameService, room: Room): Promise<void> {
  await game.playerReady(room, 'a');
  await game.playerReady(room, 'b');
  jest.advanceTimersByTime(3_000);
  expect(room.status).toBe('playing');
}

async function pauseAndResume(game: GameService, room: Room, side: Side): Promise<void> {
  const socketId = side === 'left' ? 'a' : 'b';
  await game.pause(room, socketId);
  expect(room.status).toBe('paused');
  await game.resume(room, socketId);
  jest.advanceTimersByTime(3_000);
  expect(room.status).toBe('playing');
}

describe('GameService', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => {
    for (const game of games.splice(0)) game.stopAll();
    jest.useRealTimers();
  });

  test('a forfeit ends the match and emits game.match.ended', async () => {
    const { game, rooms, events, socket, room } = makeGame();
    await game.playerReady(room, 'a');
    await game.playerReady(room, 'b');
    expect(room.status).toBe('countdown');

    rooms.leave(room.code, 'b');
    await game.playerLeft(room, 'right', 'Mehmet');

    expect(room.status).toBe('finished');
    const ended = events.emit.mock.calls.find(([name]) => name === 'game.match.ended');
    expect(ended?.[1]).toMatchObject({ winner: { name: 'Ayşe' }, loser: { name: 'Mehmet' }, reason: 'forfeit' });
    expect(socket.to).toHaveBeenCalledWith(`room:${room.code}`, expect.objectContaining({ t: 'end', winner: 'left' }));
  });

  test('only seated players can pause or resume and invalid commands do not change state', async () => {
    const { game, socket, room } = makeGame();
    await startMatch(game, room);
    socket.to.mockClear();

    await game.pause(room, 'watcher');
    await game.pause(room, 'unknown');
    await game.resume(room, 'a');
    expect(room.status).toBe('playing');
    expect(room.pausesRemaining).toEqual({ left: 2, right: 2 });
    expect(socket.to).not.toHaveBeenCalled();

    await game.pause(room, 'a');
    expect(room.status).toBe('paused');
    expect(room.pausesRemaining).toEqual({ left: 1, right: 2 });
    const paused = messagesOf(socket, 'room').at(-1)?.room;
    expect(paused).toMatchObject({
      status: 'paused',
      pausesRemaining: { left: 1, right: 2 },
      pause: { by: 'left' },
    });
    expect(paused?.pause?.remainingMs).toBeGreaterThan(0);
    expect(paused?.pause?.remainingMs).toBeLessThanOrEqual(30_000);

    const timeout = matchOf(game, room)?.pauseTimeout;
    const callCount = socket.to.mock.calls.length;
    await game.pause(room, 'b');
    await game.resume(room, 'watcher');
    await game.resume(room, 'unknown');
    expect(room.status).toBe('paused');
    expect(room.pausesRemaining).toEqual({ left: 1, right: 2 });
    expect(matchOf(game, room)?.pauseTimeout).toBe(timeout);
    expect(socket.to.mock.calls.length).toBe(callCount);
  });

  test('pause freezes physics and input, then opponent resume preserves the match through countdown', async () => {
    const { game, events, socket, room } = makeGame();
    await startMatch(game, room);
    const match = matchOf(game, room)!;
    const originalPhysics = match.physics;
    const originalLoop = match.loop;
    const originalStartedAt = match.startedAt;

    game.setInput(room.code, 'left', 1);
    game.setInput(room.code, 'right', -1);
    jest.advanceTimersByTime(100);
    await game.pause(room, 'a');
    const frozen = match.physics.snapshot();
    expect(match.physics.inputs).toEqual({ left: 0, right: 0 });
    expect(game.activeMatchCount()).toBe(1);
    socket.to.mockClear();

    game.setInput(room.code, 'left', -1);
    game.setInput(room.code, 'right', 1);
    jest.advanceTimersByTime(5_000);
    expect(match.physics.snapshot()).toEqual(frozen);
    expect(messagesOf(socket, 'state')).toHaveLength(0);
    expect(messagesOf(socket, 'scored')).toHaveLength(0);

    await game.resume(room, 'b');
    expect(room.status).toBe('countdown');
    expect(roomsViewPaused(socket)).toBe(false);
    expect(match.pauseTimeout).toBeUndefined();
    expect(messagesOf(socket, 'countdown').map((message) => message.n)).toEqual([3]);

    jest.advanceTimersByTime(3_000);
    expect(room.status).toBe('playing');
    expect(messagesOf(socket, 'countdown').map((message) => message.n)).toEqual([3, 2, 1]);
    expect(matchOf(game, room)?.physics).toBe(originalPhysics);
    expect(match.loop).toBe(originalLoop);
    expect(match.startedAt).toBe(originalStartedAt);
    expect(room.pausesRemaining).toEqual({ left: 1, right: 2 });
    expect(events.emit.mock.calls.filter(([name]) => name === 'game.match.started')).toHaveLength(1);
    expect(game.activeMatchCount()).toBe(1);

    jest.advanceTimersByTime(100);
    expect(match.physics.tick).toBeGreaterThan(frozen.tick);
    expect(match.physics.paddles).toEqual(frozen.paddles);
    expect(match.physics.inputs).toEqual({ left: 0, right: 0 });
  });

  test('pause timeout uses the same three-second resume countdown', async () => {
    const { game, events, socket, room } = makeGame();
    await startMatch(game, room);
    const match = matchOf(game, room)!;
    const startedAt = match.startedAt;
    await game.pause(room, 'b');
    socket.to.mockClear();

    jest.advanceTimersByTime(29_999);
    expect(room.status).toBe('paused');
    expect(messagesOf(socket, 'countdown')).toHaveLength(0);
    jest.advanceTimersByTime(1);
    expect(room.status).toBe('countdown');
    expect(messagesOf(socket, 'countdown').map((message) => message.n)).toEqual([3]);

    jest.advanceTimersByTime(3_000);
    expect(room.status).toBe('playing');
    expect(room.pausesRemaining).toEqual({ left: 2, right: 1 });
    expect(match.startedAt).toBe(startedAt);
    expect(events.emit.mock.calls.filter(([name]) => name === 'game.match.started')).toHaveLength(1);
  });

  test('pause quotas cannot be bypassed by ready and reset only for a genuine rematch', async () => {
    const { game, room } = makeGame();
    await startMatch(game, room);
    const originalMatch = matchOf(game, room);

    await game.pause(room, 'a');
    await game.playerReady(room, 'a');
    await game.playerReady(room, 'b');
    expect(room.status).toBe('paused');
    expect(matchOf(game, room)).toBe(originalMatch);
    expect(room.pausesRemaining).toEqual({ left: 1, right: 2 });
    await game.resume(room, 'a');
    jest.advanceTimersByTime(3_000);

    await pauseAndResume(game, room, 'left');
    await game.pause(room, 'a');
    expect(room.status).toBe('playing');
    expect(room.pausesRemaining).toEqual({ left: 0, right: 2 });

    await pauseAndResume(game, room, 'right');
    await pauseAndResume(game, room, 'right');
    await game.pause(room, 'b');
    expect(room.status).toBe('playing');
    expect(room.pausesRemaining).toEqual({ left: 0, right: 0 });

    await game.playerLeft(room, 'left', 'Ayşe');
    expect(room.status).toBe('finished');
    await game.playerReady(room, 'a');
    await game.playerReady(room, 'b');
    expect(room.status).toBe('countdown');
    expect(room.pausesRemaining).toEqual({ left: 2, right: 2 });
    expect(matchOf(game, room)).not.toBe(originalMatch);
    jest.advanceTimersByTime(3_000);
    expect(room.status).toBe('playing');
    expect(room.pausesRemaining).toEqual({ left: 2, right: 2 });
  });

  test('disconnect during pause cleans up every timer without zombie frames', async () => {
    const { game, rooms, socket, room } = makeGame();
    await startMatch(game, room);
    await game.pause(room, 'a');
    rooms.leave(room.code, 'b');
    await game.playerLeft(room, 'right', 'Mehmet');
    expect(room.status).toBe('finished');
    expect(matchOf(game, room)).toBeUndefined();
    expect(game.activeMatchCount()).toBe(0);
    socket.to.mockClear();

    jest.advanceTimersByTime(60_000);
    expect(socket.to).not.toHaveBeenCalled();
    expect(room.status).toBe('finished');
  });

  test('disconnect during resume countdown cannot restart a deleted match', async () => {
    const { game, rooms, socket, room } = makeGame();
    await startMatch(game, room);
    await game.pause(room, 'a');
    await game.resume(room, 'b');
    expect(room.status).toBe('countdown');
    rooms.leave(room.code, 'a');
    await game.playerLeft(room, 'left', 'Ayşe');
    expect(matchOf(game, room)).toBeUndefined();
    expect(game.activeMatchCount()).toBe(0);
    socket.to.mockClear();

    jest.advanceTimersByTime(60_000);
    expect(socket.to).not.toHaveBeenCalled();
    expect(room.status).toBe('finished');
  });
});

function roomsViewPaused(socket: ReturnType<typeof createTestUlakStub>): boolean {
  return messagesOf(socket, 'room').at(-1)?.room.status === 'paused';
}
