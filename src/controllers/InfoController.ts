import { Controller } from '@asenajs/asena/decorators';
import { Get } from '@asenajs/asena/decorators/http';
import { Inject } from '@asenajs/asena/decorators/ioc';
import type { Context } from '@asenajs/ergenecore';
import { GameService } from '../services/GameService';
import { InstanceService } from '../services/InstanceService';
import { RoomService } from '../services/RoomService';
import { StatsService } from '../services/StatsService';

@Controller({ path: '/api', description: 'Instance identity and live counters' })
export class InfoController {
  @Inject(InstanceService)
  private instance: InstanceService;

  @Inject(RoomService)
  private rooms: RoomService;

  @Inject(GameService)
  private game: GameService;

  @Inject(StatsService)
  private stats: StatsService;

  /** Peers call this endpoint to verify an address really is an asena-peer-pong instance. */
  @Get({ path: '/info', summary: 'Who is this instance?' })
  public async info(context: Context) {
    return context.send(this.instance.info());
  }

  @Get({ path: '/stats', summary: 'Live counters' })
  public async counters(context: Context) {
    return context.send({
      rooms: this.rooms.totalRooms(),
      activeMatches: this.game.activeMatchCount(),
      ...this.stats.totals(),
    });
  }
}
