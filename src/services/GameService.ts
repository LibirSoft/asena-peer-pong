import { Service } from '@asenajs/asena/decorators';
import { Inject, OnStop } from '@asenajs/asena/decorators/ioc';
import { emitter, type EventEmitter } from '@asenajs/asena/event';
import { ulak, type Ulak } from '@asenajs/asena/messaging';
import { ICoreServiceNames } from '@asenajs/asena/ioc/types';
import type { ServerLogger } from '@asenajs/asena/logger';
import { BROADCAST_EVERY_N_TICKS, COUNTDOWN_SECONDS, TICK_RATE } from '../game/constants';
import { PongPhysics } from '../game/PongPhysics';
import type { ServerMessage, Side } from '../game/protocol';
import { RoomService, type Room } from './RoomService';

interface Match {
  physics: PongPhysics;
  loop?: ReturnType<typeof setInterval>;
  countdown?: ReturnType<typeof setTimeout>;
  startedAt: number;
}

export interface MatchEndedEvent {
  code: string;
  winner: { side: Side; name: string };
  loser: { side: Side; name: string };
  score: { left: number; right: number };
  reason: 'score' | 'forfeit';
  durationMs: number;
}

/** Topic name used for every socket in a room. */
export const roomTopic = (code: string) => `room:${code}`;

/**
 * Authoritative game loop. The server simulates every match and pushes
 * snapshots; clients only send paddle direction — nobody can cheat the ball.
 *
 * Shows:
 *  - Ulak: `@Inject(ulak('/ws/game'))` sends WebSocket messages WITHOUT injecting
 *    the GameSocket namespace (GameSocket injects this service → no circular dependency).
 *  - In-process events via `emitter()` (game.match.started / ended).
 *  - `@OnStop` to clean up timers during graceful shutdown.
 *  - Core logger injection through ICoreServiceNames.
 */
@Service('GameService')
export class GameService {
  @Inject(RoomService)
  private rooms: RoomService;

  @Inject(ulak('/ws/game'))
  private socket: Ulak.NameSpace<'/ws/game'>;

  @Inject(emitter())
  private events: EventEmitter;

  @Inject(ICoreServiceNames.SERVER_LOGGER)
  private logger: ServerLogger;

  private readonly matches = new Map<string, Match>();

  public activeMatchCount(): number {
    return [...this.matches.values()].filter((m) => m.loop).length;
  }

  /** Pushes the current room view to everybody in the room. */
  public publishRoom(room: Room): Promise<void> {
    return this.send(room.code, { t: 'room', room: this.rooms.toView(room) });
  }

  /** Called when a player pressed "ready". Starts the countdown once both are ready. */
  public async playerReady(room: Room, socketId: string): Promise<void> {
    const bothReady = this.rooms.markReady(room, socketId);
    await this.publishRoom(room);
    if (bothReady) await this.startCountdown(room);
  }

  public setInput(code: string, side: Side, dir: -1 | 0 | 1): void {
    const match = this.matches.get(code);
    if (match) match.physics.inputs[side] = dir;
  }

  /** A seated player disconnected. Mid-match that is a forfeit. */
  public async playerLeft(room: Room, side: Side, name: string): Promise<void> {
    const match = this.matches.get(room.code);
    if (match && (room.status === 'playing' || room.status === 'countdown')) {
      const winner: Side = side === 'left' ? 'right' : 'left';
      await this.finish(room, winner, 'forfeit', { side, name });
    }
  }

  /** The room was deleted (everyone left) — make sure no timer keeps running. */
  public discard(code: string): void {
    this.stop(code);
    this.matches.delete(code);
  }

  private async startCountdown(room: Room): Promise<void> {
    this.discard(room.code);
    const match: Match = { physics: new PongPhysics(), startedAt: Date.now() };
    this.matches.set(room.code, match);

    this.rooms.setStatus(room, 'countdown');
    await this.publishRoom(room);
    await this.send(room.code, { t: 'state', s: match.physics.snapshot() });

    let n = COUNTDOWN_SECONDS;
    const countdownStep = () => {
      if (n > 0) {
        this.send(room.code, { t: 'countdown', n });
        n--;
        match.countdown = setTimeout(countdownStep, 1000);
        return;
      }
      match.countdown = undefined;
      this.startLoop(room, match);
    };
    countdownStep();
  }

  private startLoop(room: Room, match: Match): void {
    this.rooms.setStatus(room, 'playing');
    match.startedAt = Date.now();
    this.publishRoom(room);
    this.events.emit('game.match.started', { code: room.code, players: this.rooms.toView(room).players });

    const dt = 1 / TICK_RATE;
    match.loop = setInterval(() => {
      const scorer = match.physics.step(dt);
      if (scorer) {
        const score = { ...match.physics.score };
        this.send(room.code, { t: 'scored', side: scorer, score });
        this.events.emit('game.point.scored', { code: room.code, side: scorer, score });
        if (score[scorer] >= room.targetScore) {
          this.finish(room, scorer, 'score').catch((e) => this.logger.error('finish failed', e));
          return;
        }
      }
      if (match.physics.tick % BROADCAST_EVERY_N_TICKS === 0) {
        this.send(room.code, { t: 'state', s: match.physics.snapshot() });
      }
    }, 1000 / TICK_RATE);
  }

  private async finish(room: Room, winner: Side, reason: 'score' | 'forfeit', leaver?: { side: Side; name: string }) {
    const match = this.matches.get(room.code);
    if (!match) return;
    this.stop(room.code);
    this.matches.delete(room.code);

    const loserSide: Side = winner === 'left' ? 'right' : 'left';
    const nameOf = (side: Side) => room.players[side]?.name ?? (leaver?.side === side ? leaver.name : 'Bilinmeyen');
    const score = { ...match.physics.score };

    this.rooms.setStatus(room, 'finished');
    await this.send(room.code, { t: 'end', winner, winnerName: nameOf(winner), score, reason });
    await this.publishRoom(room);

    const event: MatchEndedEvent = {
      code: room.code,
      winner: { side: winner, name: nameOf(winner) },
      loser: { side: loserSide, name: nameOf(loserSide) },
      score,
      reason,
      durationMs: Date.now() - match.startedAt,
    };
    this.events.emit('game.match.ended', event);
  }

  private stop(code: string): void {
    const match = this.matches.get(code);
    if (!match) return;
    if (match.loop) clearInterval(match.loop);
    if (match.countdown) clearTimeout(match.countdown);
    match.loop = match.countdown = undefined;
  }

  /** Sends to a room; never lets a rejected promise escape a timer callback. */
  private send(code: string, message: ServerMessage): Promise<void> {
    // ulak serializes objects itself — never JSON.stringify here.
    return this.socket.to(roomTopic(code), message).catch((error) => {
      this.logger.warn(`[game] could not deliver "${message.t}" to room ${code}`, error);
    });
  }

  @OnStop()
  public stopAll(): void {
    for (const code of this.matches.keys()) this.stop(code);
    this.matches.clear();
  }
}
