import { EventService } from '@asenajs/asena/decorators';
import { Inject } from '@asenajs/asena/decorators/ioc';
import { On } from '@asenajs/asena/event';
import { ulak, type Ulak } from '@asenajs/asena/messaging';
import type { LobbyMessage } from '../game/protocol';
import { PeerDiscoveryService } from '../services/PeerDiscoveryService';
import { RoomService } from '../services/RoomService';

/**
 * Turns domain events into live lobby updates for every browser sitting in the lobby.
 *
 * Shows: Ulak namespace broadcast from a non-WebSocket component.
 */
@EventService({ prefix: 'lobby', name: 'LobbyEventService' })
export class LobbyEventService {
  @Inject(ulak('/ws/lobby'))
  private lobby: Ulak.NameSpace<'/ws/lobby'>;

  @Inject(RoomService)
  private rooms: RoomService;

  @Inject(PeerDiscoveryService)
  private peers: PeerDiscoveryService;

  @On('rooms.changed')
  public async onRoomsChanged(): Promise<void> {
    await this.push({ t: 'rooms', rooms: this.rooms.listPublic() });
  }

  @On('peers.changed')
  public async onPeersChanged(): Promise<void> {
    await this.push({ t: 'peers', peers: this.peers.list() });
  }

  @On('online.changed')
  public async onOnlineChanged(_event: string, online: number): Promise<void> {
    await this.push({ t: 'online', online });
  }

  private async push(message: LobbyMessage): Promise<void> {
    if (this.lobby.getSocketCount() === 0) return;
    await this.lobby.broadcast(message);
  }
}
