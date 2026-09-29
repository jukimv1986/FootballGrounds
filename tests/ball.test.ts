// Ball physics in isolation (src/game/onthepitch/ball.ts), with a minimal stand-in for Match.
import { beforeAll, describe, expect, it } from 'vitest';
import { installDiskFileSystem } from './helpers';
import { Vector3 } from '../src/blunted/base/math/vector3';
import { Node } from '../src/blunted/scene/node';
import { goalHalfWidth, pitchHalfW } from '../src/game/gamedefines';
import { Ball } from '../src/game/onthepitch/ball';
import type { Match } from '../src/game/onthepitch/match';

beforeAll(() => installDiskFileSystem());

/** only what Ball uses of Match */
function FakeMatch(ballInGoal = false): Match {
  const dynamicNode = new Node('dynamicNode');
  const team = { UpdatePossessionStats: () => {} };
  return {
    GetDynamicNode: () => dynamicNode,
    IsBallInGoal: () => ballInGoal,
    UpdateLatestMentalImageBallPredictions: () => {},
    GetTeam: () => team,
  } as unknown as Match;
}

function Step(ball: Ball, steps: number): void {
  for (let i = 0; i < steps; i++) ball.Process();
}

describe('Ball', () => {
  it('loads its geometry into the dynamic node', () => {
    const match = FakeMatch();
    const ball = new Ball(match);
    expect(ball.GetBallGeom()).toBeTruthy();
    expect(match.GetDynamicNode().GetNodes().length).toBe(1);
    ball.Exit();
    expect(match.GetDynamicNode().GetNodes().length).toBe(0);
  });

  it('stays at rest on the grass', () => {
    const ball = new Ball(FakeMatch());
    ball.SetPosition(new Vector3(3, 4, 0.11));
    Step(ball, 100);
    const pos = ball.Predict(0);
    expect(pos.coords[0]).toBeCloseTo(3, 5);
    expect(pos.coords[1]).toBeCloseTo(4, 5);
    expect(pos.coords[2]).toBeCloseTo(0.11, 5);
    expect(ball.GetMovement().GetLength()).toBeLessThan(0.001);
  });

  it('falls under gravity (10ms euler steps)', () => {
    const ball = new Ball(FakeMatch());
    ball.SetPosition(new Vector3(0, 0, 10));
    Step(ball, 10);
    // z_n = z0 + g * dt^2 * n(n+1)/2 (minus a little air drag)
    expect(ball.Predict(0).coords[2]).toBeCloseTo(10 - 9.81 * 0.0001 * 55, 2);
    expect(ball.GetMovement().coords[2]).toBeCloseTo(-9.81 * 0.1, 2);
  });

  it('bounces lower each time and never sinks into the pitch', () => {
    const ball = new Ball(FakeMatch());
    ball.SetPosition(new Vector3(0, 0, 3));
    let minZ = Infinity;
    const peaks: number[] = [];
    let previousVz = 0;
    for (let i = 0; i < 600; i++) {
      ball.Process();
      const z = ball.Predict(0).coords[2];
      const vz = ball.GetMovement().coords[2];
      minZ = Math.min(minZ, z);
      if (previousVz > 0 && vz <= 0) peaks.push(z);
      previousVz = vz;
    }
    expect(minZ).toBeGreaterThanOrEqual(0.11 - 1e-9);
    expect(peaks.length).toBeGreaterThanOrEqual(2);
    expect(peaks[0]).toBeLessThan(3);
    expect(peaks[1]).toBeLessThan(peaks[0]);
  });

  it('rolls out due to grass friction', () => {
    const ball = new Ball(FakeMatch());
    ball.SetPosition(new Vector3(0, 0, 0.11));
    ball.SetMomentum(new Vector3(10, 0, 0));
    let previousSpeed = ball.GetMovement().GetLength();
    let previousX = 0;
    for (let i = 0; i < 100; i++) {
      ball.Process();
      const speed = ball.GetMovement().GetLength();
      expect(speed).toBeLessThanOrEqual(previousSpeed + 1e-6);
      expect(ball.Predict(0).coords[0]).toBeGreaterThan(previousX);
      previousSpeed = speed;
      previousX = ball.Predict(0).coords[0];
    }
    Step(ball, 1000);
    expect(ball.GetMovement().GetLength()).toBeLessThan(0.05);
    expect(ball.Predict(0).coords[0]).toBeGreaterThan(5);
    expect(Math.abs(ball.Predict(0).coords[1])).toBeLessThan(0.01);
  });

  it('predicts ahead consistently with processing', () => {
    const ball = new Ball(FakeMatch());
    ball.SetPosition(new Vector3(0, 0, 0.5));
    ball.SetMomentum(new Vector3(5, 2, 4));
    const predicted = ball.Predict(500);
    Step(ball, 50);
    expect(ball.Predict(0).GetDistance(predicted)).toBeLessThan(0.01);
    // out of range times clamp to the last prediction (negative ones too, like the C++ unsigned index)
    expect(ball.Predict(10000).Equals(ball.Predict(2990))).toBe(true);
    expect(ball.Predict(-10).Equals(ball.Predict(2990))).toBe(true);
  });

  it('bounces off the goal post', () => {
    const ball = new Ball(FakeMatch());
    ball.SetPosition(new Vector3(pitchHalfW - 1.0, goalHalfWidth, 1.0));
    ball.SetMomentum(new Vector3(15, 0, 0));
    Step(ball, 15);
    expect(ball.GetMovement().coords[0]).toBeLessThan(0);
    expect(ball.Predict(0).coords[0]).toBeLessThan(pitchHalfW);
  });

  it('swerves with side spin', () => {
    const straight = new Ball(FakeMatch());
    straight.SetPosition(new Vector3(0, 0, 1));
    straight.SetMomentum(new Vector3(25, 0, 3));
    const curled = new Ball(FakeMatch());
    curled.SetPosition(new Vector3(0, 0, 1));
    curled.SetMomentum(new Vector3(25, 0, 3));
    curled.SetRotation(new Vector3(0, 0, 20));
    expect(Math.abs(straight.Predict(500).coords[1])).toBeLessThan(1e-6);
    expect(Math.abs(curled.Predict(500).coords[1])).toBeGreaterThan(0.05);
  });
});
