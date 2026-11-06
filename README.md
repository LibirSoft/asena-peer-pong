# 🏓 Asena Peer Pong

Online multiplayer Pong built with [AsenaJS](https://asena.sh), played in the browser.

- **Host it** with a single `docker run`, and anyone can play.
- **Or run it on your own machine.** Two people each start the app on their own computer and connect to each other. On the same network they find each other automatically through UDP discovery; otherwise one types in the other's address.
- **The game UI is in Turkish**; the UI labels quoted below are translations.
- **A reference app.** It uses almost every core AsenaJS feature in a real setting. The [feature map](#asena-features--files) below tells you which file shows what.

```
Browser A ──ws──┐                          ┌── /ws/lobby  (live rooms / peers feed)
                ├──► Asena instance ───────┼── /ws/game   (60 Hz authoritative game loop)
Browser B ──ws──┘   (simulates the match)  └── /api/*     (REST + OpenAPI)
```

A match always runs on **one** instance, and both players' browsers connect to that instance. Physics run on the server. Clients only send their paddle direction (`-1/0/1`), so nobody can cheat the ball.

---

## Quick start

```bash
bun install          # requires Bun >= 1.4.0
bun run dev          # http://localhost:3000  (hot reload)
bun test             # unit + end-to-end tests (a real WebSocket match)
```

Production:

```bash
bun run build        # asena build → dist/index.asena.js
bun run start:prod
```

API reference: `http://localhost:3000/api/docs/ui` (Scalar), with the raw OpenAPI 3.1 JSON at `/api/docs`.

---

## Two people, two computers: playing peer-to-peer

Each player starts the app on their own machine (`bun run dev` or Docker). Then:

| Situation | What to do |
|---|---|
| **Same Wi-Fi / LAN** | Nothing. Instances find each other through UDP beacons and show up under **“Peers”** in the lobby. Pick “Rooms” → “Join”, or “Open a room on this peer and join”. |
| **Over the internet** | The host forwards port 3000, or you both use [Tailscale](https://tailscale.com) or ZeroTier. The other player enters that address (`100.x.y.z:3000`, `home-pc.tailnet.ts.net:3000`, …) in the “Connect” box. |
| **A friend who doesn't install anything** | Send them the link from “Copy invite link” (`http://192.168.1.33:3000/?room=K7QXA`). Opening it drops them straight into your room on your instance. |

How it works (`src/services/PeerDiscoveryService.ts`):

1. Every instance broadcasts a small JSON beacon on `udp/41234` every 2 seconds: id, name, HTTP port and number of open rooms.
2. If a second instance starts on the same machine, port 41234 is already taken, so it binds an ephemeral port. To cover that case, the instance that owns 41234 also sends a **unicast reply** to every beacon it receives, and the two instances still see each other.
3. Manual peers (`POST /api/peers`): the server calls the remote `/api/info` and validates the answer with zod. Anything that isn't an asena-peer-pong instance is rejected.
4. When you join a peer's room, your browser connects **directly** to that peer's `/ws/game`. There is no relay. The REST API sends open CORS headers, and `ALLOWED_ORIGINS` sets the WebSocket origin policy.

> Docker's default bridge network does not carry UDP broadcasts. For LAN discovery inside Docker, run
> with `--network host -e DISCOVERY_ENABLED=true` (Linux), or add peers manually.

---

## Hosting with Docker

```bash
docker build -t asena-peer-pong .
docker run -d -p 3000:3000 --name pong asena-peer-pong
# or
docker compose up -d                 # public hosting
docker compose --profile lan up -d   # Linux: host network + LAN discovery
```

- Multi-stage build: `asena build` runs in the build stage. The runtime image holds only Bun and the bundle, with no `node_modules` (~195 MB).
- `HEALTHCHECK` targets Asena's health server at `:3001/healthz/live`. For Kubernetes readiness, use `/healthz/ready`.
- On `SIGTERM`, Asena shuts down gracefully: `@OnStop` hooks stop the game loops and close the UDP socket, and the WebSockets are drained.
- Behind a reverse proxy (nginx, Caddy, Traefik), set `TRUST_PROXY=true` so the rate limiter sees real client IPs, and make sure the proxy forwards the WebSocket upgrade headers.

### Environment variables

| Variable | Default | Description |
|---|---|---|
| `PORT` | `3000` | HTTP + WebSocket |
| `HEALTH_PORT` | `3001` | `/healthz/live`, `/healthz/ready` |
| `HOST` | `0.0.0.0` | Interface to bind |
| `INSTANCE_NAME` | hostname | Name shown in other players' peer lists |
| `PUBLIC_URL` | — | Public address used in invite links (`https://pong.example.com`) |
| `DISCOVERY_ENABLED` | `true` (`false` in Docker) | UDP LAN discovery |
| `DISCOVERY_PORT` | `41234` | Discovery port (UDP) |
| `ALLOWED_ORIGINS` | `*` | Allowed WebSocket origins, comma separated. Lock this down on a public server. |
| `TRUST_PROXY` | `false` | Let the rate limiter trust `X-Forwarded-For` |
| `REDIS_URL` | — | When set, enables `RedisTransport` for lobby broadcasts (multi-pod) |
| `DEFAULT_TARGET_SCORE` | `7` | Points needed to win a match |
| `MMR_INITIAL_RATING` | `1000` | Rating used when a display name first completes a match |
| `MMR_K_FACTOR` | `32` | K-factor used for each zero-sum Elo update |
| `ROOM_IDLE_MINUTES` | `10` | Rooms idle for this many minutes are removed |

> **Scaling note:** match state lives in the memory of the pod that owns the room. If you run several
> pods, route `/ws/game?room=X` stickily so one room always reaches the same pod. `REDIS_URL` only
> carries lobby broadcasts between pods.

---

## MMR and leaderboard

`MmrService` calculates ratings and `StatsService` is the single idempotent writer for player aggregates, ratings, and match history. A display-name identity is initialized lazily at `MMR_INITIAL_RATING` (default `1000`) when its first completed match is recorded; that value is the input to the first update, not an extra unrated match.

For winner rating `Rw`, loser rating `Rl`, and K-factor `K` (`MMR_K_FACTOR`, default `32`), the zero-sum Elo update is:

```text
Ew    = 1 / (1 + 10 ** ((Rl - Rw) / 400))
delta = round(K * (1 - Ew))
winner = Rw + delta
loser  = Rl - delta
```

One integer delta is calculated and applied in opposite directions, so every rated two-player match is zero-sum. There is no rating floor, provisional period, or score-margin multiplier.

Every integer rating maps to exactly one fixed band:

| Band | Inclusive rating rule |
|---|---|
| `Çırak` | `rating <= 999` |
| `Usta` | `1000 <= rating <= 1499` |
| `Efsane` | `rating >= 1500` |

The default initial rating `1000` is the inclusive lower boundary of `Usta`. There is no rating floor, so negative ratings remain possible and are `Çırak`; `Efsane` has no upper cap. These thresholds and names are fixed, not configurable.

Bands are derived from MMR only. They do not change Elo updates, numeric leaderboard ordering, match completion or idempotency, or quick matching.

Normal score completions and all forfeits, including a disconnect during countdown, are rated identically. Every rematch receives a fresh UUID `matchId` and is rated again from the current ratings. `StatsService` ignores an already processed `matchId` without changing aggregates, ratings, or history; processed IDs live for the process lifetime and are not evicted with the 100-row public history. Discarded rooms and matches stopped by shutdown are not rated. The game has no ties. Quick matching remains oldest-waiting-room based and does not use MMR.

### Leaderboard API

`GET /api/leaderboard?limit=20` adds `mmr` and its current `band` to every player and sorts by MMR descending, then wins descending, losses ascending, and points for descending. The current band reflects the player's MMR after all recorded matches:

```json
{
  "players": [
    {
      "name": "Ayse",
      "wins": 1,
      "losses": 0,
      "pointsFor": 7,
      "pointsAgainst": 3,
      "mmr": 1016,
      "band": "Usta"
    }
  ]
}
```

`GET /api/leaderboard/matches?limit=20` includes the unique `matchId` and an `mmr` snapshot on every recent-match record. `before`, `after`, and `delta` are fixed pre-match/post-match values for that record. `beforeBand` and `afterBand` classify those snapshots, not the player's later current rating:

```json
{
  "matches": [
    {
      "matchId": "0f6b2131-9a52-4f17-a5af-49951b16d804",
      "code": "K7QXA",
      "winner": { "side": "left", "name": "Ayse" },
      "loser": { "side": "right", "name": "Mehmet" },
      "score": { "left": 7, "right": 3 },
      "reason": "score",
      "durationMs": 42000,
      "endedAt": 1760000000000,
      "mmr": {
        "winner": { "before": 1000, "after": 1016, "delta": 16, "beforeBand": "Usta", "afterBand": "Usta" },
        "loser": { "before": 1000, "after": 984, "delta": -16, "beforeBand": "Usta", "afterBand": "Çırak" }
      }
    }
  ]
}
```

Ratings, aggregates, history, and processed IDs are per-instance, in-memory state. They reset on restart and are not shared between peers or pods; Redis does not persist or synchronize them. Display names are non-authenticated, case-insensitive identities, so case variants share stats and names can be impersonated or collide. When both opponents resolve to the same identity, existing win/loss/point/history behavior is preserved and both MMR deltas are zero.

---

## Asena features → files

| Feature | Where |
|---|---|
| `AsenaServerFactory`, ergenecore adapter, `health` probes | `src/index.ts` |
| `@Config`: `serveOptions`/`wsOptions` (heartbeat), `onError`, `onNotFound`, `globalMiddlewares()` with route patterns, `transport()` (Redis or BunLocal) | `src/config/ServerConfig.ts` |
| `@Component` + checking `isValidationError` before `isHttpException` | `src/exceptions/ExceptionMapper.ts` |
| `@Controller` + `@Get`/`@Post` + OpenAPI summaries | `src/controllers/*Controller.ts` |
| **Route context contracts** (`Context.define`): validation, typed `context.input` and OpenAPI from one declaration | `src/contracts/*Contracts.ts` |
| `@StaticServe` (`/assets/*`) + `@Hidden` | `src/controllers/AssetsController.ts` |
| `@FrontendController` + `@Page`: an HTML import whose TypeScript Bun bundles | `src/controllers/PongFrontendController.ts`, `web/` |
| `@Service`, `@Inject`, `@Value` (parse + default) | `src/services/*` |
| Zero-sum Elo calculation and the idempotent stats/MMR writer | `MmrService.ts`, `StatsService.ts` |
| `@OnStart` / `@OnStop` lifecycle (UDP socket, game loops) | `PeerDiscoveryService.ts`, `GameService.ts` |
| Throwing `HttpException` from the service layer | `RoomService.ts`, `PeerDiscoveryService.ts` |
| **Ulak**: sending WebSocket messages without injecting the namespace (`ulak('/ws/game')`) | `GameService.ts`, `LobbyEventService.ts`, `LobbySocket.ts` |
| `@WebSocket` namespaces, middleware chain, room topics (`subscribe`), `this.to()` vs `ws.send()` | `src/namespaces/GameSocket.ts`, `LobbySocket.ts` |
| WebSocket middleware: rejecting an upgrade, `setWebSocketValue` | `src/middlewares/PlayerHandshakeMiddleware.ts` |
| `WebSocketOriginMiddleware` (subclassed) | `src/middlewares/GameOriginMiddleware.ts` |
| `CorsMiddleware`, `RateLimiterMiddleware` (subclassed, with `trustProxy` and `cost`) | `src/middlewares/GlobalCors…`, `ApiRateLimiter…` |
| A hand-written middleware (`setValue`, response headers) | `src/middlewares/RequestLoggerMiddleware.ts` |
| `emitter()` + `@EventService` + `@On` domain events | `src/events/*`; emitted by `RoomService`, `GameService`, `PeerDiscoveryService` |
| `@Schedule` (cron) | `src/schedules/RoomCleanupSchedule.ts` |
| Injecting the core logger (`ICoreServiceNames.SERVER_LOGGER`) | most services |
| `@asenajs/asena-openapi` + Scalar UI | `src/openapi/AppOpenApi.ts` |
| `@asenajs/asena-logger` | `src/logger.ts` |
| Tests: `mockComponent`, `createTestUlakStub`, `createTestApp` + a real WebSocket match | `test/` |
| `asena build` + `include` (the HTML page and shared code) | `asena-config.ts` |

Architecture rule: **Controller → Service**. Controllers stay thin: they read the request, hand it to a service and shape the response. Room rules live in `RoomService` and game rules in `GameService`. The leaderboard never talks to `GameService`; `GameEventService` listens to `game.match.ended` and calls only `StatsService.record()`, which applies stats and `MmrService` updates once per match ID.

Left out on purpose: Drizzle (database) plus Kafka and the microservice transports. They need external infrastructure, which would break the one-command `docker run`. Redis is optional and stays off unless `REDIS_URL` is set.

---

## Project layout

```
src/
  index.ts                  bootstrap
  config/ exceptions/       @Config + error mapping
  contracts/                route context contracts (Context.define)
  controllers/              REST + static files + frontend page
  services/                 Room, Game, Stats, MMR, Instance, PeerDiscovery
  namespaces/               /ws/game, /ws/lobby
  middlewares/  events/  schedules/  openapi/
  game/                     PongPhysics (pure, testable) + shared constants/protocol
web/                        index.html + app.ts + style.css  (OUTSIDE src/, see note)
public/                     static files served under /assets
test/                       bun test
```

> **Note:** Asena's IoC scanner imports **every** file under `src/`. Browser code (`document`, `window`)
> crashes when the server imports it, so `web/` lives outside `src/`. `web/app.ts` imports the shared
> `src/game/*` files, and Bun bundles the HTML page at runtime, so both folders are listed under
> `include` in `asena-config.ts`.

### WebSocket protocol (`src/game/protocol.ts`)

```
→ /ws/game?room=K7QXA&name=Alice
client → server:  input{dir} · ready · rematch · chat{text} · ping{ts}
server → client:  welcome · room · countdown · state(30 Hz) · scored · end · chat · pong · error
```

## Controls

`W`/`S` or `↑`/`↓`. On touch screens, ▲/▼ buttons appear.
