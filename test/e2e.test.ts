import { describe, expect, test } from 'bun:test';
import { createTestApp, silentLogger } from '@asenajs/asena/test';
import { createErgenecoreAdapter } from '@asenajs/ergenecore';
import type { ServerMessage } from '../src/game/protocol';
import { ServerConfig } from '../src/config/ServerConfig';
import { InfoController } from '../src/controllers/InfoController';
import { LeaderboardController } from '../src/controllers/LeaderboardController';
import { PeerController } from '../src/controllers/PeerController';
import { RoomController } from '../src/controllers/RoomController';
import { GameEventService } from '../src/events/GameEventService';
import { LobbyEventService } from '../src/events/LobbyEventService';
import { ExceptionMapper } from '../src/exceptions/ExceptionMapper';
import { ApiRateLimiterMiddleware } from '../src/middlewares/ApiRateLimiterMiddleware';
import { GameOriginMiddleware } from '../src/middlewares/GameOriginMiddleware';
import { GlobalCorsMiddleware } from '../src/middlewares/GlobalCorsMiddleware';
import { PlayerHandshakeMiddleware } from '../src/middlewares/PlayerHandshakeMiddleware';
import { RequestLoggerMiddleware } from '../src/middlewares/RequestLoggerMiddleware';
import { GameSocket } from '../src/namespaces/GameSocket';
import { LobbySocket } from '../src/namespaces/LobbySocket';

process.env.DISCOVERY_ENABLED = 'false'; // no UDP sockets in tests

const json = (body: unknown): RequestInit => ({
  body: JSON.stringify(body),
  headers: { 'Content-Type': 'application/json' },
});

const boot = () =>
  createTestApp({
    adapter: createErgenecoreAdapter({ logger: silentLogger }),
    components: [
      ServerConfig, ExceptionMapper,
      GlobalCorsMiddleware, ApiRateLimiterMiddleware, RequestLoggerMiddleware,
      GameOriginMiddleware, PlayerHandshakeMiddleware,
      InfoController, RoomController, LeaderboardController, PeerController,
      GameSocket, LobbySocket, GameEventService, LobbyEventService,
    ],
  });

/** Minimal WebSocket test client that buffers frames and can wait for one. */
function player(baseUrl: string, code: string, name: string) {
  const ws = new WebSocket(`${baseUrl.replace('http', 'ws')}/ws/game?room=${code}&name=${name}`);
  const inbox: ServerMessage[] = [];
  const waiters: Array<() => void> = [];
  ws.onmessage = (e) => {
    inbox.push(JSON.parse(String(e.data)));
    waiters.splice(0).forEach((w) => w());
  };
  const opened = new Promise((r) => (ws.onopen = r));
  return {
    ws,
    opened,
    send: (m: object) => ws.send(JSON.stringify(m)),
    async next<T extends ServerMessage['t']>(
      t: T,
      timeout = 10_000,
      predicate: (message: Extract<ServerMessage, { t: T }>) => boolean = () => true,
    ): Promise<Extract<ServerMessage, { t: T }>> {
      const deadline = Date.now() + timeout;
      for (;;) {
        const i = inbox.findIndex((m): m is Extract<ServerMessage, { t: T }> => m.t === t && predicate(m as Extract<ServerMessage, { t: T }>));
        if (i >= 0) return inbox.splice(i, 1)[0] as Extract<ServerMessage, { t: T }>;
        if (Date.now() > deadline) throw new Error(`timeout waiting for "${t}"`);
        await new Promise<void>((r) => {
          waiters.push(r);
          setTimeout(r, 100);
        });
      }
    },
    drain<T extends ServerMessage['t']>(t: T): Array<Extract<ServerMessage, { t: T }>> {
      const drained = inbox.filter((m): m is Extract<ServerMessage, { t: T }> => m.t === t);
      for (let i = inbox.length - 1; i >= 0; i--) if (inbox[i].t === t) inbox.splice(i, 1);
      return drained;
    },
    clear(): void {
      inbox.length = 0;
    },
    async noMessage<T extends ServerMessage['t']>(
      t: T,
      duration: number,
      predicate: (message: Extract<ServerMessage, { t: T }>) => boolean = () => true,
    ): Promise<void> {
      const deadline = Date.now() + duration;
      while (Date.now() < deadline) {
        if (inbox.some((m) => m.t === t && predicate(m as Extract<ServerMessage, { t: T }>))) {
          throw new Error(`unexpected "${t}" message`);
        }
        await Bun.sleep(Math.min(50, Math.max(1, deadline - Date.now())));
      }
    },
  };
}

