import { FrontendController } from '@asenajs/asena/decorators';
import { Page } from '@asenajs/asena/decorators/http';

/**
 * The game UI. Bun bundles index.html together with its TypeScript and CSS
 * (web/app.ts imports src/game/constants.ts — shared with the server).
 * The web/ folder sits outside src/ on purpose: the IoC scanner imports every file in src/.
 * Shows: @FrontendController + @Page HTML imports.
 */
@FrontendController({ path: '/', name: 'PongFrontendController' })
export class PongFrontendController {
  @Page('/')
  public home() {
    return import('../../web/index.html');
  }
}
