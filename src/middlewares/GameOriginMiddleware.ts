import { Middleware } from '@asenajs/asena/decorators';
import { WebSocketOriginMiddleware } from '@asenajs/ergenecore';

/**
 * Origin policy for the WebSocket handshakes. CORS does NOT protect WebSockets —
 * this does. Peer play needs foreign origins (your local UI talks to a friend's
 * instance), so the default is "*"; a public deployment can lock it down with
 * ALLOWED_ORIGINS=https://pong.example.com,https://other.example.com
 */
@Middleware()
export class GameOriginMiddleware extends WebSocketOriginMiddleware {
  constructor() {
    const raw = (process.env.ALLOWED_ORIGINS ?? '*').trim();
    const list = raw.split(',').map((o) => o.trim().replace(/\/$/, '')).filter(Boolean);
    super({
      allowedOrigins: raw === '*' || raw === '' ? () => true : list,
      // CLI tools / bots have no Origin header; allow them only in open mode.
      allowMissingOrigin: raw === '*' || raw === '',
    });
  }
}
