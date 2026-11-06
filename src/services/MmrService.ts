import { Service } from '@asenajs/asena/decorators';
import { Value } from '@asenajs/asena/decorators/ioc';

export type MmrBand = 'Çırak' | 'Usta' | 'Efsane';

export interface MmrChange {
  before: number;
  after: number;
  delta: number;
  beforeBand: MmrBand;
  afterBand: MmrBand;
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

  public bandFor(rating: number): MmrBand {
    if (rating <= 999) return 'Çırak';
    if (rating <= 1499) return 'Usta';
    return 'Efsane';
  }

  public update(winnerRating: number, loserRating: number): MmrUpdate {
    const expectedWinnerScore = 1 / (1 + 10 ** ((loserRating - winnerRating) / 400));
    const delta = Math.round(this.kFactor * (1 - expectedWinnerScore));
    const loserDelta = delta === 0 ? 0 : -delta;
    const winnerAfter = winnerRating + delta;
    const loserAfter = loserRating + loserDelta;

    return {
      winner: {
        before: winnerRating,
        after: winnerAfter,
        delta,
        beforeBand: this.bandFor(winnerRating),
        afterBand: this.bandFor(winnerAfter),
      },
      loser: {
        before: loserRating,
        after: loserAfter,
        delta: loserDelta,
        beforeBand: this.bandFor(loserRating),
        afterBand: this.bandFor(loserAfter),
      },
    };
  }
}