describe('Asena Peer Pong (full app)', () => {
  test('REST: create room, validation errors, 404s', async () => {
    await using app = await boot();
    const created = await app.post('/api/rooms', json({ targetScore: 3 })).expectStatus(201);
    const code = created.json<{ room: { code: string } }>().room.code;
    await app.get(`/api/rooms/${code}`).expectStatus(200).expectJsonContains({ room: { code } });
    await app.post('/api/rooms', json({ targetScore: 500 })).expectStatus(400).expectJsonContains({ error: 'VALIDATION_FAILED' });
    await app.get('/api/rooms/ZZZZZ').expectStatus(404).expectJsonContains({ error: 'ROOM_NOT_FOUND' });
    await app.get('/does-not-exist').expectStatus(404).expectJsonContains({ error: 'NOT_FOUND' });
    await app.get('/api/info').expectStatus(200).expectJsonContains({ app: 'asena-peer-pong' });
  });

  test('WebSocket: handshake rejects unknown rooms', async () => {
    await using app = await boot();
    const res = await fetch(`${app.baseUrl}/ws/game?room=NOPE1&name=x`, {
      headers: { Upgrade: 'websocket', Connection: 'Upgrade', 'Sec-WebSocket-Key': 'dGhlIHNhbXBsZSBub25jZQ==', 'Sec-WebSocket-Version': '13' },
    });
    expect(res.status).toBe(404);
  });

  test('WebSocket: two players play a full match to 1 point', async () => {
    await using app = await boot();
    const { room } = (await app.post('/api/rooms', json({ targetScore: 1 })).expectStatus(201)).json<{ room: { code: string } }>();

    const ayse = player(app.baseUrl, room.code, 'Ayse');
    expect((await ayse.next('welcome')).role).toBe('left');
    const mehmet = player(app.baseUrl, room.code, 'Mehmet');
    expect((await mehmet.next('welcome')).role).toBe('right');

    ayse.send({ t: 'chat', text: 'iyi oyunlar' });
    expect((await mehmet.next('chat')).text).toBe('iyi oyunlar');

    ayse.send({ t: 'ready' });
    mehmet.send({ t: 'ready' });
    expect((await ayse.next('countdown')).n).toBe(3);
    await mehmet.next('state');

    const end = await ayse.next('end', 15_000);
    expect(end.reason).toBe('score');
    expect(end.score.left + end.score.right).toBe(1);

    // GameEventService → StatsService recorded it (events are async; give it a tick)
    await Bun.sleep(50);
    const board = (await app.get('/api/leaderboard').expectStatus(200)).json<{ players: { name: string; wins: number }[] }>();
    expect(board.players.find((p) => p.wins === 1)?.name).toBe(end.winnerName);

    ayse.ws.close();
    mehmet.ws.close();
  }, 20_000);

  test('WebSocket: seated players pause and resume a frozen match', async () => {
    await using app = await boot();
    const { room } = (await app.post('/api/rooms', json({ targetScore: 21 })).expectStatus(201)).json<{ room: { code: string } }>();
    const ayse = player(app.baseUrl, room.code, 'Ayse');
    expect((await ayse.next('welcome')).role).toBe('left');
    const mehmet = player(app.baseUrl, room.code, 'Mehmet');
    expect((await mehmet.next('welcome')).role).toBe('right');
    const spectator = player(app.baseUrl, room.code, 'Zeynep');
    expect((await spectator.next('welcome')).role).toBe('spectator');

    try {
      ayse.send({ t: 'ready' });
      mehmet.send({ t: 'ready' });
      await ayse.next('room', 10_000, (message) => message.room.status === 'playing');
      const initial = await ayse.next('state');
      ayse.clear();
      mehmet.clear();
      spectator.clear();

      spectator.send({ t: 'pause' });
      await ayse.noMessage('room', 200, (message) => message.room.status === 'paused');

      ayse.send({ t: 'pause' });
      const paused = await ayse.next('room', 10_000, (message) => message.room.status === 'paused');
      expect(paused.room.pause?.by).toBe('left');
      expect(paused.room.pausesRemaining).toEqual({ left: 1, right: 2 });
      expect(paused.room.pause?.remainingMs).toBeGreaterThan(0);
      expect(paused.room.pause?.remainingMs).toBeLessThanOrEqual(30_000);
      const frozen = ayse.drain('state').at(-1) ?? initial;
      expect(frozen).toBeDefined();
      await ayse.noMessage('state', 250);

      ayse.send({ t: 'input', dir: 1 });
      spectator.send({ t: 'resume' });
      await ayse.noMessage('countdown', 200);
      await ayse.noMessage('state', 200);

      mehmet.send({ t: 'resume' });
      expect((await ayse.next('countdown', 10_000, (message) => message.n === 3)).n).toBe(3);
      const resumed = await ayse.next('room', 10_000, (message) => message.room.status === 'playing');
      expect(resumed.room.pausesRemaining).toEqual({ left: 1, right: 2 });
      expect(resumed.room.pause).toBeNull();
      const next = await ayse.next('state');
      expect(next.s.tick).toBeGreaterThan(frozen!.s.tick);
      expect(next.s.paddles).toEqual(frozen!.s.paddles);
    } finally {
      ayse.ws.close();
      mehmet.ws.close();
      spectator.ws.close();
    }
  }, 20_000);

  test('WebSocket: an active pause times out into countdown and resumes automatically', async () => {
    await using app = await boot();
    const { room } = (await app.post('/api/rooms', json({ targetScore: 21 })).expectStatus(201)).json<{ room: { code: string } }>();
    const ayse = player(app.baseUrl, room.code, 'Ayse');
    await ayse.next('welcome');
    const mehmet = player(app.baseUrl, room.code, 'Mehmet');
    await mehmet.next('welcome');

    try {
      ayse.send({ t: 'ready' });
      mehmet.send({ t: 'ready' });
      await ayse.next('room', 10_000, (message) => message.room.status === 'playing');
      const initial = await ayse.next('state');
      ayse.clear();
      mehmet.clear();

      const pausedAt = Date.now();
      ayse.send({ t: 'pause' });
      const paused = await ayse.next('room', 10_000, (message) => message.room.status === 'paused');
      expect(paused.room.pausesRemaining).toEqual({ left: 1, right: 2 });
      const frozen = ayse.drain('state').at(-1) ?? initial;
      expect(frozen).toBeDefined();

      await ayse.next('room', 35_000, (message) => message.room.status === 'countdown');
      expect(Date.now() - pausedAt).toBeGreaterThanOrEqual(29_000);
      expect((await ayse.next('countdown', 5_000, (message) => message.n === 3)).n).toBe(3);
      const resumed = await ayse.next('room', 10_000, (message) => message.room.status === 'playing');
      expect(resumed.room.pausesRemaining).toEqual({ left: 1, right: 2 });
      const next = await ayse.next('state');
      expect(next.s.tick).toBeGreaterThan(frozen!.s.tick);
    } finally {
      ayse.ws.close();
      mehmet.ws.close();
    }
  }, 50_000);
});
