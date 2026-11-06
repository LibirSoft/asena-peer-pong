import { Service } from '@asenajs/asena/decorators';
import { Value } from '@asenajs/asena/decorators/ioc';

export interface MmrChange {
  before: number;
  after: number;
  delta: number;
}

export interface MmrUpdate {
  winner: MmrChange;
  loser: MmrChange;
}

@Service('MmrService')
export class MmrService {
  @Value('MMR_INITIAL_RATING', { parse: Number, default: 1000 })
  private initialRating: number;

  @Value('MMR_K_FACTOR', { parse: Number, default: 32 })
  private kFactor: number;

  public getInitialRating(): number {
    return this.initialRating;
  }

  public update(winnerRating: number, loserRating: number): MmrUpdate {
    const expectedWinnerScore = 1 / (1 + 10 ** ((loserRating - winnerRating) / 400));
    const delta = Math.round(this.kFactor * (1 - expectedWinnerScore));
    const loserDelta = delta === 0 ? 0 : -delta;

    return {
      winner: { before: winnerRating, after: winnerRating + delta, delta },
      loser: { before: loserRating, after: loserRating + loserDelta, delta: loserDelta },
    };
  }
}
