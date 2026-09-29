import { describe, expect, it, beforeAll } from 'vitest';
import { installDiskFileSystem } from './helpers';
import { Vector3, Quaternion } from '../src/blunted/base/math/vector3';
import { pi } from '../src/blunted/base/math/bluntmath';
import { FileSystem } from '../src/blunted/managers/filesystem';
import { Scene3D } from '../src/blunted/scene/scene3d';
import { Camera } from '../src/blunted/scene/objects/camera';
import { ObjectLoader } from '../src/blunted/utils/objectloader';
import { e_FunctionType, e_PlayerRole, e_Velocity, playerNum } from '../src/game/gamedefines';
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
import { Animation, MovementHistoryEntry } from '../src/game/utils/animation';
import { FootballAnimationExtension } from '../src/game/utils/animationextensions/footballanimationextension';
import { AnimCollection, CrudeSelectionQuery, FillNodeMap, FloatToEnumVelocity } from '../src/game/onthepitch/player/humanoid/animcollection';

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
    const worst = idle.map((a) => [Math.abs(a.GetIncomingBodyAngle()), a.GetName()] as const).sort((a, b) => b[0] - a[0]);
    console.log('PROBE', worst.slice(0, 6), idle.filter((a) => Math.abs(a.GetIncomingBodyAngle()) > 0.001).length, idle.length);
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
    const start = performance.now();
    const runs = 200;
    for (let r = 0; r < runs; r++) {
      const ds: number[] = [];
      anims.CrudeSelection(ds, r % 2 === 0 ? query : shotQuery);
    }
    const perRun = (performance.now() - start) / runs;
    console.log(`CrudeSelection over ${anims.GetAnimations().length} anims: ${perRun.toFixed(3)} ms per query`);
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
