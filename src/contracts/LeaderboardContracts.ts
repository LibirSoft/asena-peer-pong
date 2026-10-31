import { z } from 'zod';
import { Context } from '@asenajs/ergenecore'; // VALUE import — Context.define() needs it at runtime

export class LimitContext extends Context.define({
  query: z.object({
    limit: z.coerce.number().int().min(1).max(100).default(20).describe('Maximum rows to return'),
  }),
}) {}
