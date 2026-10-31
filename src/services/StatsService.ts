import { Service } from '@asenajs/asena/decorators';
import type { MatchEndedEvent } from './GameService';

export interface PlayerStats {
  name: string;
  wins: number;
  losses: number;
  pointsFor: number;
  pointsAgainst: number;
}

export interface MatchRecord extends MatchEndedEvent {
  endedAt: number;
}

/**
 * In-memory leaderboard of this instance. Fed by GameEventService (@On('match.ended')),
 * never called by GameService directly — the two stay decoupled through events.
 */
@Service('StatsService')
export class StatsService {
  private readonly players = new Map<string, PlayerStats>();
  private readonly history: MatchRecord[] = [];
  private static readonly HISTORY_LIMIT = 100;

  public record(match: MatchEndedEvent): void {
    this.history.unshift({ ...match, endedAt: Date.now() });
    if (this.history.length > StatsService.HISTORY_LIMIT) this.history.pop();

    const winner = this.entry(match.winner.name);
    const loser = this.entry(match.loser.name);
    winner.wins++;
    loser.losses++;
    winner.pointsFor += match.score[match.winner.side];
    winner.pointsAgainst += match.score[match.loser.side];
    loser.pointsFor += match.score[match.loser.side];
    loser.pointsAgainst += match.score[match.winner.side];
  }

  public leaderboard(limit: number): PlayerStats[] {
    return [...this.players.values()]
      .sort((a, b) => b.wins - a.wins || a.losses - b.losses || b.pointsFor - a.pointsFor)
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
      stats = { name, wins: 0, losses: 0, pointsFor: 0, pointsAgainst: 0 };
      this.players.set(key, stats);
    }
    return stats;
  }
}
