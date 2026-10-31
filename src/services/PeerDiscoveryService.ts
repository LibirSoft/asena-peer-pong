import type { udp } from 'bun';
import { z } from 'zod';
import { Service } from '@asenajs/asena/decorators';
import { Inject, OnStart, OnStop, Value } from '@asenajs/asena/decorators/ioc';
import { HttpException } from '@asenajs/asena/adapter';
import { emitter, type EventEmitter } from '@asenajs/asena/event';
import { ICoreServiceNames } from '@asenajs/asena/ioc/types';
import type { ServerLogger } from '@asenajs/asena/logger';
import type { PeerView, RoomView } from '../game/protocol';
import { InstanceService } from './InstanceService';
import { RoomService } from './RoomService';

const APP_ID = 'asena-peer-pong';

/** Wire format of a UDP beacon. Validated — the LAN is untrusted input. */
const beaconSchema = z.object({
  app: z.literal(APP_ID),
  kind: z.enum(['beacon', 'reply']),
  id: z.string().min(1).max(64),
  name: z.string().max(64),
  httpPort: z.number().int().min(1).max(65535),
  openRooms: z.number().int().min(0),
});
type Beacon = z.infer<typeof beaconSchema>;

/** Shape we accept from a remote instance's GET /api/info. */
const remoteInfoSchema = z.object({
  app: z.literal(APP_ID),
  id: z.string(),
  name: z.string(),
  version: z.string(),
});

interface Peer extends PeerView {
  expiresAt: number;
}

/**
 * Lets two people who each run the app on their own computer find each other.
 *
 *  1. LAN discovery — every instance broadcasts a small UDP beacon. The instance
 *     that owns the fixed discovery port also answers each beacon with a unicast
 *     reply, so a second instance on the same machine (which had to fall back to
 *     an ephemeral port) still learns about it.
 *  2. Manual peers — `probe("192.168.1.20:3000")` asks the remote /api/info. This is
 *     the path for the internet (port-forward, Tailscale, ZeroTier…) and for Docker.
 *
 * The game itself is always hosted by ONE instance; the other player's browser
 * connects straight to it. No relay, no central server required.
 *
 * Shows: @OnStart / @OnStop lifecycle, @Value with parse, events, HttpException.
 */
@Service('PeerDiscoveryService')
export class PeerDiscoveryService {
  @Value('DISCOVERY_ENABLED', { parse: (v) => v !== 'false' && v !== '0', default: true })
  private enabled: boolean;

  @Value('DISCOVERY_PORT', { parse: Number, default: 41234 })
  private discoveryPort: number;

  @Value('DISCOVERY_INTERVAL_MS', { parse: Number, default: 2000 })
  private intervalMs: number;

  @Inject(InstanceService)
  private instance: InstanceService;

  @Inject(RoomService)
  private rooms: RoomService;

  @Inject(emitter())
  private events: EventEmitter;

  @Inject(ICoreServiceNames.SERVER_LOGGER)
  private logger: ServerLogger;

  private socket?: udp.Socket<'buffer'>;
  private timer?: ReturnType<typeof setInterval>;
  private readonly peers = new Map<string, Peer>();
  private ownsDiscoveryPort = false;

  @OnStart()
  public async start(): Promise<void> {
    if (!this.enabled) {
      this.logger.info('[discovery] LAN discovery disabled (DISCOVERY_ENABLED=false)');
      return;
    }

    const handler = {
      data: (_s: unknown, buf: Buffer, port: number, address: string) => this.onDatagram(buf, port, address),
    };

    try {
      this.socket = await Bun.udpSocket({ port: this.discoveryPort, socket: handler });
      this.ownsDiscoveryPort = true;
    } catch {
      // Another instance on this machine already listens; we can still be discovered
      // and we receive its unicast replies on our ephemeral port.
      this.socket = await Bun.udpSocket({ port: 0, socket: handler });
      this.logger.info(`[discovery] port ${this.discoveryPort} busy, using ephemeral port ${this.socket.port}`);
    }
    this.socket.setBroadcast(true);
    this.socket.unref();

    this.timer = setInterval(() => this.tick(), this.intervalMs);
    this.timer.unref();
    this.tick();
    this.logger.info(`[discovery] LAN discovery on udp/${this.socket.port}`);
  }

