import { z } from 'zod';
import { Context } from '@asenajs/ergenecore'; // VALUE import — Context.define() needs it at runtime

export class ProbePeerContext extends Context.define({
  body: z.object({
    address: z
      .string()
      .trim()
      .min(3)
      .max(200)
      .describe('Peer address: "192.168.1.20:3000", "my-pc.tailnet.ts.net:3000" or a full URL'),
  }),
}) {}
