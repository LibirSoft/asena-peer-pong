import { EventService } from '@asenajs/asena/decorators';
import { Inject } from '@asenajs/asena/decorators/ioc';
import { On } from '@asenajs/asena/event';
import { ICoreServiceNames } from '@asenajs/asena/ioc/types';
import type { ServerLogger } from '@asenajs/asena/logger';
import type { MatchEndedEvent } from '../services/GameService';
import { StatsService } from '../services/StatsService';

/**
 * Reacts to game domain events emitted by GameService.
 * GameService never knows the leaderboard exists — that is the point of events.
 *
 * Shows: @EventService with a prefix, @On exact + wildcard patterns.
 */
@EventService({ prefix: 'game', name: 'GameEventService' })
export class GameEventService {
  @Inject(StatsService)
  private stats: StatsService;

  @Inject(ICoreServiceNames.SERVER_LOGGER)
  private logger: ServerLogger;

  @On('match.ended') // → game.match.ended
  public onMatchEnded(_event: string, match: MatchEndedEvent): void {
    this.stats.record(match);
    this.logger.info(
      `[game] ${match.code}: ${match.winner.name} beat ${match.loser.name} ` +
        `${match.score.left}-${match.score.right} (${match.reason})`,
    );
  }

  @On('match.started') // → game.match.started
  public onMatchStarted(_event: string, data: { code: string }): void {
    this.logger.info(`[game] match started in room ${data.code}`);
  }
}
