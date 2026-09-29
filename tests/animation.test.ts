import { describe, expect, it, beforeAll, vi } from 'vitest';
import { installDiskFileSystem } from './helpers';
import { Vector3, Quaternion } from '../src/blunted/base/math/vector3';
import { ModulateIntoRange, cround, pi } from '../src/blunted/base/math/bluntmath';
import { GetVectorFromString, atof } from '../src/blunted/base/utils';
import { FileSystem } from '../src/blunted/managers/filesystem';
import { Scene3D } from '../src/blunted/scene/scene3d';
import { Camera } from '../src/blunted/scene/objects/camera';
import { ObjectLoader } from '../src/blunted/utils/objectloader';
import { e_FunctionType, e_PlayerRole, e_Side, e_Velocity, playerNum, walkVelocity } from '../src/game/gamedefines';
import { SetDB } from '../src/game/globals';
import { Database } from '../src/game/data/database';
import { TeamData } from '../src/game/data/teamdata';
import { PlayerData } from '../src/game/data/playerdata';
import { MatchData } from '../src/game/data/matchdata';
import {
  CalculateStat,
  GetDefaultProfile,
  GetProjectedCoord,
  GetWeightedPositions,
  InitDefaultProfiles,
  QuantizeDirection,
  TemporalSmoother,
  e_DevelopmentCurveType,
  e_PositionName,
} from '../src/game/footballutils';
import { Animation, MovementHistoryEntry, e_Foot } from '../src/game/utils/animation';
import { FootballAnimationExtension } from '../src/game/utils/animationextensions/footballanimationextension';
import {
  AnimCollection,
  CrudeSelectionQuery,
  EnumToFloatVelocity,
  FillNodeMap,
  FloatToEnumVelocity,
  RangeVelocity,
} from '../src/game/onthepitch/player/humanoid/animcollection';

let anims: AnimCollection;
let loadTime_ms = 0;

beforeAll(() => {
  installDiskFileSystem();
  const start = performance.now();
  anims = new AnimCollection(new Scene3D());
  anims.Load('media/animations');
  loadTime_ms = performance.now() - start;
  console.log(`AnimCollection.Load: ${anims.GetAnimations().length} animations in ${loadTime_ms.toFixed(0)} ms`);
}, 120000);

const animFiles = (): string[] => FileSystem.ListFiles('media/animations').filter((f) => f.endsWith('.anim') && !f.includes('templates'));

