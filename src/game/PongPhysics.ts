import { BALL, FIELD, PADDLE } from './constants';
import type { GameSnapshot, Side } from './protocol';

/**
 * Pure, deterministic Pong simulation. No timers, no I/O, no framework —
 * which makes it trivially unit-testable. GameService drives it.
 */
export class PongPhysics {
  public tick = 0;
  public ball = { x: 0, y: 0, vx: 0, vy: 0 };
  public paddles = { left: 0, right: 0 };
  public score = { left: 0, right: 0 };
  public inputs: Record<Side, -1 | 0 | 1> = { left: 0, right: 0 };

  constructor(private readonly random: () => number = Math.random) {
    this.paddles.left = this.paddles.right = (FIELD.height - PADDLE.height) / 2;
    this.resetBall(this.random() < 0.5 ? 'left' : 'right');
  }

  /** Puts the ball in the middle, moving towards `towards`. */
  public resetBall(towards: Side): void {
    const angle = (this.random() - 0.5) * (Math.PI / 3); // ±30°
    const dir = towards === 'left' ? -1 : 1;
    this.ball = {
      x: (FIELD.width - BALL.size) / 2,
      y: (FIELD.height - BALL.size) / 2,
      vx: Math.cos(angle) * BALL.startSpeed * dir,
      vy: Math.sin(angle) * BALL.startSpeed,
    };
  }

  /**
   * Advances the world by `dt` seconds.
   * @returns the side that scored during this step, if any.
   */
  public step(dt: number): Side | null {
    this.tick++;

    for (const side of ['left', 'right'] as const) {
      const next = this.paddles[side] + this.inputs[side] * PADDLE.speed * dt;
      this.paddles[side] = clamp(next, 0, FIELD.height - PADDLE.height);
    }

    const b = this.ball;
    b.x += b.vx * dt;
    b.y += b.vy * dt;

    // top / bottom walls
    if (b.y <= 0) {
      b.y = -b.y;
      b.vy = Math.abs(b.vy);
    } else if (b.y + BALL.size >= FIELD.height) {
      b.y = 2 * (FIELD.height - BALL.size) - b.y;
      b.vy = -Math.abs(b.vy);
    }

    // paddles
    const leftFace = PADDLE.margin + PADDLE.width;
    const rightFace = FIELD.width - PADDLE.margin - PADDLE.width;

    if (b.vx < 0 && b.x <= leftFace && b.x >= PADDLE.margin - BALL.size && this.overlaps('left')) {
      b.x = leftFace;
      this.bounce('left');
    } else if (b.vx > 0 && b.x + BALL.size >= rightFace && b.x <= rightFace + PADDLE.width && this.overlaps('right')) {
      b.x = rightFace - BALL.size;
      this.bounce('right');
    }

    // goals
    if (b.x + BALL.size < 0) {
      this.score.right++;
      this.resetBall('right');
      return 'right';
    }
    if (b.x > FIELD.width) {
      this.score.left++;
      this.resetBall('left');
      return 'left';
    }
    return null;
  }

  public snapshot(): GameSnapshot {
    return {
      tick: this.tick,
      ball: { ...this.ball },
      paddles: { ...this.paddles },
      score: { ...this.score },
    };
  }

  private overlaps(side: Side): boolean {
    const top = this.paddles[side];
    return this.ball.y + BALL.size >= top && this.ball.y <= top + PADDLE.height;
  }

  /** Reflects the ball; the hit position on the paddle decides the angle. */
  private bounce(side: Side): void {
    const b = this.ball;
    const paddleCenter = this.paddles[side] + PADDLE.height / 2;
    const ballCenter = b.y + BALL.size / 2;
    const offset = clamp((ballCenter - paddleCenter) / (PADDLE.height / 2), -1, 1);
    const angle = offset * BALL.maxBounceAngle;
    const speed = Math.min(Math.hypot(b.vx, b.vy) * BALL.speedUp, BALL.maxSpeed);
    const dir = side === 'left' ? 1 : -1;
    b.vx = Math.cos(angle) * speed * dir;
    b.vy = Math.sin(angle) * speed;
  }
}

function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}
