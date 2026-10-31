import { Middleware } from '@asenajs/asena/decorators';
import { RateLimiterMiddleware } from '@asenajs/ergenecore';

/**
 * Token bucket per client for /api/*. Set TRUST_PROXY=true behind ONE reverse proxy
 * (nginx, Traefik, Fly.io…) so the real client IP from X-Forwarded-For is used.
 *
 * Note: injected fields are not available inside constructors, so built-in middleware
 * options come from process.env here.
 */
@Middleware()
export class ApiRateLimiterMiddleware extends RateLimiterMiddleware {
  constructor() {
    super({
      capacity: 60,
      refillRate: 1, // 1 token / second
      message: 'Too many requests, slow down',
      trustProxy: process.env.TRUST_PROXY === 'true',
      cost: (ctx) => (ctx.req.method === 'POST' ? 3 : 1),
    });
  }
}
