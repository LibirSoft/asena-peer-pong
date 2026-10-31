import { Schedule } from '@asenajs/asena/decorators';
import { Inject, Value } from '@asenajs/asena/decorators/ioc';
import { ICoreServiceNames } from '@asenajs/asena/ioc/types';
import type { ServerLogger } from '@asenajs/asena/logger';
import type { AsenaSchedule } from '@asenajs/asena/schedule';
import { GameService } from '../services/GameService';
import { RoomService } from '../services/RoomService';

/**
 * Every minute: drop rooms that were created but never used, or were abandoned.
 *
 * Shows: @Schedule with a cron expression + AsenaSchedule.
 * (The 60 Hz game loop is a setInterval — cron is minute-granular.)
 */
@Schedule({ cron: '* * * * *', name: 'RoomCleanupSchedule' })
export class RoomCleanupSchedule implements AsenaSchedule {
  @Inject(RoomService)
  private rooms: RoomService;

  @Inject(GameService)
  private game: GameService;

  @Value('ROOM_IDLE_MINUTES', { parse: Number, default: 10 })
  private idleMinutes: number;

  @Inject(ICoreServiceNames.SERVER_LOGGER)
  private logger: ServerLogger;

  public async execute(): Promise<void> {
    const removed = this.rooms.sweepStale(this.idleMinutes * 60_000);
    for (const code of removed) this.game.discard(code);
    if (removed.length) this.logger.info(`[cleanup] removed ${removed.length} idle room(s): ${removed.join(', ')}`);
  }
}
