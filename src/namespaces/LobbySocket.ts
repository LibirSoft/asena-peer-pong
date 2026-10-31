import { WebSocket } from '@asenajs/asena/decorators';
import { Inject } from '@asenajs/asena/decorators/ioc';
import { ulak, type Ulak } from '@asenajs/asena/messaging';
import { AsenaWebSocketService, type Socket } from '@asenajs/asena/web-socket';
import type { LobbyMessage } from '../game/protocol';
import { GameOriginMiddleware } from '../middlewares/GameOriginMiddleware';
import { PeerDiscoveryService } from '../services/PeerDiscoveryService';
import { RoomService } from '../services/RoomService';

/**
 * ws://host/ws/lobby — read-only live feed of rooms, LAN peers and online players.
 * Updates are pushed by LobbyEventService through Ulak; this class only sends the
 * initial snapshot.
 */
@WebSocket({ path: '/ws/lobby', name: 'LobbySocket', middlewares: [GameOriginMiddleware] })
export class LobbySocket extends AsenaWebSocketService<Record<string, never>> {
  @Inject(RoomService)
  private rooms: RoomService;

  @Inject(PeerDiscoveryService)
  private peers: PeerDiscoveryService;

  @Inject(ulak('/ws/game'))
  private game: Ulak.NameSpace<'/ws/game'>;

  protected async onOpen(ws: Socket): Promise<void> {
    const snapshot: LobbyMessage = {
      t: 'snapshot',
      rooms: this.rooms.listPublic(),
      peers: this.peers.list(),
      online: this.game.getSocketCount(),
    };
    ws.send(JSON.stringify(snapshot));
  }

  protected async onMessage(): Promise<void> {
    // The lobby feed is server → client only.
  }
}
