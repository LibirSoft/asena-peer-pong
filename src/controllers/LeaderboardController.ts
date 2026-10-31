import { Controller } from '@asenajs/asena/decorators';
import { Get } from '@asenajs/asena/decorators/http';
import { Inject } from '@asenajs/asena/decorators/ioc';
import { StatsService } from '../services/StatsService';
import { LimitContext } from '../contracts/LeaderboardContracts';

@Controller({ path: '/api/leaderboard', description: 'Results of matches played on this instance' })
export class LeaderboardController {
  @Inject(StatsService)
  private stats: StatsService;

  @Get({ path: '/', summary: 'Top players' })
  public async top(context: LimitContext) {
    return context.send({ players: this.stats.leaderboard(context.input.query.limit) });
  }

  @Get({ path: '/matches', summary: 'Recently finished matches' })
  public async matches(context: LimitContext) {
    return context.send({ matches: this.stats.recentMatches(context.input.query.limit) });
  }
}
