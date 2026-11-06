import { describe, expect, mock, test } from 'bun:test';
import { createTestUlakStub, mockComponent } from '@asenajs/asena/test';
import { GameService, type MatchEndedEvent } from '../src/services/GameService';
import { RoomService } from '../src/services/RoomService';

describe('GameService', () => {
  const make = async () => {
    const { instance: rooms } = mockComponent(RoomService, {
      overrides: { defaultTargetScore: 7, events: { emit: mock(() => true) } },
    });
    const events = { emit: mock((_name: string, _data?: unknown) => true) };
    const logger = { info: mock(), warn: mock(), error: mock() };
    const socket = createTestUlakStub('/ws/game');
    const { instance: game } = mockComponent(GameService, { overrides: { rooms, socket, events, logger } });
    const room = rooms.create();
    rooms.join(room.code, 'a', 'Ayşe');
    rooms.join(room.code, 'b', 'Mehmet');
    await game.playerReady(room, 'a');
    await game.playerReady(room, 'b');

    return { game, rooms, room, events, socket };
  };

  test('a forfeit ends the match and emits game.match.ended with a match ID', async () => {
    const { game, rooms, room, events, socket } = await make();
    expect(room.status).toBe('countdown');

    rooms.leave(room.code, 'b');
    await game.playerLeft(room, 'right', 'Mehmet');

    expect(room.status).toBe('finished');
    const ended = events.emit.mock.calls.find(([name]) => name === 'game.match.ended');
    const event = ended?.[1] as MatchEndedEvent;
    expect(typeof event.matchId).toBe('string');
    expect(event.matchId.length).toBeGreaterThan(0);
    expect(event).toMatchObject({ winner: { name: 'Ayşe' }, loser: { name: 'Mehmet' }, reason: 'forfeit' });
    expect(socket.to).toHaveBeenCalledWith(`room:${room.code}`, expect.objectContaining({ t: 'end', winner: 'left' }));
    game.stopAll();
  });

  test('successive matches in the same room emit different match IDs', async () => {
    const { game, rooms, room, events } = await make();

    rooms.leave(room.code, 'b');
    await game.playerLeft(room, 'right', 'Mehmet');
    rooms.join(room.code, 'b2', 'Mehmet');
    await game.playerReady(room, 'a');
    await game.playerReady(room, 'b2');
    rooms.leave(room.code, 'b2');
    await game.playerLeft(room, 'right', 'Mehmet');

    const ended = events.emit.mock.calls
      .filter(([name]) => name === 'game.match.ended')
      .map(([, event]) => event as MatchEndedEvent);
    expect(ended).toHaveLength(2);
    expect(ended[0].matchId.length).toBeGreaterThan(0);
    expect(ended[1].matchId.length).toBeGreaterThan(0);
    expect(ended[0].matchId).not.toBe(ended[1].matchId);
    game.stopAll();
  });

  test('a repeated disconnect completion emits only one ended event', async () => {
    const { game, rooms, room, events } = await make();

    rooms.leave(room.code, 'b');
    await game.playerLeft(room, 'right', 'Mehmet');
    await game.playerLeft(room, 'right', 'Mehmet');

    expect(events.emit.mock.calls.filter(([name]) => name === 'game.match.ended')).toHaveLength(1);
    game.stopAll();
  });
});
