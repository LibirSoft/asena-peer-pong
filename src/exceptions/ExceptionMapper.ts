import { Component } from '@asenajs/asena/decorators';
import { Inject, Scope } from '@asenajs/asena/decorators/ioc';
import { isHttpException, isValidationError } from '@asenajs/asena/adapter';
import { ICoreServiceNames } from '@asenajs/asena/ioc/types';
import type { ServerLogger } from '@asenajs/asena/logger';
import type { Context } from '@asenajs/ergenecore';

/**
 * One place that turns any error into an HTTP response.
 * Shows: @Component (plain injectable), isValidationError BEFORE isHttpException.
 */
@Component({ name: 'ExceptionMapper', scope: Scope.SINGLETON })
export class ExceptionMapper {
  @Inject(ICoreServiceNames.SERVER_LOGGER)
  private logger: ServerLogger;

  public map(error: Error, context: Context): Response {
    if (isValidationError(error)) {
      const issues = error.issues.map((i) => ({ field: i.path.join('.'), message: i.message }));
      return context.send({ error: 'VALIDATION_FAILED', target: error.target, issues }, 400);
    }
    if (isHttpException(error)) {
      return error.getResponse?.() ?? context.send({ error: error.message }, error.status);
    }
    this.logger.error(`Unhandled error on ${context.req.method} ${context.req.url}`, error);
    return context.send({ error: 'INTERNAL_SERVER_ERROR' }, 500);
  }
}