describe('Animation', () => {
  it('loads a file like the original', () => {
    const anim = new Animation();
    anim.AddExtension('football', new FootballAnimationExtension(anim));
    anim.Load('media/animations/movement/walk/000_accel.anim');
    expect(anim.GetAnimType()).toBe('movement');
    expect(anim.GetNodeAnimations().length).toBe(14);
    expect(anim.GetNodeAnimations()[0].nodeName).toBe('player');
    expect(anim.GetNodeAnimations()[1].nodeName).toBe('body');
    expect(anim.GetFrameCount()).toBe(25);
    expect(anim.GetEffectiveFrameCount()).toBe(24);
    // player keys: 0: (0, 0), 4: (0, -0.202351), ..., 20: (0, -1.163922), 24: (0, -1.447305)
    expect(anim.GetIncomingVelocity()).toBe(5.0);
    expect(anim.GetOutgoingVelocity()).toBe(7.0);
    expect(anim.GetIncomingMovement().coords[1]).toBeCloseTo((-0.202351 / 4) * 100, 4);
    expect(anim.GetOutgoingAngle()).toBeCloseTo(0, 2);

    const exact = anim.GetKeyFrame('player', 4);
    expect(exact.result).toBe(true);
    expect(exact.position.coords[1]).toBeCloseTo(-0.202351, 6);
    const between = anim.GetKeyFrame('player', 6);
    expect(between.result).toBe(false);
    expect(between.position.coords[1]).toBeCloseTo((-0.202351 - 0.405486) / 2, 6);
    expect(anim.GetKeyFrame('nonexisting', 6).result).toBe(false);

    // no ball touch in a movement anim
    expect((anim.GetExtension('football') as FootballAnimationExtension).GetFirstTouch().result).toBe(false);
  });

  it('mirrors and copies', () => {
    const anim = new Animation();
    anim.AddExtension('football', new FootballAnimationExtension(anim));
    anim.Load('media/animations/shot/walk/090_2step.anim');
    const ext = anim.GetExtension('football') as FootballAnimationExtension;
    const touch = ext.GetFirstTouch();
    expect(touch.result).toBe(true);
    expect(touch.frame).toBe(28);
    expect(ext.GetTouchCount()).toBe(1);
    expect(anim.GetVariable('steps')).toBe('2');
    expect(anim.GetVariable('doesnotexist')).toBe('');

    const copy = new Animation(anim);
    const leftKnee = anim.GetKeyFrame('left_knee', 5).orientation;
    const rightKnee = anim.GetKeyFrame('right_knee', 5).orientation;
    const ballDirection = anim.GetVariable('balldirection');
    copy.Mirror();
    expect(copy.GetName()).toBe(anim.GetName() + '_mirror');
    expect(copy.GetCurrentFoot()).not.toBe(anim.GetCurrentFoot());
    const mirroredLeftKnee = copy.GetKeyFrame('left_knee', 5).orientation;
    expect(mirroredLeftKnee.elements[0]).toBeCloseTo(rightKnee.elements[0], 6);
    expect(mirroredLeftKnee.elements[1]).toBeCloseTo(-rightKnee.elements[1], 6);
    // the original is untouched (deep copied keyframes)
    expect(anim.GetKeyFrame('left_knee', 5).orientation.elements[1]).toBeCloseTo(leftKnee.elements[1], 9);
    expect(anim.GetVariable('balldirection')).toBe(ballDirection);
    // extensions are shared (shallow copy, like the C++)
    expect(copy.GetExtension('football')).toBe(ext);
  });

  it('applies poses to a skeleton', () => {
    const anim = new Animation();
    anim.AddExtension('football', new FootballAnimationExtension(anim));
    anim.Load('media/animations/movement/walk/000_accel.anim');
    const node = new ObjectLoader().LoadObject('media/objects/players/player.object');
    node.SetName('player');
    const nodeMap = FillNodeMap(node, new Map());
    expect(nodeMap.size).toBeGreaterThanOrEqual(14);

    anim.Apply(nodeMap, 4, 0, false, 1.0, new Vector3(1, 2, 0), 0);
    const player = nodeMap.get('player')!;
    expect(player.GetPosition().coords[0]).toBeCloseTo(1, 6);
    expect(player.GetPosition().coords[1]).toBeCloseTo(2 - 0.202351, 5);

    // smoothed apply keeps a movement history
    const history: MovementHistoryEntry[] = [];
    for (let frame = 0; frame < 10; frame++) anim.Apply(nodeMap, frame, 0, true, 1.0, new Vector3(0), 0.5 * pi, new Map(), history, 10);
    expect(history.length).toBe(14);
    const body = nodeMap.get('body')!.GetRotation();
    expect(Number.isFinite(body.elements[3])).toBe(true);
  });
});

