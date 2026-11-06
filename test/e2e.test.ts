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
import type { MatchRecord, PlayerStats } from '../src/services/StatsService';

process.env.DISCOVERY_ENABLED = 'false'; // no UDP sockets in tests

const json = (body: unknown): RequestInit => ({
  body: JSON.stringify(body),
  headers: { 'Content-Type': 'application/json' },
});

const boot = async () => {
  const initialRating = process.env.MMR_INITIAL_RATING;
  const kFactor = process.env.MMR_K_FACTOR;
  process.env.MMR_INITIAL_RATING = '1000';
  process.env.MMR_K_FACTOR = '32';

  try {
    return await createTestApp({
      adapter: createErgenecoreAdapter({ logger: silentLogger }),
      components: [
        ServerConfig, ExceptionMapper,
        GlobalCorsMiddleware, ApiRateLimiterMiddleware, RequestLoggerMiddleware,
        GameOriginMiddleware, PlayerHandshakeMiddleware,
        InfoController, RoomController, LeaderboardController, PeerController,
        GameSocket, LobbySocket, GameEventService, LobbyEventService,
      ],
    });
  } finally {
    if (initialRating === undefined) {
      delete process.env.MMR_INITIAL_RATING;
    } else {
      process.env.MMR_INITIAL_RATING = initialRating;
    }
    if (kFactor === undefined) {
      delete process.env.MMR_K_FACTOR;
    } else {
      process.env.MMR_K_FACTOR = kFactor;
    }
  }
};

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
    async next<T extends ServerMessage['t']>(t: T, timeout = 10_000): Promise<Extract<ServerMessage, { t: T }>> {
      const deadline = Date.now() + timeout;
      for (;;) {
        const i = inbox.findIndex((m) => m.t === t);
        if (i >= 0) return inbox.splice(i, 1)[0] as Extract<ServerMessage, { t: T }>;
        if (Date.now() > deadline) throw new Error(`timeout waiting for "${t}"`);
        await new Promise<void>((r) => {
          waiters.push(r);
          setTimeout(r, 100);
        });
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

    let latest: MatchRecord | undefined;
    const deadline = Date.now() + 2_000;
    while (!latest && Date.now() < deadline) {
      const history = (await app.get('/api/leaderboard/matches').expectStatus(200)).json<{ matches: MatchRecord[] }>();
      latest = history.matches.find((record) => record.winner.name === end.winnerName);
      if (!latest) await Bun.sleep(50);
    }
    if (!latest) throw new Error('timeout waiting for match stats');

    const board = (await app.get('/api/leaderboard').expectStatus(200)).json<{ players: PlayerStats[] }>();
    const winner = board.players.find((player) => player.name === end.winnerName);
    const loserName = end.winnerName === 'Ayse' ? 'Mehmet' : 'Ayse';
    const loser = board.players.find((player) => player.name === loserName);
    if (!winner || !loser) throw new Error('match players missing from leaderboard');

    expect(winner.wins).toBe(1);
    expect(winner).toMatchObject({ mmr: 1016, band: 'Usta' });
    expect(loser).toMatchObject({ mmr: 984, band: 'Çırak' });
    expect(latest.matchId.length).toBeGreaterThan(0);
    expect(latest.mmr).toEqual({
      winner: { before: 1000, after: 1016, delta: 16, beforeBand: 'Usta', afterBand: 'Usta' },
      loser: { before: 1000, after: 984, delta: -16, beforeBand: 'Usta', afterBand: 'Çırak' },
    });

    ayse.ws.close();
    mehmet.ws.close();
  }, 20_000);
});
