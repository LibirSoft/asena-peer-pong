import { Middleware } from '@asenajs/asena/decorators';
import { CorsMiddleware } from '@asenajs/ergenecore';

/**
 * The REST API is public and cookie-less, so any origin may read it.
 * This is what lets your local UI list rooms on a *peer's* instance.
 *
 * Shows: adapter built-ins must be subclassed + @Middleware() before use.
 */
@Middleware()
export class GlobalCorsMiddleware extends CorsMiddleware {
  constructor() {
    super({
      origin: '*',
      methods: ['GET', 'POST', 'OPTIONS'],
      allowedHeaders: ['Content-Type'],
      maxAge: 86400,
    });
  }
}
