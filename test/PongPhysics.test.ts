import { describe, expect, test } from 'bun:test';
import { BALL, FIELD, PADDLE } from '../src/game/constants';
import { PongPhysics } from '../src/game/PongPhysics';

const fixedRandom = () => 0.5; // straight serve, towards the right

describe('PongPhysics', () => {
  test('serves from the center', () => {
    const p = new PongPhysics(fixedRandom);
    expect(p.ball.x).toBe((FIELD.width - BALL.size) / 2);
    expect(p.ball.vx).toBeGreaterThan(0);
    expect(p.ball.vy).toBeCloseTo(0);
  });

  test('paddles move with input and stay inside the field', () => {
    const p = new PongPhysics(fixedRandom);
    p.inputs.left = -1;
    for (let i = 0; i < 600; i++) p.step(1 / 60);
    expect(p.paddles.left).toBe(0);
    p.inputs.left = 1;
    for (let i = 0; i < 600; i++) p.step(1 / 60);
    expect(p.paddles.left).toBe(FIELD.height - PADDLE.height);
  });

  test('ball bounces off a paddle it hits and speeds up', () => {
    const p = new PongPhysics(fixedRandom);
    p.paddles.right = p.ball.y + BALL.size / 2 - PADDLE.height / 2; // centered on the ball
    const speed = Math.hypot(p.ball.vx, p.ball.vy);
    let bounced = false;
    for (let i = 0; i < 120 && !bounced; i++) {
      p.step(1 / 60);
      bounced = p.ball.vx < 0;
    }
    expect(bounced).toBe(true);
    expect(Math.hypot(p.ball.vx, p.ball.vy)).toBeGreaterThan(speed);
  });

  test('missing the ball gives the point to the other side', () => {
    const p = new PongPhysics(fixedRandom);
    p.paddles.right = 0;
    p.ball.y = FIELD.height - BALL.size - 1; // far away from the right paddle
    let scorer = null;
    for (let i = 0; i < 300 && !scorer; i++) scorer = p.step(1 / 60);
    expect(scorer).toBe('left');
    expect(p.score).toEqual({ left: 1, right: 0 });
  });

  test('ball reflects from top and bottom walls', () => {
    const p = new PongPhysics(fixedRandom);
    p.ball = { x: 400, y: 2, vx: 0, vy: -300 };
    p.step(1 / 60);
    expect(p.ball.vy).toBeGreaterThan(0);
    expect(p.ball.y).toBeGreaterThanOrEqual(0);
  });
});
