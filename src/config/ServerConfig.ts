import { Config } from '@asenajs/asena/decorators';
import { Inject, Value } from '@asenajs/asena/decorators/ioc';
import type { AsenaServeOptions, NotFoundRequest } from '@asenajs/asena/adapter';
import { BunLocalTransport } from '@asenajs/asena/web-socket';
import { RedisTransport } from '@asenajs/asena-redis';
import { ConfigService, type Context } from '@asenajs/ergenecore';
import { ExceptionMapper } from '../exceptions/ExceptionMapper';
import { ApiRateLimiterMiddleware } from '../middlewares/ApiRateLimiterMiddleware';
import { GlobalCorsMiddleware } from '../middlewares/GlobalCorsMiddleware';
import { RequestLoggerMiddleware } from '../middlewares/RequestLoggerMiddleware';

/**
 * The single @Config of the app.
 * Shows: serveOptions/wsOptions, onError, onNotFound, globalMiddlewares (method!)
 *        with route patterns, and an optional Redis WebSocket transport.
 */
@Config('ServerConfig')
export class ServerConfig extends ConfigService {
  @Inject(ExceptionMapper)
  private mapper: ExceptionMapper;

  @Value('REDIS_URL', { default: '' })
  private redisUrl: string;

  public serveOptions(): AsenaServeOptions {
    return {
      serveOptions: { idleTimeout: 30 },
      wsOptions: {
        idleTimeout: 60,
        perMessageDeflate: false, // tiny, frequent frames: compression costs more than it saves
        sendPingStrategy: 'adapter',
        heartbeatInterval: 15_000,
      },
    };
  }

  public globalMiddlewares() {
    return [
      { middleware: RequestLoggerMiddleware, routes: { include: ['/api/*'] } },
      GlobalCorsMiddleware,
      { middleware: ApiRateLimiterMiddleware, routes: { include: ['/api/*'], exclude: ['/api/info'] } },
    ];
  }

  public onError(error: Error, context: Context): Response {
    return this.mapper.map(error, context);
  }

  public onNotFound(context: Context, request: NotFoundRequest): Response {
    return context.send({ error: 'NOT_FOUND', path: request.path, method: request.method }, 404);
  }

  /**
   * Lobby broadcasts across several pods. Matches themselves are simulated by the
   * pod that owns the room, so route `/ws/game?room=X` stickily when you scale out.
   */
  public transport() {
    return this.redisUrl ? new RedisTransport({ url: this.redisUrl }) : new BunLocalTransport();
  }
}
