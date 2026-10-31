import { OpenApi, OpenApiPostProcessor } from '@asenajs/asena-openapi';

/**
 * GET /api/docs     → OpenAPI 3.1 JSON (generated from the route contracts)
 * GET /api/docs/ui  → Scalar API reference
 */
@OpenApi({
  info: {
    title: 'Asena Peer Pong API',
    version: '1.0.0',
    description: 'REST API of an asena-peer-pong instance. Real-time play happens on ws /ws/game and /ws/lobby.',
  },
  path: '/api/docs',
  ui: 'scalar',
})
export class AppOpenApi extends OpenApiPostProcessor {}
