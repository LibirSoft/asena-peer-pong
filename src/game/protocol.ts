/**
 * WebSocket protocol shared by server and browser.
 * Every frame is a JSON object with a discriminating `t` field.
 */
export type Side = 'left' | 'right';
export type Role = Side | 'spectator';
export type RoomStatus = 'waiting' | 'countdown' | 'playing' | 'paused' | 'finished';

export interface PlayerView {
  name: string;
  ready: boolean;
  connected: boolean;
}

export interface RoomView {
  code: string;
  name: string;
  isPublic: boolean;
  targetScore: number;
  status: RoomStatus;
  players: { left: PlayerView | null; right: PlayerView | null };
  spectators: number;
  createdAt: number;
  pausesRemaining: Record<Side, number>;
  pause: { by: Side; remainingMs: number } | null;
}

export interface GameSnapshot {
  tick: number;
  ball: { x: number; y: number; vx: number; vy: number };
  paddles: { left: number; right: number }; // paddle top Y
  score: { left: number; right: number };
}

// ── client → server ────────────────────────────────────────────────
export type ClientMessage =
  | { t: 'input'; dir: -1 | 0 | 1 }
  | { t: 'ready' }
  | { t: 'rematch' }
  | { t: 'pause' }
  | { t: 'resume' }
  | { t: 'chat'; text: string }
  | { t: 'ping'; ts: number };

// ── server → client ────────────────────────────────────────────────
export type ServerMessage =
  | { t: 'welcome'; role: Role; socketId: string; room: RoomView; instance: string }
  | { t: 'room'; room: RoomView }
  | { t: 'countdown'; n: number }
  | { t: 'state'; s: GameSnapshot }
  | { t: 'scored'; side: Side; score: GameSnapshot['score'] }
  | { t: 'end'; winner: Side; winnerName: string; score: GameSnapshot['score']; reason: 'score' | 'forfeit' }
  | { t: 'chat'; from: string; text: string; at: number }
  | { t: 'pong'; ts: number }
  | { t: 'error'; message: string };

// ── lobby namespace (server → client only) ─────────────────────────
export interface PeerView {
  id: string;
  name: string;
  url: string;
  source: 'lan' | 'manual';
  openRooms: number;
  lastSeen: number;
}

export type LobbyMessage =
  | { t: 'snapshot'; rooms: RoomView[]; peers: PeerView[]; online: number }
  | { t: 'rooms'; rooms: RoomView[] }
  | { t: 'peers'; peers: PeerView[] }
  | { t: 'online'; online: number };
