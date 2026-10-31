import path from 'node:path';
import { Controller, StaticServe } from '@asenajs/asena/decorators';
import { Get } from '@asenajs/asena/decorators/http';
import { StaticServeService } from '@asenajs/ergenecore';
import { Hidden } from '@asenajs/asena-openapi';

/** Serves ./public under /assets (favicon, sounds…). Shows: @StaticServe. */
@StaticServe({ root: path.join(process.cwd(), 'public') })
export class PublicAssets extends StaticServeService {
  public extra = { cacheControl: 'public, max-age=3600' };

  public rewriteRequestPath(reqPath: string): string {
    return reqPath.replace(/^\/assets\/?/, '').replaceAll('..', '');
  }
}

@Hidden()
@Controller({ path: '/assets' })
export class AssetsController {
  @Get({ path: '/*', staticServe: PublicAssets })
  public assets() {}
}