describe('AnimCollection', () => {
  it('loads all animations', () => {
    const all = anims.GetAnimations();
    const files = animFiles();
    const autogen = all.filter((a) => a.GetName().startsWith('autogen'));
    expect(files.length).toBe(283);
    expect(all.length - autogen.length).toBe(files.length * 2);
    expect(autogen.length % 2).toBe(0);
    expect(autogen.length).toBeGreaterThan(100);
    expect(loadTime_ms).toBeGreaterThan(0);

    // file anims come in (original, mirror) pairs, in manifest order, after the autogenerated ones
    const fileAnims = all.slice(autogen.length);
    for (let i = 0; i < files.length; i++) {
      expect(fileAnims[i * 2].GetName()).toBe(files[i]);
      expect(fileAnims[i * 2 + 1].GetName()).toBe(files[i] + '_mirror');
    }
  });

  it('prepares every animation', () => {
    const types = new Set(['movement', 'ballcontrol', 'trap', 'shortpass', 'longpass', 'highpass', 'shot', 'deflect', 'catch', 'interfere', 'trip', 'sliding', 'special']);
    for (const anim of anims.GetAnimations()) {
      expect(types.has(anim.GetAnimType())).toBe(true);
      expect(anim.GetNodeAnimations().length).toBe(14);
      expect(anim.GetFrameCount()).toBeGreaterThan(1);
      const quadrant = Number(anim.GetVariable('quadrant_id'));
      expect(quadrant).toBeGreaterThanOrEqual(0);
      expect(quadrant).toBeLessThan(34);
      expect(anims.GetQuadrant(quadrant).id).toBe(quadrant);
      const touchFrame = Number(anim.GetVariable('touchframe'));
      const touch = (anim.GetExtension('football') as FootballAnimationExtension).GetFirstTouch();
      expect(touchFrame).toBe(touch.result ? touch.frame : -1);
      if (touch.result) expect(anim.GetVariable('touch_bodypart')).not.toBe('');
      const difficulty = Number(anim.GetVariable('animdifficultyfactor'));
      expect(difficulty).toBeGreaterThanOrEqual(0);
      expect(difficulty).toBeLessThanOrEqual(1);
      // mirrored and idle-start anims always have these variables (set by Mirror / ConvertToStartFacingForwardIfIdle)
      if (anim.GetName().endsWith('_mirror') || anim.GetIncomingVelocity() < 1.8) {
        expect(anim.GetVariable('balldirection')).not.toBe('');
        expect(anim.GetVariable('incomingballdirection')).not.toBe('');
      }
      expect([0, 3.5, 5.0, 7.0]).toContain(anim.GetIncomingVelocity());
      expect([0, 3.5, 5.0, 7.0]).toContain(anim.GetOutgoingVelocity());
      expect(Number.isFinite(anim.GetOutgoingAngle())).toBe(true);
    }
    // anims that start idle are rotated to start facing forward
    const idle = anims.GetAnimations().filter((a) => a.GetIncomingVelocity() < 1.8);
    expect(idle.length).toBeGreaterThan(0);
    // (Euler Z of a tilted body is not exactly 0 after the rotation, e.g. 000_back_to_front_holdball: 0.06 rad)
    for (const anim of idle) expect(Math.abs(anim.GetIncomingBodyAngle())).toBeLessThan(0.1);
  });

  it('assigns quadrants', () => {
    expect(anims.GetQuadrantID(null, new Vector3(0), 0)).toBe(0);
    // sprinting straight ahead (-y)
    const q = anims.GetQuadrantID(null, new Vector3(0, -7.5, 0), 0);
    expect(anims.GetQuadrant(q).velocity).toBe(e_Velocity.e_Velocity_Sprint);
    expect(anims.GetQuadrant(q).angle).toBeCloseTo(0);
  });

  it('makes crude selections', () => {
    const query = new CrudeSelectionQuery();
    query.byFunctionType = true;
    query.functionType = e_FunctionType.e_FunctionType_Movement;
    query.byIncomingVelocity = true;
    query.incomingVelocity = e_Velocity.e_Velocity_Walk;
    query.byIncomingBodyDirection = true;
    query.incomingBodyDirection = new Vector3(0, -1, 0);
    const dataSet: number[] = [];
    anims.CrudeSelection(dataSet, query);
    expect(dataSet.length).toBeGreaterThan(10);
    for (const i of dataSet) {
      const anim = anims.GetAnim(i);
      expect(anim.GetAnimType()).toBe('movement');
      expect(FloatToEnumVelocity(anim.GetIncomingVelocity())).not.toBe(e_Velocity.e_Velocity_Idle);
    }

    const shots: number[] = [];
    const shotQuery = new CrudeSelectionQuery();
    shotQuery.byFunctionType = true;
    shotQuery.functionType = e_FunctionType.e_FunctionType_Shot;
    shotQuery.byOutgoingBallDirection = true;
    shotQuery.outgoingBallDirection = new Vector3(0, -1, 0);
    anims.CrudeSelection(shots, shotQuery);
    expect(shots.length).toBeGreaterThan(0);
    for (const i of shots) expect(anims.GetAnim(i).GetAnimType()).toBe('shot');

    // performance: the humanoid runs this many times per second
    const bench = (q: CrudeSelectionQuery, runs: number): number => {
      const start = performance.now();
      for (let r = 0; r < runs; r++) {
        const ds: number[] = [];
        anims.CrudeSelection(ds, q);
      }
      return (performance.now() - start) / runs;
    };
    bench(query, 200);
    bench(shotQuery, 200);
    console.log(`CrudeSelection over ${anims.GetAnimations().length} anims: movement ${bench(query, 1000).toFixed(4)} ms, shot ${bench(shotQuery, 1000).toFixed(4)} ms per query`);
  });
});