  @OnStop()
  public stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.socket?.close();
    this.socket = undefined;
  }

  public list(): PeerView[] {
    return [...this.peers.values()]
      .sort((a, b) => a.name.localeCompare(b.name))
      .map(({ expiresAt: _, ...view }) => view);
  }

  /**
   * Adds a peer by address ("host:port" or a full URL) after checking it really is
   * an asena-peer-pong instance. Returns the peer plus its public rooms.
   */
  public async probe(address: string): Promise<{ peer: PeerView; rooms: RoomView[] }> {
    const url = normalizePeerUrl(address);
    let info: z.infer<typeof remoteInfoSchema>;
    let rooms: RoomView[] = [];
    try {
      const signal = AbortSignal.timeout(3000);
      const res = await fetch(`${url}/api/info`, { signal });
      info = remoteInfoSchema.parse(await res.json());
      const roomsRes = await fetch(`${url}/api/rooms`, { signal });
      if (roomsRes.ok) rooms = ((await roomsRes.json()) as { rooms: RoomView[] }).rooms ?? [];
    } catch {
      throw new HttpException(502, { error: 'PEER_UNREACHABLE', message: `No asena-peer-pong instance answered at ${url}` });
    }
    if (info.id === this.instance.id) {
      throw new HttpException(400, { error: 'PEER_IS_SELF', message: 'That address points to this instance' });
    }

    const peer: Peer = {
      id: info.id,
      name: info.name,
      url,
      source: 'manual',
      openRooms: rooms.filter((r) => !r.players.left || !r.players.right).length,
      lastSeen: Date.now(),
      expiresAt: Date.now() + 10 * 60_000,
    };
    this.peers.set(peer.id, peer);
    this.changed();
    const { expiresAt: _, ...view } = peer;
    return { peer: view, rooms };
  }

  /** Removes peers that stopped announcing themselves. */
  public prune(now = Date.now()): number {
    let removed = 0;
    for (const [id, peer] of this.peers) {
      if (peer.expiresAt < now) {
        this.peers.delete(id);
        removed++;
      }
    }
    if (removed) this.changed();
    return removed;
  }

  private tick(): void {
    this.prune();
    const beacon = this.makeBeacon('beacon');
    const targets = new Set([...this.instance.broadcastAddresses(), '127.0.0.1']);
    for (const host of targets) this.sendTo(beacon, this.discoveryPort, host);
  }

  private onDatagram(buf: Buffer, port: number, address: string): void {
    let beacon: Beacon;
    try {
      beacon = beaconSchema.parse(JSON.parse(buf.toString('utf8')));
    } catch {
      return; // not ours / garbage
    }
    if (beacon.id === this.instance.id) return;

    const host = address.replace(/^::ffff:/, '');
    const url = `http://${host.includes(':') ? `[${host}]` : host}:${beacon.httpPort}`;
    const existing = this.peers.get(beacon.id);
    // Prefer a LAN address over loopback when the same peer reaches us both ways.
    const keepUrl = existing && host.startsWith('127.') && !existing.url.includes('127.0.0.1');

    this.peers.set(beacon.id, {
      id: beacon.id,
      name: beacon.name,
      url: keepUrl ? existing!.url : url,
      source: 'lan',
      openRooms: beacon.openRooms,
      lastSeen: Date.now(),
      expiresAt: Date.now() + this.intervalMs * 4,
    });
    if (!existing || existing.openRooms !== beacon.openRooms || existing.name !== beacon.name) this.changed();

    // The listener answers beacons coming from ephemeral ports (same-machine instances).
    if (beacon.kind === 'beacon' && this.ownsDiscoveryPort && port !== this.discoveryPort) {
      this.sendTo(this.makeBeacon('reply'), port, host);
    }
  }

  private makeBeacon(kind: Beacon['kind']): string {
    const beacon: Beacon = {
      app: APP_ID,
      kind,
      id: this.instance.id,
      name: this.instance.name,
      httpPort: this.instance.port,
      openRooms: this.rooms.openRoomCount(),
    };
    return JSON.stringify(beacon);
  }

  private sendTo(payload: string, port: number, host: string): void {
    try {
      this.socket?.send(payload, port, host);
    } catch {
      // Unreachable broadcast address (e.g. interface went down) — ignore.
    }
  }

  private changed(): void {
    this.events.emit('lobby.peers.changed');
  }
}

export function normalizePeerUrl(address: string): string {
  const trimmed = address.trim().replace(/\/+$/, '');
  const withScheme = /^https?:\/\//i.test(trimmed) ? trimmed : `http://${trimmed}`;
  const url = new URL(withScheme);
  if (!url.port && url.protocol === 'http:' && !/^https?:\/\/[^/]+:\d+/.test(withScheme)) url.port = '3000';
  return url.origin;
}
