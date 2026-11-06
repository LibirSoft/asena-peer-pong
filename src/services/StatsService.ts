import { Service } from '@asenajs/asena/decorators';
import { Inject } from '@asenajs/asena/decorators/ioc';
import type { MatchEndedEvent } from './GameService';
import { MmrService, type MmrBand, type MmrUpdate } from './MmrService';

export interface PlayerStats {
  name: string;
  wins: number;
  losses: number;
  pointsFor: number;
  pointsAgainst: number;
  mmr: number;
  band: MmrBand;
}

export interface MatchRecord extends MatchEndedEvent {
  endedAt: number;
  mmr: MmrUpdate;
}

/**
 * In-memory leaderboard of this instance. Fed by GameEventService (@On('match.ended')),
 * never called by GameService directly — the two stay decoupled through events.
 */
@Service('StatsService')
export class StatsService {
  @Inject(MmrService)
  private mmr: MmrService;

  private readonly players = new Map<string, PlayerStats>();
  private readonly history: MatchRecord[] = [];
  private readonly processedMatchIds = new Set<string>();
  private static readonly HISTORY_LIMIT = 100;

  public record(match: MatchEndedEvent): void {
    if (this.processedMatchIds.has(match.matchId)) return;

    const winner = this.entry(match.winner.name);
    const loser = this.entry(match.loser.name);
    const rating: MmrUpdate = winner === loser
      ? {
          winner: {
            before: winner.mmr,
            after: winner.mmr,
            delta: 0,
            beforeBand: this.mmr.bandFor(winner.mmr),
            afterBand: this.mmr.bandFor(winner.mmr),
          },
          loser: {
            before: loser.mmr,
            after: loser.mmr,
            delta: 0,
            beforeBand: this.mmr.bandFor(loser.mmr),
            afterBand: this.mmr.bandFor(loser.mmr),
          },
        }
      : this.mmr.update(winner.mmr, loser.mmr);

    this.history.unshift({ ...match, endedAt: Date.now(), mmr: rating });
    if (this.history.length > StatsService.HISTORY_LIMIT) this.history.pop();

    winner.wins++;
    loser.losses++;
    winner.pointsFor += match.score[match.winner.side];
    winner.pointsAgainst += match.score[match.loser.side];
    loser.pointsFor += match.score[match.loser.side];
    loser.pointsAgainst += match.score[match.winner.side];
    winner.mmr = rating.winner.after;
    loser.mmr = rating.loser.after;
    winner.band = rating.winner.afterBand;
    loser.band = rating.loser.afterBand;
    this.processedMatchIds.add(match.matchId);
  }

  public leaderboard(limit: number): PlayerStats[] {
    return [...this.players.values()]
      .sort((a, b) => b.mmr - a.mmr || b.wins - a.wins || a.losses - b.losses || b.pointsFor - a.pointsFor)
      .slice(0, limit);
  }

  public recentMatches(limit: number): MatchRecord[] {
    return this.history.slice(0, limit);
  }

  public totals() {
    return { matchesPlayed: this.history.length, playersSeen: this.players.size };
  }

  private entry(name: string): PlayerStats {
    const key = name.toLowerCase();
    let stats = this.players.get(key);
    if (!stats) {
      const initialRating = this.mmr.getInitialRating();
      stats = {
        name,
        wins: 0,
        losses: 0,
        pointsFor: 0,
        pointsAgainst: 0,
        mmr: initialRating,
        band: this.mmr.bandFor(initialRating),
      };
      this.players.set(key, stats);
    }
    return stats;
  }
}