const RefFixAngle = (a: number) => ModulateIntoRange(-pi, pi, a + 0.5 * pi);
const typeName: Record<number, string> = {
  [e_FunctionType.e_FunctionType_Movement]: 'movement', [e_FunctionType.e_FunctionType_BallControl]: 'ballcontrol', [e_FunctionType.e_FunctionType_Trap]: 'trap',
  [e_FunctionType.e_FunctionType_ShortPass]: 'shortpass', [e_FunctionType.e_FunctionType_LongPass]: 'longpass', [e_FunctionType.e_FunctionType_HighPass]: 'highpass',
  [e_FunctionType.e_FunctionType_Shot]: 'shot', [e_FunctionType.e_FunctionType_Deflect]: 'deflect', [e_FunctionType.e_FunctionType_Catch]: 'catch',
  [e_FunctionType.e_FunctionType_Interfere]: 'interfere', [e_FunctionType.e_FunctionType_Trip]: 'trip', [e_FunctionType.e_FunctionType_Sliding]: 'sliding', [e_FunctionType.e_FunctionType_Special]: 'special',
};

// straight translation of the C++ AnimCollection::CrudeSelection, to check the optimized port against
function Reference(animations: Animation[], dataSet: number[], query: CrudeSelectionQuery): void {
  for (let i = 0; i < animations.length; i++) {
    const a = animations[i];
    const animType = a.GetAnimType();
    let selectAnim = true;
    if (selectAnim && query.byFunctionType) { const n = typeName[query.functionType]; if (n === undefined || animType !== n) selectAnim = false; }
    if (selectAnim && query.byIncomingVelocity) {
      const aiv = FloatToEnumVelocity(a.GetIncomingVelocity());
      if (!query.incomingVelocity_Strict) {
        selectAnim = true;
        if (query.incomingVelocity_NoDribbleToIdle) if (aiv === e_Velocity.e_Velocity_Idle && query.incomingVelocity === e_Velocity.e_Velocity_Dribble) selectAnim = false;
        if (aiv === e_Velocity.e_Velocity_Idle && query.incomingVelocity === e_Velocity.e_Velocity_Walk) selectAnim = false;
        if (aiv === e_Velocity.e_Velocity_Idle && query.incomingVelocity === e_Velocity.e_Velocity_Sprint) selectAnim = false;
        if (aiv === e_Velocity.e_Velocity_Dribble && query.incomingVelocity === e_Velocity.e_Velocity_Idle) selectAnim = false;
        if (aiv === e_Velocity.e_Velocity_Walk && query.incomingVelocity === e_Velocity.e_Velocity_Idle) selectAnim = false;
        if (aiv === e_Velocity.e_Velocity_Sprint && query.incomingVelocity === e_Velocity.e_Velocity_Idle) selectAnim = false;
        if (query.incomingVelocity_NoDribbleToSprint) if (aiv === e_Velocity.e_Velocity_Sprint && query.incomingVelocity === e_Velocity.e_Velocity_Dribble) selectAnim = false;
        if (query.incomingVelocity_ForceLinearity) {
          let ai = RangeVelocity(a.GetIncomingVelocity()); let ao = RangeVelocity(a.GetOutgoingVelocity()); let qv = EnumToFloatVelocity(query.incomingVelocity);
          if (FloatToEnumVelocity(ai) === e_Velocity.e_Velocity_Dribble) ai = walkVelocity;
          if (FloatToEnumVelocity(ao) === e_Velocity.e_Velocity_Dribble) ao = walkVelocity;
          if (FloatToEnumVelocity(qv) === e_Velocity.e_Velocity_Dribble) qv = walkVelocity;
          if (ai > Math.max(qv, ao)) selectAnim = false;
          if (ai < Math.min(qv, ao)) selectAnim = false;
        }
      } else if (aiv !== query.incomingVelocity) selectAnim = false;
    }
    if (selectAnim && query.byOutgoingVelocity) if (FloatToEnumVelocity(a.GetOutgoingVelocity()) !== query.outgoingVelocity) selectAnim = false;
    if (selectAnim && query.bySide) {
      const inc = a.GetIncomingBodyDirection();
      const out = a.GetOutgoingDirection().GetRotated2D(a.GetOutgoingBodyAngle());
      const turn = out.GetAngle2D(inc);
      const fenced = query.lookAtVecRel.GetRotated2D(pi);
      if (Math.abs(turn) > 0.06 * pi) {
        const side = turn > 0 ? e_Side.e_Side_Left : e_Side.e_Side_Right;
        const a1 = fenced.GetAngle2D(inc); const a2 = fenced.GetAngle2D(query.incomingBodyDirection); const a3 = out.GetAngle2D(fenced);
        const s1 = a1 > 0 ? e_Side.e_Side_Left : e_Side.e_Side_Right; const s2 = a2 > 0 ? e_Side.e_Side_Left : e_Side.e_Side_Right; const s3 = a3 > 0 ? e_Side.e_Side_Left : e_Side.e_Side_Right;
        if (s1 === side && s3 === side && Math.abs(a1 + a3) < pi) selectAnim = false;
        if (s2 === side && s3 === side && Math.abs(s2 + a3) < pi) selectAnim = false;
      }
    }
    if (selectAnim && query.byPickupBall) {
      if ((a.GetVariable('outgoing_retain_state') === '' && query.pickupBall) || (a.GetVariable('outgoing_retain_state') !== '' && !query.pickupBall)) selectAnim = false;
    }
    if (selectAnim && !query.allowLastDitchAnims) if (a.GetVariable('lastditch') === 'true') selectAnim = false;
    if (selectAnim) {
      if (query.byIncomingBodyDirection && !(query.byIncomingVelocity && query.incomingVelocity === e_Velocity.e_Velocity_Idle)) {
        const m = 0.06 * pi;
        if (FloatToEnumVelocity(a.GetIncomingVelocity()) !== e_Velocity.e_Velocity_Idle) {
          const inc = a.GetIncomingBodyDirection();
          if (selectAnim) if (Math.abs(RefFixAngle(a.GetIncomingBodyDirection().GetAngle2D())) > Math.abs(RefFixAngle(query.incomingBodyDirection.GetAngle2D())) + m) selectAnim = false;
          if (selectAnim) {
            const outB = new Vector3(0, -1, 0).GetRotated2D(a.GetOutgoingBodyAngle() + a.GetOutgoingAngle());
            if (query.incomingBodyDirection_Strict) { if (Math.abs(inc.GetAngle2D(query.incomingBodyDirection)) > m) selectAnim = false; }
            else if (Math.abs(inc.GetAngle2D(query.incomingBodyDirection)) > 0.5 * pi + m) selectAnim = false;
            if (query.incomingBodyDirection_ForceLinearity) {
              const s1 = inc.GetAngle2D(outB); const s2 = inc.GetAngle2D(query.incomingBodyDirection);
              if ((s1 > m && s2 > m) || (s1 < -m && s2 < -m)) selectAnim = false;
              if (Math.abs(s1) + Math.abs(s2) > pi + m) selectAnim = false;
            }
          }
        } else {
          if (query.incomingBodyDirection_Strict) { if (Math.abs(new Vector3(0, -1, 0).GetAngle2D(query.incomingBodyDirection)) > m) selectAnim = false; }
          else if (Math.abs(new Vector3(0, -1, 0).GetAngle2D(query.incomingBodyDirection)) > 0.25 * pi + m) selectAnim = false;
        }
      }
    }
    if (selectAnim && query.byIncomingBallDirection) {
      let abd = GetVectorFromString(a.GetVariable('incomingballdirection'));
      if (abd.GetLength() < 0.1) throw new Error('missing incoming ball direction');
      if (abd.GetLength() !== 0 && query.incomingBallDirection.GetLength() !== 0) {
        abd = abd.WithCoord(2, abd.coords[2] * 0.4).GetNormalized();
        const q = query.incomingBallDirection.WithCoord(2, query.incomingBallDirection.coords[2] * 0.4).GetNormalized();
        const ang = Math.abs(q.GetAngle2D(abd));
        let md = Math.abs(atof(a.GetVariable('incomingballdirection_maxdeviation')) * pi);
        if (md === 0) { md = 0.25 * pi; if (animType === 'deflect') md = 0.4 * pi; }
        if (ang > md) selectAnim = false;
      }
    }
    if (selectAnim && query.byOutgoingBallDirection) {
      const abd = GetVectorFromString(a.GetVariable('balldirection')).GetNormalized(new Vector3(0));
      const ang = Math.abs(query.outgoingBallDirection.Get2D().GetNormalized(abd).GetAngle2D(abd));
      let md = Math.abs(atof(a.GetVariable('outgoingballdirection_maxdeviation')) * pi);
      if (md === 0) md = 0.25 * pi;
      if (ang > md) selectAnim = false;
    }
    if (selectAnim) {
      if (query.properties.Get('incoming_special_state') !== a.GetVariable('incoming_special_state')) selectAnim = false;
      if ((query.functionType === e_FunctionType.e_FunctionType_Deflect || ((query.properties.Get('incoming_retain_state') !== '') !== (a.GetVariable('incoming_retain_state') !== ''))) &&
          query.properties.Get('incoming_retain_state') !== a.GetVariable('incoming_retain_state')) selectAnim = false;
      if (atof(query.properties.Get('specialvar1')) !== atof(a.GetVariable('specialvar1'))) selectAnim = false;
      if (atof(query.properties.Get('specialvar2')) !== atof(a.GetVariable('specialvar2'))) selectAnim = false;
    }
    if (selectAnim && query.byTripType) if (Math.trunc(cround(atof(a.GetVariable('triptype')))) !== query.tripType) selectAnim = false;
    if (selectAnim && query.heedForcedFoot) {
      const ff = a.GetVariable('forcedfoot'); let which = 0; if (ff === 'strong') which = 1; else if (ff === 'weak') which = 2;
      if (which !== 0) {
        let foot = e_Foot.e_Foot_Right; if (a.GetVariable('touchfoot') === 'left') foot = e_Foot.e_Foot_Left;
        if (a.GetCurrentFoot() === e_Foot.e_Foot_Left) foot = foot === e_Foot.e_Foot_Left ? e_Foot.e_Foot_Right : e_Foot.e_Foot_Left;
        if (which === 1 && query.strongFoot !== foot) selectAnim = false;
        if (which === 2 && query.strongFoot === foot) selectAnim = false;
      }
    }
    if (selectAnim) dataSet.push(i);
  }
}

