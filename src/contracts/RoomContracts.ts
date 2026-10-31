import { z } from 'zod';
import { Context } from '@asenajs/ergenecore'; // VALUE import — Context.define() needs it at runtime

/**
 * Route context contracts: request shape validation + typed `context.input`
 * + OpenAPI documentation, from one declaration.
 * Controllers must import these as values (never `import type`), otherwise the
 * route registers WITHOUT validation.
 */
export const roomCodeSchema = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z0-9]{4,8}$/)
  .describe('Room code, e.g. K7QXA');

export class CreateRoomContext extends Context.define({
  body: z.object({
    name: z.string().trim().max(40).optional().describe('Display name of the room'),
    isPublic: z.boolean().default(true).describe('Listed in the lobby when true'),
    targetScore: z.number().int().min(1).max(21).optional().describe('Points needed to win'),
  }),
}) {}

export class RoomCodeContext extends Context.define({
  params: z.object({ code: roomCodeSchema }),
}) {}
