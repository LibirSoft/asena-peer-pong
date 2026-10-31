import { AsenaServerFactory } from '@asenajs/asena';
import { createErgenecoreAdapter } from '@asenajs/ergenecore';
import { logger } from './logger';

const port = Number(process.env.PORT ?? 3000);
const healthPort = Number(process.env.HEALTH_PORT ?? 3001);

// ergenecore takes the hostname from the factory; 0.0.0.0 so LAN peers and Docker can reach us.
const adapter = createErgenecoreAdapter({ hostname: process.env.HOST ?? '0.0.0.0', logger });

const server = await AsenaServerFactory.create({
  adapter,
  logger,
  port,
  health: { port: healthPort }, // /healthz/live + /healthz/ready
});

await server.start();

logger.info(`🏓 Asena Peer Pong is up → http://localhost:${port}  (API docs: /api/docs/ui)`);