let seed = 12345;
const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
const pick = <T,>(arr: T[]): T => arr[Math.floor(rnd() * arr.length)];
const dir = () => { const a = rnd() * 2 * pi; return pick([new Vector3(0, -1, 0), new Vector3(1, 0, 0), new Vector3(Math.cos(a), Math.sin(a), 0), new Vector3(Math.cos(a), Math.sin(a), rnd() - 0.3), new Vector3(0)]); };

describe('CrudeSelection', () => {
  it('selects exactly like a direct translation of the C++', () => {
    // some random queries hit the C++ Log(e_FatalError) for anims without incoming ball direction (throws in both)
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const all = anims.GetAnimations();
    let total = 0; let nonEmpty = 0;
    const types = [e_FunctionType.e_FunctionType_None, ...Object.keys(typeName).map(Number)];
    const velos = [e_Velocity.e_Velocity_Idle, e_Velocity.e_Velocity_Dribble, e_Velocity.e_Velocity_Walk, e_Velocity.e_Velocity_Sprint];
    for (let n = 0; n < 3000; n++) {
      const q = new CrudeSelectionQuery();
      q.byFunctionType = rnd() < 0.9; q.functionType = pick(types);
      q.heedForcedFoot = rnd() < 0.5; q.strongFoot = pick([e_Foot.e_Foot_Left, e_Foot.e_Foot_Right]);
      q.bySide = rnd() < 0.5; q.lookAtVecRel = dir();
      q.allowLastDitchAnims = rnd() < 0.5;
      q.byIncomingVelocity = rnd() < 0.7; q.incomingVelocity_Strict = rnd() < 0.3; q.incomingVelocity_NoDribbleToIdle = rnd() < 0.5; q.incomingVelocity_NoDribbleToSprint = rnd() < 0.5; q.incomingVelocity_ForceLinearity = rnd() < 0.5; q.incomingVelocity = pick(velos);
      q.byOutgoingVelocity = rnd() < 0.3; q.outgoingVelocity = pick(velos);
      q.byPickupBall = rnd() < 0.5; q.pickupBall = rnd() < 0.5;
      q.byIncomingBodyDirection = rnd() < 0.7; q.incomingBodyDirection = dir(); q.incomingBodyDirection_Strict = rnd() < 0.3; q.incomingBodyDirection_ForceLinearity = rnd() < 0.5;
      q.byIncomingBallDirection = rnd() < 0.3 && q.byFunctionType && q.functionType !== e_FunctionType.e_FunctionType_Movement && q.functionType !== e_FunctionType.e_FunctionType_None && q.functionType !== e_FunctionType.e_FunctionType_Trip && q.functionType !== e_FunctionType.e_FunctionType_Special; q.incomingBallDirection = dir();
      q.byOutgoingBallDirection = rnd() < 0.3; q.outgoingBallDirection = dir();
      q.byTripType = rnd() < 0.2; q.tripType = pick([0, 1, 2, 3]);
      if (rnd() < 0.2) q.properties.Set('incoming_special_state', pick(['', 'lay_back', 'lay_front']));
      if (rnd() < 0.2) q.properties.Set('incoming_retain_state', pick(['', 'right_elbow', 'left_elbow']));
      if (rnd() < 0.1) q.properties.Set('specialvar1', pick(['1', '2', '3', '0']));
      const a: number[] = []; const b: number[] = [];
      let refError: unknown = null; let optError: unknown = null;
      try { Reference(all, a, q); } catch (e) { refError = e; }
      try { anims.CrudeSelection(b, q); } catch (e) { optError = e; }
      expect(optError === null).toBe(refError === null);
      if (refError) continue;
      expect(b).toEqual(a);
      total++; if (a.length > 0) nonEmpty++;
    }
    errorSpy.mockRestore();
    expect(total).toBeGreaterThan(2000);
    expect(nonEmpty).toBeGreaterThan(300);
  });
});

