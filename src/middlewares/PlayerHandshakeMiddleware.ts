import { z } from 'zod';
import { Middleware } from '@asenajs/asena/decorators';
import { Inject } from '@asenajs/asena/decorators/ioc';
import { MiddlewareService, type Context } from '@asenajs/ergenecore';
import { RoomService } from '../services/RoomService';

export interface PlayerSocketData {
  code: string;
  name: string;
}

const handshakeSchema = z.object({
  room: z.string().trim().toUpperCase().regex(/^[A-Z0-9]{4,8}$/, 'invalid room code'),
  name: z.string().trim().min(1).max(20).default('Oyuncu'),
});

/**
 * Runs BEFORE the WebSocket upgrade: validates ?room=&name=, rejects unknown rooms
 * and stores the result on the socket (ws.data.values).
 *
 * Shows: WebSocket middleware, rejecting by returning a Response, setWebSocketValue.
 */
@Middleware()
export class PlayerHandshakeMiddleware extends MiddlewareService {
  @Inject(RoomService)
  private rooms: RoomService;

  public async handle(context: Context, next: () => Promise<void>): Promise<Response | void> {
    const params = Object.fromEntries(new URL(context.req.url).searchParams);
    const parsed = handshakeSchema.safeParse(params);
    if (!parsed.success) {
      return context.send({ error: 'BAD_HANDSHAKE', issues: parsed.error.issues.map((i) => i.message) }, 400);
    }
    if (!this.rooms.find(parsed.data.room)) {
      return context.send({ error: 'ROOM_NOT_FOUND' }, 404);
    }
    context.setWebSocketValue({ code: parsed.data.room, name: parsed.data.name } satisfies PlayerSocketData);
    await next();
  }
}
