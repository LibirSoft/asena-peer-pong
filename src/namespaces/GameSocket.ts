import { z } from 'zod';
import { WebSocket } from '@asenajs/asena/decorators';
import { Inject } from '@asenajs/asena/decorators/ioc';
import { emitter, type EventEmitter } from '@asenajs/asena/event';
import { AsenaWebSocketService, type Socket } from '@asenajs/asena/web-socket';
import type { ServerMessage } from '../game/protocol';
import { GameOriginMiddleware } from '../middlewares/GameOriginMiddleware';
import { PlayerHandshakeMiddleware, type PlayerSocketData } from '../middlewares/PlayerHandshakeMiddleware';
import { GameService, roomTopic } from '../services/GameService';
import { InstanceService } from '../services/InstanceService';
import { RoomService } from '../services/RoomService';

const clientMessageSchema = z.discriminatedUnion('t', [
  z.object({ t: z.literal('input'), dir: z.union([z.literal(-1), z.literal(0), z.literal(1)]) }),
  z.object({ t: z.literal('ready') }),
  z.object({ t: z.literal('rematch') }),
  z.object({ t: z.literal('pause') }),
  z.object({ t: z.literal('resume') }),
  z.object({ t: z.literal('chat'), text: z.string().trim().min(1).max(200) }),
  z.object({ t: z.literal('ping'), ts: z.number() }),
]);

/**
 * ws://host/ws/game?room=ABCDE&name=Ayşe
 *
 * Thin transport layer: parses frames and delegates to RoomService / GameService.
 * Every socket subscribes to the Bun pub/sub topic `room:<code>`; GameService
 * publishes the game state to that topic through Ulak.
 *
 * Shows: @WebSocket namespace with a middleware chain, rooms (subscribe), this.to(),
 *        ws.send() for private frames, injecting services into a namespace.
 */
@WebSocket({ path: '/ws/game', name: 'GameSocket', middlewares: [GameOriginMiddleware, PlayerHandshakeMiddleware] })
export class GameSocket extends AsenaWebSocketService<PlayerSocketData> {
  @Inject(RoomService)
  private rooms: RoomService;

  @Inject(GameService)
  private game: GameService;

  @Inject(InstanceService)
  private instance: InstanceService;

  @Inject(emitter())
  private events: EventEmitter;

  protected async onOpen(ws: Socket<PlayerSocketData>): Promise<void> {
    const { code, name } = ws.data.values;
    const room = this.rooms.find(code);
    if (!room) {
      this.reply(ws, { t: 'error', message: 'Room closed' });
      ws.close();
      return;
    }

    const role = this.rooms.join(code, ws.id, name);
    ws.subscribe(roomTopic(code));
    this.reply(ws, { t: 'welcome', role, socketId: ws.id, room: this.rooms.toView(room), instance: this.instance.name });
    await this.game.publishRoom(room);
    this.events.emit('lobby.online.changed', this.sockets.size);
  }

  protected async onMessage(ws: Socket<PlayerSocketData>, raw: string | Buffer): Promise<void> {
    let message: z.infer<typeof clientMessageSchema>;
    try {
      message = clientMessageSchema.parse(JSON.parse(raw.toString()));
    } catch {
      this.reply(ws, { t: 'error', message: 'Malformed message' });
      return;
    }

    const room = this.rooms.find(ws.data.values.code);
    if (!room) return;
    const role = this.rooms.roleOf(room, ws.id);

    switch (message.t) {
      case 'input':
        if (role === 'left' || role === 'right') this.game.setInput(room.code, role, message.dir);
        break;
      case 'ready':
      case 'rematch':
        await this.game.playerReady(room, ws.id);
        break;
      case 'pause':
        await this.game.pause(room, ws.id);
        break;
      case 'resume':
        await this.game.resume(room, ws.id);
        break;
      case 'chat':
        // this.to() includes the sender and serializes the object for us.
        this.to(roomTopic(room.code), {
          t: 'chat',
          from: this.rooms.nameOf(room, ws.id),
          text: message.text,
          at: Date.now(),
        } satisfies ServerMessage);
        break;
      case 'ping':
        this.reply(ws, { t: 'pong', ts: message.ts });
        break;
    }
  }

  protected async onClose(ws: Socket<PlayerSocketData>): Promise<void> {
    // Asena already unsubscribed the socket and removed it from this.sockets.
    const { code, name } = ws.data.values;
    const { role, room } = this.rooms.leave(code, ws.id);
    if (!room) {
      this.game.discard(code);
    } else {
      if (role === 'left' || role === 'right') await this.game.playerLeft(room, role, name);
      await this.game.publishRoom(room);
    }
    this.events.emit('lobby.online.changed', this.sockets.size);
  }

  /** ws.send is a raw passthrough → we serialize ourselves. */
  private reply(ws: Socket<PlayerSocketData>, message: ServerMessage): void {
    ws.send(JSON.stringify(message));
  }
}