describe('football utils', () => {
  it('smooths values over time', () => {
    const smoother = new TemporalSmoother<Vector3>(new Vector3(0));
    expect(smoother.GetValue(1000).Equals(new Vector3(0))).toBe(true);
    smoother.SetValue(new Vector3(0, 0, 0), 1000);
    smoother.SetValue(new Vector3(10, 0, 0), 1010);
    expect(smoother.GetValue(1025, 20).coords[0]).toBeCloseTo(5);
    const quats = new TemporalSmoother<Quaternion>(Quaternion.IDENTITY);
    quats.SetValue(Quaternion.IDENTITY, 1000);
    quats.SetValue(Quaternion.FromAngleAxis(pi * 0.5, new Vector3(0, 0, 1)), 1010);
    expect(quats.GetValue(1025, 20).GetAngleAxis().angle).toBeCloseTo(pi * 0.25, 2);
    const floats = new TemporalSmoother<number>(0);
    floats.SetValue(10, 1000);
    floats.SetValue(20, 1010);
    expect(floats.GetValue(1025, 20)).toBeCloseTo(15);
  });

  it('quantizes directions', () => {
    const q = QuantizeDirection(new Vector3(1, 0.3, 0).GetNormalized().Mul(2));
    expect(q.coords[0]).toBeCloseTo(2, 5);
    expect(q.coords[1]).toBeCloseTo(0, 5);
    const d = QuantizeDirection(new Vector3(1, 0.8, 0));
    expect(d.GetNormalized().coords[0]).toBeCloseTo(Math.SQRT1_2, 5);
  });

  it('projects to screen coordinates', () => {
    const camera = new Camera('cam');
    camera.SetFOV(45);
    // identity rotation: the camera looks along -z
    const center = GetProjectedCoord(new Vector3(0, 0, -100), camera);
    expect(center.coords[0]).toBeCloseTo(50);
    expect(center.coords[1]).toBeCloseTo(50);
    expect(GetProjectedCoord(new Vector3(10, 0, -100), camera).coords[0]).toBeGreaterThan(50);
    expect(GetProjectedCoord(new Vector3(0, 10, -100), camera).coords[1]).toBeLessThan(50);
  });

  it('computes player profiles', () => {
    InitDefaultProfiles();
    const positions = GetWeightedPositions('D/WB L, DM');
    expect(positions.map((p) => p.positionName)).toEqual([e_PositionName.e_PositionName_D, e_PositionName.e_PositionName_WB, e_PositionName.e_PositionName_DM]);
    expect(positions[0].weight).toBeCloseTo(0.5);
    const profile = GetDefaultProfile(positions);
    expect(profile.length).toBe(22);
    const average = profile.reduce((s, p) => s + p.value, 0) / profile.length;
    expect(average).toBeCloseTo(0.5, 5);
    expect(CalculateStat(0.6, 0.5, 27, e_DevelopmentCurveType.e_DevelopmentCurveType_Normal)).toBeCloseTo(0.72, 5);
  });
});

