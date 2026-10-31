import { Service } from '@asenajs/asena/decorators';
import { Inject, Value } from '@asenajs/asena/decorators/ioc';
import { HttpException } from '@asenajs/asena/adapter';
import { emitter, type EventEmitter } from '@asenajs/asena/event';
import { ROOM_CODE_ALPHABET, ROOM_CODE_LENGTH } from '../game/constants';
import type { Role, RoomStatus, RoomView, Side } from '../game/protocol';

interface PlayerSlot {
  socketId: string;
  name: string;
  ready: boolean;
}

export interface Room {
  code: string;
  name: string;
  isPublic: boolean;
  targetScore: number;
  status: RoomStatus;
  players: Record<Side, PlayerSlot | null>;
  spectators: Map<string, string>; // socketId → name
  createdAt: number;
  lastActivity: number;
}

export interface CreateRoomInput {
  name?: string;
  isPublic?: boolean;
  targetScore?: number;
}

/**
 * Owns every room on this instance and the rules around them
 * (who sits where, who is ready, when a room is stale).
 *
 * Bun pub/sub topics are not enumerable, so the room roster lives here —
 * the WebSocket namespace only uses topics for delivery.
 *
 * Shows: @Service with explicit name, @Value, @Inject(emitter()) for domain events,
 *        HttpException thrown from the service layer.
 */
@Service('RoomService')
export class RoomService {
  @Inject(emitter())
  private events: EventEmitter;

  @Value('DEFAULT_TARGET_SCORE', { parse: Number, default: 7 })
  private defaultTargetScore: number;

  private readonly rooms = new Map<string, Room>();

  public create(input: CreateRoomInput = {}): Room {
    const code = this.generateCode();
    const room: Room = {
      code,
      name: input.name?.trim() || 'Pong odası',
      isPublic: input.isPublic ?? true,
      targetScore: input.targetScore ?? this.defaultTargetScore,
      status: 'waiting',
      players: { left: null, right: null },
      spectators: new Map(),
      createdAt: Date.now(),
      lastActivity: Date.now(),
    };
    this.rooms.set(code, room);
    this.changed();
    return room;
  }

  /** Returns a public room that waits for an opponent, or opens a fresh one. */
  public quickMatch(): Room {
    const waiting = [...this.rooms.values()]
      .filter((r) => r.isPublic && r.status === 'waiting' && this.playerCount(r) === 1)
      .sort((a, b) => a.createdAt - b.createdAt)[0];
    return waiting ?? this.create({ isPublic: true });
  }

  public find(code: string): Room | undefined {
    return this.rooms.get(code.toUpperCase());
  }

  public get(code: string): Room {
    const room = this.find(code);
    if (!room) throw new HttpException(404, { error: 'ROOM_NOT_FOUND', message: `Room ${code} does not exist` });
    return room;
  }

  public listPublic(): RoomView[] {
    return [...this.rooms.values()]
      .filter((r) => r.isPublic)
      .sort((a, b) => b.createdAt - a.createdAt)
      .map((r) => this.toView(r));
  }

  public openRoomCount(): number {
    return [...this.rooms.values()].filter((r) => r.isPublic && this.playerCount(r) < 2).length;
  }

  public totalRooms(): number {
    return this.rooms.size;
  }

  /** Seats the socket: first free paddle, otherwise as a spectator. */
  public join(code: string, socketId: string, name: string): Role {
    const room = this.get(code);
    room.lastActivity = Date.now();

    const side: Side | null = !room.players.left ? 'left' : !room.players.right ? 'right' : null;
    if (side && room.status !== 'playing' && room.status !== 'countdown') {
      room.players[side] = { socketId, name, ready: false };
      this.changed();
      return side;
    }
    room.spectators.set(socketId, name);
    this.changed();
    return 'spectator';
  }

  /** Removes the socket from the room; deletes the room when nobody is left. */
  public leave(code: string, socketId: string): { role: Role | null; room: Room | null } {
    const room = this.find(code);
    if (!room) return { role: null, room: null };

    const role = this.roleOf(room, socketId);
    if (role === 'spectator') room.spectators.delete(socketId);
    else if (role) room.players[role] = null;

    room.lastActivity = Date.now();
    if (!room.players.left && !room.players.right && room.spectators.size === 0) {
      this.rooms.delete(room.code);
      this.changed();
      return { role, room: null };
    }
    this.changed();
    return { role, room };
  }

  public roleOf(room: Room, socketId: string): Role | null {
    if (room.players.left?.socketId === socketId) return 'left';
    if (room.players.right?.socketId === socketId) return 'right';
    if (room.spectators.has(socketId)) return 'spectator';
    return null;
  }

  public nameOf(room: Room, socketId: string): string {
    const role = this.roleOf(room, socketId);
    if (role === 'spectator') return room.spectators.get(socketId) ?? 'İzleyici';
    return (role && room.players[role]?.name) || 'Bilinmeyen';
  }

  /** Marks a player ready. Returns true when BOTH paddles are seated and ready. */
  public markReady(room: Room, socketId: string): boolean {
    const role = this.roleOf(room, socketId);
    if (role !== 'left' && role !== 'right') return false;
    if (room.status === 'playing' || room.status === 'countdown') return false;

    room.players[role]!.ready = true;
    room.lastActivity = Date.now();
    this.changed();
    return !!room.players.left?.ready && !!room.players.right?.ready;
  }

  public setStatus(room: Room, status: RoomStatus): void {
    room.status = status;
    room.lastActivity = Date.now();
    if (status === 'finished') {
      if (room.players.left) room.players.left.ready = false;
      if (room.players.right) room.players.right.ready = false;
    }
    this.changed();
  }

  /** Drops rooms nobody touched for `maxIdleMs`. Called by RoomCleanupSchedule. */
  public sweepStale(maxIdleMs: number, now = Date.now()): string[] {
    const removed: string[] = [];
    for (const room of this.rooms.values()) {
      const idle = now - room.lastActivity > maxIdleMs;
      const active = room.status === 'playing' || room.status === 'countdown';
      if (idle && !active) {
        this.rooms.delete(room.code);
        removed.push(room.code);
      }
    }
    if (removed.length) this.changed();
    return removed;
  }

  public toView(room: Room): RoomView {
    const player = (slot: PlayerSlot | null) => (slot ? { name: slot.name, ready: slot.ready, connected: true } : null);
    return {
      code: room.code,
      name: room.name,
      isPublic: room.isPublic,
      targetScore: room.targetScore,
      status: room.status,
      players: { left: player(room.players.left), right: player(room.players.right) },
      spectators: room.spectators.size,
      createdAt: room.createdAt,
    };
  }

  private playerCount(room: Room): number {
    return (room.players.left ? 1 : 0) + (room.players.right ? 1 : 0);
  }

  private generateCode(): string {
    for (;;) {
      let code = '';
      const bytes = crypto.getRandomValues(new Uint8Array(ROOM_CODE_LENGTH));
      for (const b of bytes) code += ROOM_CODE_ALPHABET[b % ROOM_CODE_ALPHABET.length];
      if (!this.rooms.has(code)) return code;
    }
  }

  /** Domain event — LobbyEventService pushes the new list to lobby sockets. */
  private changed(): void {
    this.events.emit('lobby.rooms.changed');
  }
}
