import { describe, expect, mock, test } from 'bun:test';
import { mockComponent } from '@asenajs/asena/test';
import { RoomService } from '../src/services/RoomService';

// mockComponent: no container, no server — @Inject fields are auto-mocked,
// @Value fields are pinned through overrides. `emitter()` is a string token, so the
// auto-mock is a plain {} — we pass a typed double for it.
const make = () =>
  mockComponent(RoomService, { overrides: { defaultTargetScore: 5, events: { emit: mock(() => true) } } });

describe('RoomService', () => {
  test('creates rooms with unique codes and emits a lobby event', () => {
    const { instance, mocks } = make();
    const a = instance.create();
    const b = instance.create({ name: 'Final', isPublic: false, targetScore: 11 });
    expect(a.code).not.toBe(b.code);
    expect(a.targetScore).toBe(5);
    expect(b.targetScore).toBe(11);
    expect(instance.listPublic().map((r) => r.code)).toEqual([a.code]);
    expect(mocks.events.emit).toHaveBeenCalledWith('lobby.rooms.changed');
  });

  test('seats left, right, then spectators', () => {
    const { instance } = make();
    const room = instance.create();
    expect(instance.join(room.code, 's1', 'Ayşe')).toBe('left');
    expect(instance.join(room.code, 's2', 'Mehmet')).toBe('right');
    expect(instance.join(room.code, 's3', 'Zeynep')).toBe('spectator');
    expect(instance.nameOf(room, 's3')).toBe('Zeynep');
  });

  test('both players ready → true', () => {
    const { instance } = make();
    const room = instance.create();
    instance.join(room.code, 's1', 'A');
    instance.join(room.code, 's2', 'B');
    expect(instance.markReady(room, 's1')).toBe(false);
    expect(instance.markReady(room, 's2')).toBe(true);
  });

  test('quick match pairs players into the same waiting room', () => {
    const { instance } = make();
    const first = instance.quickMatch();
    instance.join(first.code, 's1', 'A');
    expect(instance.quickMatch().code).toBe(first.code);
    instance.join(first.code, 's2', 'B');
    expect(instance.quickMatch().code).not.toBe(first.code);
  });

  test('room disappears when the last member leaves', () => {
    const { instance } = make();
    const room = instance.create();
    instance.join(room.code, 's1', 'A');
    expect(instance.leave(room.code, 's1')).toEqual({ role: 'left', room: null });
    expect(instance.find(room.code)).toBeUndefined();
  });

  test('sweepStale removes idle rooms but never a running match', () => {
    const { instance } = make();
    const idle = instance.create();
    const playing = instance.create();
    instance.setStatus(playing, 'playing');
    const removed = instance.sweepStale(1000, Date.now() + 60_000);
    expect(removed).toEqual([idle.code]);
    expect(instance.find(playing.code)).toBeDefined();
  });

  test('get() throws a 404 HttpException for unknown rooms', () => {
    const { instance } = make();
    expect(() => instance.get('NOPE1')).toThrow();
  });
});