describe('TeamData / PlayerData', () => {
  it('loads team 1 from the database', () => {
    const db = Database.LoadDefault();
    SetDB(db);
    const team = new TeamData(1);
    const record = db.GetTeam(1);
    expect(team.GetName()).toBe(record.name);
    expect(team.GetShortName()).toBe('AJA');
    expect(team.GetLogoUrl()).toBe('databases/default/' + record.logo_url);
    expect(team.GetKitUrl()).toBe('databases/default/' + record.kit_url);
    expect(team.GetColor1().Equals(new Vector3(255, 50, 50))).toBe(true);
    expect(team.GetColor2().Equals(new Vector3(255, 255, 255))).toBe(true);
    expect(team.GetDatabaseID()).toBe(1);

    const ids = db.GetTeamPlayerIDs(1);
    expect(team.GetPlayerNum()).toBe(ids.length);
    expect(team.GetPlayerNum()).toBeGreaterThanOrEqual(playerNum);
    expect(team.GetPlayerData().map((p) => p.GetDatabaseID())).toEqual(ids);

    expect(team.GetFormationEntry(0).role).toBe(e_PlayerRole.e_PlayerRole_GK);
    for (let i = 0; i < playerNum; i++) {
      const entry = team.GetFormationEntry(i);
      expect(Math.abs(entry.position.coords[0])).toBeLessThanOrEqual(1);
      expect(Math.abs(entry.position.coords[1])).toBeLessThanOrEqual(1);
    }
    // GetFormationEntry returns a copy
    const entry = team.GetFormationEntry(3);
    entry.position = new Vector3(9, 9, 9);
    expect(team.GetFormationEntry(3).position.coords[0]).not.toBe(9);

    expect(team.GetTactics().userProperties.GetReal('dribble_offensiveness')).toBeCloseTo(0.7);
    expect(team.GetTactics().factoryProperties.GetReal('position_offense_width_factor')).toBeCloseTo(0.8);
    expect(team.GetTactics().humanReadableNames.Get('dribble_offensiveness')).toBe('CPU player on the ball: offensiveness');

    const player = team.GetPlayerData(0);
    const precord = db.GetPlayer(player.GetDatabaseID());
    expect(player.GetLastName()).toBe(precord.lastname);
    expect(player.GetFirstName()).toBe(precord.firstname);
    expect(player.GetSkinColor()).toBe(precord.skincolor);
    expect(player.GetHairStyle()).toBe(precord.hairstyle);
    expect(player.GetHeight()).toBeCloseTo(precord.height);
    expect(player.GetRoles().length).toBeGreaterThan(0);
    const stat = player.GetStat('physical_balance');
    expect(stat).toBeGreaterThan(0);
    expect(stat).toBeLessThanOrEqual(1);
    const profile = /<physical_balance>([0-9.]+)<\/physical_balance>/.exec(precord.profile_xml)!;
    expect(stat).toBeCloseTo(CalculateStat(precord.base_stat, Number(profile[1]), precord.age, e_DevelopmentCurveType.e_DevelopmentCurveType_Normal), 5);

    // switch and look up players
    const id0 = team.GetPlayerData(0).GetDatabaseID();
    const id1 = team.GetPlayerData(1).GetDatabaseID();
    team.SwitchPlayers(id0, id1);
    expect(team.GetPlayerData(0).GetDatabaseID()).toBe(id1);
    expect(team.GetPlayerDataByDatabaseID(id0).GetDatabaseID()).toBe(id0);

    // tactics are saved back into the database
    team.GetTacticsWritable().userProperties.Set('dribble_offensiveness', 0.25);
    team.SaveTactics();
    expect(db.GetTeam(1).tactics_xml).toContain('<dribble_offensiveness>0.250000</dribble_offensiveness>');
  });

  it('builds match data and default (official) player data', () => {
    SetDB(Database.LoadDefault());
    const match = new MatchData(1, 2);
    expect(match.GetTeamData(0).GetDatabaseID()).toBe(1);
    expect(match.GetTeamData(1).GetDatabaseID()).toBe(2);
    match.AddPossessionTime_10ms(1);
    expect(match.GetPossessionTime_ms(1)).toBe(10);
    expect(match.GetPossessionFactor_60seconds()).toBeGreaterThan(0.5);
    const official = new PlayerData();
    expect(official.GetStat('physical_velocity')).toBeCloseTo(0.6);
    expect(official.GetHairStyle()).toBe('short01');
  });
});
