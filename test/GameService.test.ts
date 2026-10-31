import { describe, expect, mock, test } from 'bun:test';
import { createTestUlakStub, mockComponent } from '@asenajs/asena/test';
import { GameService } from '../src/services/GameService';
import { RoomService } from '../src/services/RoomService';

describe('GameService', () => {
  test('a forfeit ends the match and emits game.match.ended', async () => {
    // A real RoomService (its own deps mocked) inside a GameService with mocked Ulak.
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
    await game.playerReady(room, 'b'); // → countdown starts
    expect(room.status).toBe('countdown');

    rooms.leave(room.code, 'b');
    await game.playerLeft(room, 'right', 'Mehmet');

    expect(room.status).toBe('finished');
    const ended = events.emit.mock.calls.find(([name]) => name === 'game.match.ended');
    expect(ended?.[1]).toMatchObject({ winner: { name: 'Ayşe' }, loser: { name: 'Mehmet' }, reason: 'forfeit' });
    expect(socket.to).toHaveBeenCalledWith(`room:${room.code}`, expect.objectContaining({ t: 'end', winner: 'left' }));
    game.stopAll();
  });
});
