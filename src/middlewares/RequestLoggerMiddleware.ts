import { Middleware } from '@asenajs/asena/decorators';
import { Inject } from '@asenajs/asena/decorators/ioc';
import { ICoreServiceNames } from '@asenajs/asena/ioc/types';
import type { ServerLogger } from '@asenajs/asena/logger';
import { MiddlewareService, type Context } from '@asenajs/ergenecore';

/**
 * Logs method, path and duration of every API request.
 * Shows: a hand-written middleware with @Inject and per-request state (setValue).
 */
@Middleware()
export class RequestLoggerMiddleware extends MiddlewareService {
  @Inject(ICoreServiceNames.SERVER_LOGGER)
  private logger: ServerLogger;

  public async handle(context: Context, next: () => Promise<void>): Promise<void> {
    const started = performance.now();
    const requestId = crypto.randomUUID().slice(0, 8);
    context.setValue('requestId', requestId);
    context.setResponseHeader('X-Request-Id', requestId);
    await next();
    const url = new URL(context.req.url);
    this.logger.info(`${context.req.method} ${url.pathname} ${(performance.now() - started).toFixed(1)}ms [${requestId}]`);
  }
}
