// Port of legacy/src/onthepitch/match.{hpp,cpp}. Original: written by bastiaan konings schuiling 2008 - 2015 (public domain / Apache-2.0).

import type { AABB } from '../../blunted/base/geometry/aabb';
import { Line } from '../../blunted/base/geometry/line';
import { Triangle } from '../../blunted/base/geometry/triangle';
import { Vector3, Quaternion } from '../../blunted/base/math/vector3';
import { clamp, cround, NormalizedClamp, pi, random, signSide, type radian } from '../../blunted/base/math/bluntmath';
import { assert } from '../../blunted/base/assert';
import { CircularBuffer } from '../../blunted/base/circularbuffer';
import { Log, e_Notice } from '../../blunted/base/log';
import { atof, get_file_extension, ValueHistory } from '../../blunted/base/utils';
import { FileSystem } from '../../blunted/managers/filesystem';
import { ResourceManagerPool } from '../../blunted/managers/resourcemanagerpool';
import { Node } from '../../blunted/scene/node';
import { Camera } from '../../blunted/scene/objects/camera';
import type { Geometry } from '../../blunted/scene/objects/geometry';
import type { Light } from '../../blunted/scene/objects/light';
import { Sound } from '../../blunted/scene/objects/sound';
import { GetTriangleMeshElementCount, type MaterializedTriangleMesh } from '../../blunted/scene/resources/geometrydata';
import type { Resource } from '../../blunted/scene/resources/resource';
import type { Surface } from '../../blunted/scene/resources/surface';
import type { Scene3D } from '../../blunted/scene/scene3d';
import { e_LocalMode, e_ObjectType, type Spatial } from '../../blunted/scene/spatial';
import { ObjectLoader } from '../../blunted/utils/objectloader';
import type { MatchData } from '../data/matchdata';
import { TemporalSmoother } from '../footballutils';
import {
  _default_CameraAngleFactor,
  _default_CameraFOV,
  _default_CameraHeight,
  _default_CameraZoom,
  e_FunctionType,
  e_MatchPhase,
  e_TouchType,
  GetVertexColors,
  idleVelocity,
  lineHalfW,
  pitchHalfH,
  pitchHalfW,
  sprintVelocity,
} from '../gamedefines';
import {
  EnvironmentManager,
  GetBlueDebugPilon,
  GetConfiguration,
  GetGreenDebugPilon,
  GetLargeDebugCircle,
  GetMenuTask,
  GetRedDebugPilon,
  GetScene3D,
  GetScheduler,
  GetSmallDebugCircle1,
  GetSmallDebugCircle2,
  GetYellowDebugPilon,
  SuperDebug,
  Verbose,
  type TaskSequenceInfo,
} from '../globals';
import type { IHIDevice } from '../hid/ihidevice';
import { SDLK_F1, UserEventManager } from '../hid/usereventmanager';
import { Gui2Radar } from '../menu/ingame/radar';
import { Gui2ScoreBoard } from '../menu/ingame/scoreboard';
import { Gui2TacticsDebug } from '../menu/ingame/tacticsdebug';
import type { MenuTask } from '../menu/menutask';
import { Gui2Caption } from '../ui/gui2';
import type { Animation } from '../utils/animation';
import { SplitGeometry } from '../utils/splitgeometry';
import { MentalImage } from './AIsupport/mentalimage';
import { Ball } from './ball';
import type { e_PlayerColor } from './humangamer';
import { Officials } from './officials';
import { AnimCollection } from './player/humanoid/animcollection';
import type { Player } from './player/player';
import type { PlayerBase } from './player/playerbase';
import { GeneratePitch } from './proceduralpitch';
import { Referee, type RefereeBuffer } from './referee';
import { Team } from './team';

const replaySize_ms = 10000;
const camPosSize = 150; //180; //130

const AXIS_X = new Vector3(1, 0, 0);
const AXIS_Z = new Vector3(0, 0, 1);

// PORT: the tactics debug overlay was created inside `if (1 == 2)` in the C++; kept behind this flag
const showTacticsDebug = false;

export class ReplaySpatialFrame {
  frameTime_ms = 0;
  position = new Vector3(0);
  orientation = Quaternion.IDENTITY;
}

export class ReplayBallTouchesNetFrame {
  frameTime_ms = 0;
  ballTouchesNet = false;
}

export class ReplaySpatial {
  spatial!: Spatial;
  frames: CircularBuffer<ReplaySpatialFrame>;

  constructor(frameCount: number) {
    this.frames = new CircularBuffer<ReplaySpatialFrame>(frameCount);
  }
}

export class PlayerBounce {
  constructor(
    public opp: Player,
    public force: number,
  ) {}
}

export class ReplayState {
  dirty = false;
  viewTime_ms = 0;
  cam = 0;
  modifierValue = 0;
}

/**
 * PORT: replacement for boost::signals2::signal<void(Match*)>. Slots are called synchronously by
 * emit(); `sig(match)` in C++ is `sig.emit(match)` here.
 */
export class MatchSignal {
  protected slots: ((match: Match) => void)[] = [];

  connect(slot: (match: Match) => void): void {
    this.slots.push(slot);
  }

  disconnect(slot: (match: Match) => void): void {
    const i = this.slots.indexOf(slot);
    if (i >= 0) this.slots.splice(i, 1);
  }

  disconnect_all_slots(): void {
    this.slots = [];
  }

  emit(match: Match): void {
    for (const slot of [...this.slots]) slot(match);
  }
}

/** a vertex position inside a Float32Array vertex buffer (C++ stored float* into the buffer) */
interface NettingVertexRef {
  vertices: Float32Array;
  index: number;
}

/** PORT: C++ Node::GetSpatials(list, recurse = true) is not part of the ported Node; same traversal */
function GetSpatials(node: Node, gatherSpatials: Spatial[], recurse = true): void {
  for (const object of node.GetChildObjects()) gatherSpatials.push(object);
  if (recurse) {
    for (const child of node.GetChildNodes()) {
      gatherSpatials.push(child);
      GetSpatials(child, gatherSpatials, recurse);
    }
  }
}

export class Match {
  // not sure about how signals work in this game at the moment. whole menu/game thing needs a rethink, i guess
  sig_OnMatchPhaseChange = new MatchSignal();
  sig_OnShortReplayMoment = new MatchSignal();
  sig_OnExtendedReplayMoment = new MatchSignal();
  sig_OnGameOver = new MatchSignal();
  sig_OnCreatedMatch = new MatchSignal();
  sig_OnExitedMatch = new MatchSignal();

  /** C++ Lockable<ReplayState> */
  replayState = new ReplayState();

  // for stuff like animation smoothing, we could need the time elapsed since last Put() and such
  protected previousProcessTime_ms = 0;
  protected previousPreparePutTime_ms = 0;
  protected previousPutTime_ms = 0;
  protected timeSincePreviousProcess_ms = 0;
  protected timeSincePreviousPreparePut_ms = 0;
  protected timeSincePreviousPut_ms = 0;

  protected matchData: MatchData;
  protected teams!: [Team, Team];

  protected officials!: Officials;

  protected dynamicNode!: Node;

  protected cameraNode!: Node;
  protected camera!: Camera;
  protected sunNode!: Node;

  protected stadiumNode!: Node;
  protected goalsNode!: Node;

  // camera user settings
  protected cameraUserZoom = 0;
  protected cameraUserHeight = 0;
  protected cameraUserFOV = 0;
  protected cameraUserAngleFactor = 0;

  protected anims!: AnimCollection;

  protected controllers: IHIDevice[];

  protected ball!: Ball;

  /** [index] == index * 10 ms ago ([0] == now) */
  protected mentalImages: MentalImage[] = [];

  protected scoreboard!: Gui2ScoreBoard;
  protected radar!: Gui2Radar;
  protected tacticsDebug: Gui2TacticsDebug | null = null;
  protected messageCaption!: Gui2Caption;
  protected messageCaptionRemoveTime_ms = 0;

  protected iterations = 0;
  protected gameSequenceInfo!: TaskSequenceInfo;
  protected matchTime_ms = 0;
  protected actualTime_ms = 0;
  protected buf_matchTime_ms = 0;
  protected buf_actualTime_ms = 0;
  protected fetchedbuf_matchTime_ms = 0;
  protected fetchedbuf_actualTime_ms = 0;
  protected goalScoredTimer = 0;

  protected pause = false;
  /** 0 - first half; 1 - second half; 2 - 1st extra time; 3 - 2nd extra time; 4 - penalties */
  protected matchPhase = e_MatchPhase.e_MatchPhase_PreMatch;
  protected inPlay = false;
  protected inSetPiece = false;
  /** true after goal scored, false again after next match state change */
  protected goalScored = false;
  protected ballIsInGoal = false;
  protected lastGoalTeamID = 0;
  protected lastGoalScorer: Player | null = null;
  protected lastTouchTeamIDs: number[] = Array.from({ length: e_TouchType.e_TouchType_SIZE }, () => -1);
  protected lastTouchTeamID = -1;
  protected bestPossessionTeamID = -1;
  protected designatedPossessionPlayer!: Player;
  protected ballRetainer: Player | null = null;

  protected gameOver = false;

  protected fullbodyNode!: Node;
  /** C++ std::map<Vector3, Vector3>, keyed with Float32Key (see GetVertexColors) */
  protected colorCoords = new Map<string, Vector3>();

  protected possessionSideHistory = new ValueHistory(6000);

  protected autoUpdateIngameCamera = true;

  // camera
  protected cameraOrientation = Quaternion.IDENTITY;
  protected cameraNodeOrientation = Quaternion.IDENTITY;
  protected cameraNodePosition = new Vector3(0);
  protected cameraFOV = 25;
  protected cameraNearCap = 1;
  protected cameraFarCap = 220;

  protected buf_cameraOrientation = new TemporalSmoother<Quaternion>(Quaternion.IDENTITY);
  protected buf_cameraNodeOrientation = new TemporalSmoother<Quaternion>(Quaternion.IDENTITY);
  protected buf_cameraNodePosition = new TemporalSmoother<Vector3>(new Vector3(0));
  protected buf_cameraFOV = new TemporalSmoother<number>(0);
  protected buf_cameraNearCap = 1;
  protected buf_cameraFarCap = 220;
  protected fetchedbuf_cameraOrientation = Quaternion.IDENTITY;
  protected fetchedbuf_cameraNodeOrientation = Quaternion.IDENTITY;
  protected fetchedbuf_cameraNodePosition = new Vector3(0);
  protected fetchedbuf_cameraFOV = 25;
  protected fetchedbuf_cameraNearCap = 1;
  protected fetchedbuf_cameraFarCap = 220;

  protected fetchedbuf_timeDelta = 0;

  protected lastBodyBallCollisionTime_ms = 0;

  /** todo: circular buffer? */
  protected camPos: Vector3[] = [];

  protected referee!: Referee;

  protected menuTask: MenuTask;

  protected scene3D!: Scene3D;

  protected crowd01!: Sound;
  protected crowd02!: Sound;

  protected replay: ReplaySpatial[] = [];
  protected replayBallTouchesNetFrames!: CircularBuffer<ReplayBallTouchesNetFrame>;
  protected resetNetting = false;
  protected nettingHasChanged = false;

  protected excitement = 0;

  protected previousBallPos = new Vector3(0);

  protected matchDurationFactor = 0;

  protected animPositionCache = new Map<Animation, Vector3[]>();

  protected nettingMeshesSrc: [Vector3[], Vector3[]] = [[], []];
  protected nettingMeshes: [NettingVertexRef[], NettingVertexRef[]] = [[], []];

  protected matchDifficulty = 0;

  constructor(matchData: MatchData, controllers: IHIDevice[]) {
    this.matchData = matchData;
    this.controllers = controllers;

    Log(e_Notice, 'Match', 'Match', 'Starting Match');

    // shared ptr to menutask, because menutask shouldn't die before match does
    this.menuTask = GetMenuTask();

    this.iterations = 0;
    this.actualTime_ms = 0;
    this.buf_matchTime_ms = 0;
    this.buf_actualTime_ms = 0;
    this.goalScoredTimer = 0;

    this.replayState.dirty = false;

    this.resetNetting = false;
    this.nettingHasChanged = false;

    // PORT: C++ computes this in float; Math.fround keeps the exact same value (it drives the match clock)
    this.matchDurationFactor = Math.fround(Math.fround(Math.fround(GetConfiguration().GetReal('match_duration', 1.0)) * Math.fround(0.2)) + Math.fround(0.05));
    this.matchDifficulty = GetConfiguration().GetReal('match_difficulty', 0.8);

    Log(e_Notice, 'Match', 'Match', 'Creating dynamicNode');

    this.dynamicNode = new Node('dynamicNode');
    GetScene3D().AddNode(this.dynamicNode);

    Log(e_Notice, 'Match', 'Match', 'Adding debugpilons');

    this.dynamicNode.AddObject(GetGreenDebugPilon());
    this.dynamicNode.AddObject(GetBlueDebugPilon());
    this.dynamicNode.AddObject(GetYellowDebugPilon());
    this.dynamicNode.AddObject(GetRedDebugPilon());
    this.dynamicNode.AddObject(GetSmallDebugCircle1());
    this.dynamicNode.AddObject(GetSmallDebugCircle2());
    this.dynamicNode.AddObject(GetLargeDebugCircle());

    // ball

    Log(e_Notice, 'Match', 'Match', 'Creating a ball');

    this.ball = new Ball(this);

    // animation database

    Log(e_Notice, 'Match', 'Match', 'Loading player animations');

    this.anims = new AnimCollection(GetScene3D());
    this.anims.Load('media/animations');

    // cache animation positions

    Log(e_Notice, 'Match', 'Match', 'Caching animation positions');

    const animationsTmp = this.anims.GetAnimations();
    for (let i = 0; i < animationsTmp.length; i++) {
      const positions: Vector3[] = [];
      const someAnim = animationsTmp[i];
      for (let frame = 0; frame < someAnim.GetFrameCount(); frame++) {
        const keyFrame = someAnim.GetKeyFrame('player', frame, false, true);
        positions.push(keyFrame.position.WithCoord(2, 0.0));
      }
      this.animPositionCache.set(someAnim, positions);
    }

    // full body model template

    Log(e_Notice, 'Match', 'Match', 'Loading fullbody object');

    const loader = new ObjectLoader();
    this.fullbodyNode = loader.LoadObject('media/objects/players/fullbody.object');

    Log(e_Notice, 'Match', 'Match', 'Fullbody object: getting vertex colors');

    GetVertexColors(this.colorCoords);

    // teams

    Log(e_Notice, 'Match', 'Match', 'Creating teams/players');

    assert(matchData !== null);

    this.teams = [new Team(0, this, matchData.GetTeamData(0)), new Team(1, this, matchData.GetTeamData(1))];
    this.teams[0].InitPlayers(this.fullbodyNode, this.colorCoords);
    this.teams[1].InitPlayers(this.fullbodyNode, this.colorCoords);

    const activePlayers: Player[] = [];
    this.teams[0].GetActivePlayers(activePlayers);
    this.designatedPossessionPlayer = activePlayers[0];
    this.ballRetainer = null;

    // officials

    Log(e_Notice, 'Match', 'Match', 'Creating referee/linesmen models');

    const kitFilename = 'media/objects/players/textures/referee_kit.png';
    const kit: Resource<Surface> = ResourceManagerPool.GetInstance().FetchSurface(kitFilename);
    this.officials = new Officials(this, this.fullbodyNode, this.colorCoords, kit, this.anims);

    this.dynamicNode.AddObject(this.officials.GetYellowCardGeom());
    this.dynamicNode.AddObject(this.officials.GetRedCardGeom());

    // camera

    Log(e_Notice, 'Match', 'Match', 'Creating camera objects');

    this.camera = new Camera('camera');
    this.camera.Init();

    this.camera.SetFOV(25);
    this.cameraNode = new Node('cameraNode');
    this.cameraNode.AddObject(this.camera);
    this.cameraNode.SetPosition(new Vector3(40, 0, 100));
    this.GetDynamicNode().AddNode(this.cameraNode);

    this.cameraUserZoom = GetConfiguration().GetReal('camera_zoom', _default_CameraZoom);
    this.cameraUserHeight = GetConfiguration().GetReal('camera_height', _default_CameraHeight);
    this.cameraUserFOV = GetConfiguration().GetReal('camera_fov', _default_CameraFOV);
    this.cameraUserAngleFactor = GetConfiguration().GetReal('camera_anglefactor', _default_CameraAngleFactor);

    this.autoUpdateIngameCamera = true;

    // stadium

    Log(e_Notice, 'Match', 'Match', 'Loading stadium');

    let tmpStadiumNode: Node;
    if (!SuperDebug()) {
      tmpStadiumNode = loader.LoadObject('media/objects/stadiums/test/test.object');
      this.RandomizeAdboards(tmpStadiumNode);
    } else {
      tmpStadiumNode = loader.LoadObject('media/objects/stadiums/test/pitchonly.object');
    }
    const stadiumGeoms: Geometry[] = [];

    // split stadium geometry into multiple geometry objects, for more efficient culling
    tmpStadiumNode.GetObjects<Geometry>(e_ObjectType.e_ObjectType_Geometry, stadiumGeoms);
    assert(stadiumGeoms.length !== 0);

    this.stadiumNode = new Node('stadium');

    for (const stadiumGeom of stadiumGeoms) {
      const tmpNode = SplitGeometry(GetScene3D(), stadiumGeom, 24);
      tmpNode.SetLocalMode(e_LocalMode.e_LocalMode_Absolute);
      this.stadiumNode.AddNode(tmpNode);
    }
    tmpStadiumNode.Exit();

    this.stadiumNode.SetLocalMode(e_LocalMode.e_LocalMode_Absolute);
    GetScene3D().AddNode(this.stadiumNode);

    // goal netting

    Log(e_Notice, 'Match', 'Match', 'Preparing goal netting');

    this.goalsNode = loader.LoadObject('media/objects/stadiums/goals.object');
    this.goalsNode.SetLocalMode(e_LocalMode.e_LocalMode_Absolute);
    GetScene3D().AddNode(this.goalsNode);
    this.PrepareGoalNetting();

    // pitch

    Log(e_Notice, 'Match', 'Match', 'Generating pitch');

    // PORT: the C++ used the big textures in release builds (IsReleaseVersion()). To keep the
    // browser load time low the smaller (C++ debug build) sizes are the default; set the config
    // key "graphics_pitch_highres" to true for the release sizes.
    if (GetConfiguration().GetBool('graphics_pitch_highres', false)) {
      GeneratePitch(2048, 1024, 1024, 512, 2048, 1024);
    } else {
      GeneratePitch(1024, 512, 1024, 512, 2048, 1024);
    }

    // sun

    Log(e_Notice, 'Match', 'Match', 'Loading sun object');

    this.sunNode = loader.LoadObject('media/objects/lighting/generic.object');
    this.GetDynamicNode().AddNode(this.sunNode);
    this.SetRandomSunParams();

    // human gamers

    Log(e_Notice, 'Match', 'Match', 'Human gamer controller init');

    this.UpdateControllerSetup();

    // 12th man sound

    Log(e_Notice, 'Match', 'Match', 'Loading crowd sounds');

    let soundBufferRes = ResourceManagerPool.GetInstance().FetchSoundBuffer('media/sounds/crowd01.wav');
    this.crowd01 = new Sound('crowd01sound');
    this.crowd01.SetSoundBuffer(soundBufferRes);
    this.crowd01.SetGain(0.0);
    this.crowd01.SetLoop(true);
    this.crowd01.Poke();
    GetScene3D().AddObject(this.crowd01);

    soundBufferRes = ResourceManagerPool.GetInstance().FetchSoundBuffer('media/sounds/crowd02.wav');
    this.crowd02 = new Sound('crowd02sound');
    this.crowd02.SetSoundBuffer(soundBufferRes);
    this.crowd02.SetGain(0.0);
    this.crowd02.SetLoop(true);
    this.crowd02.Poke();
    GetScene3D().AddObject(this.crowd02);

    // match params

    this.matchTime_ms = 0;
    this.pause = false;
    this.inPlay = false;
    this.inSetPiece = false;
    this.goalScored = false;
    this.ballIsInGoal = false;
    this.lastGoalTeamID = 0;
    for (let i = 0; i < e_TouchType.e_TouchType_SIZE; i++) {
      this.lastTouchTeamIDs[i] = -1;
    }
    this.lastTouchTeamID = -1;
    this.lastGoalScorer = null;
    this.bestPossessionTeamID = -1;
    this.SetMatchPhase(e_MatchPhase.e_MatchPhase_PreMatch);

    this.gameSequenceInfo = GetScheduler().GetTaskSequenceInfo('game');

    this.previousProcessTime_ms = EnvironmentManager.GetInstance().GetTime_ms() - this.gameSequenceInfo.startTime_ms;
    this.previousPutTime_ms = EnvironmentManager.GetInstance().GetTime_ms() - this.gameSequenceInfo.startTime_ms;
    this.timeSincePreviousProcess_ms = 0;
    this.timeSincePreviousPut_ms = 0;

    // everybody hates him, this poor bloke

    Log(e_Notice, 'Match', 'Match', 'Creating referee functionality');

    this.referee = new Referee(this);

    // GUI

    Log(e_Notice, 'Match', 'Match', 'Creating GUI elements');

    const windowManager = this.menuTask.GetWindowManager();
    const root = windowManager.GetRoot();

    this.radar = new Gui2Radar(
      windowManager,
      'game_radar',
      38,
      78,
      24,
      18,
      this,
      matchData.GetTeamData(0).GetColor1(),
      matchData.GetTeamData(0).GetColor2(),
      matchData.GetTeamData(1).GetColor1(),
      matchData.GetTeamData(1).GetColor2(),
    );
    root.AddView(this.radar);
    this.radar.Show();

    this.tacticsDebug = null;
    if (showTacticsDebug) {
      const tacticsDebug = new Gui2TacticsDebug(windowManager, 'game_tacticsdebug', 22, 1.3, 56, 26, this);
      this.tacticsDebug = tacticsDebug;
      root.AddView(tacticsDebug);
      tacticsDebug.Show();

      const tactics = matchData.GetTeamData(0).GetTactics();
      const userMods = tactics.userProperties.GetProperties();
      let i = 0;
      for (const [name] of userMods) {
        let color = new Vector3(Math.sin(i * 0.7) * 0.5 + 0.5, Math.cos(i * 0.9) * 0.5 + 0.5, Math.sin(i * 1.1) * 0.5 + 0.5);
        color = color.GetNormalized(0).Mul(255);
        color = color.Mul(0.7).Add(new Vector3(255, 255, 255).Mul(0.3));
        const color1 = color.Mul(0.6);
        const color2 = color.Mul(0.4);
        const color3 = color.Mul(1.0);
        tacticsDebug.AddEntry(name, color1, color2, color3);
        i++;
      }
      tacticsDebug.Redraw();
    }

    this.scoreboard = new Gui2ScoreBoard(windowManager, this);
    root.AddView(this.scoreboard);
    this.scoreboard.Show();

    this.messageCaption = new Gui2Caption(windowManager, 'game_messages', 0, 0, 80, 8, '');
    this.messageCaption.SetTransparency(0.3);
    root.AddView(this.messageCaption);
    this.messageCaptionRemoveTime_ms = this.actualTime_ms + 5000;

    // for usage in destructor
    this.scene3D = GetScene3D();

    // replays

    Log(e_Notice, 'Match', 'Match', 'Initialising replay data array');

    const spatials: Spatial[] = [];
    this.GetReplaySpatials(spatials);

    for (const someSpatial of spatials) {
      const spatial = new ReplaySpatial(this.GetReplaySize_ms() / 10);
      spatial.spatial = someSpatial;
      this.replay.push(spatial);
    }
    this.replayBallTouchesNetFrames = new CircularBuffer<ReplayBallTouchesNetFrame>(this.GetReplaySize_ms() / 10);

    this.excitement = 0.0;

    this.lastBodyBallCollisionTime_ms = 0;

    this.gameOver = false;

    this.possessionSideHistory = new ValueHistory(6000);

    Log(e_Notice, 'Match', 'Match', 'Done creating match!');

    // PORT: the disabled light test (maxTestLights == 0) and the position logging (_positionLogging == false) are not ported

    this.sig_OnCreatedMatch.emit(this);
    // PORT: closing the LoadingMatchPage (menu page factory) is left to the app
  }

  Exit(): void {
    this.teams[0].Exit();
    this.teams[1].Exit();
    this.officials.Exit();
    this.ball.Exit();
    this.referee.Exit();
    // PORT: `delete matchData` dropped (garbage collected; the session runner may still read the result from it)
    this.menuTask.SetMatchData(null);

    this.mentalImages = [];

    this.replay = [];

    this.fullbodyNode.Exit();

    this.messageCaption.Hide();
    // PORT: the C++ only hid the caption (the window manager kept it until it died); remove it so
    // hidden captions don't pile up over a career
    this.messageCaption.Exit();

    // remove, don't delete, because main.cpp is owner
    this.GetDynamicNode().RemoveObject(GetGreenDebugPilon());
    this.GetDynamicNode().RemoveObject(GetBlueDebugPilon());
    this.GetDynamicNode().RemoveObject(GetYellowDebugPilon());
    this.GetDynamicNode().RemoveObject(GetRedDebugPilon());
    this.GetDynamicNode().RemoveObject(GetSmallDebugCircle1());
    this.GetDynamicNode().RemoveObject(GetSmallDebugCircle2());
    this.GetDynamicNode().RemoveObject(GetLargeDebugCircle());

    this.scene3D.DeleteNode(this.GetDynamicNode());
    this.scene3D.DeleteNode(this.stadiumNode);
    this.scene3D.DeleteNode(this.goalsNode);

    this.scene3D.DeleteObject(this.crowd01);
    this.scene3D.DeleteObject(this.crowd02);

    this.radar.Exit();
    if (this.tacticsDebug) {
      this.tacticsDebug.Exit();
    }

    this.scoreboard.Exit();

    this.animPositionCache.clear();

    this.sig_OnExitedMatch.emit(this);
  }

  SetRandomSunParams(): void {
    const brightness = 1.0;

    const averageHeightMultiplier = 1.3;
    let sunPos = new Vector3(clamp(random(-1.7, 1.7), -1.0, 1.0), clamp(random(-1.7, 1.7), -1.0, 1.0), averageHeightMultiplier);
    sunPos = sunPos.GetNormalized();
    if (random(0, 1) > 0.5 && sunPos.coords[1] > 0.25) sunPos = sunPos.WithCoord(1, -sunPos.coords[1]); // sun more often on (default) camera side (coming from front == clearer lighting on players)
    const sun = this.sunNode.GetObject('sun') as Light;
    sun.SetPosition(sunPos.Mul(10000.0));

    const defaultRadius = 1000000.0;
    const sunRadius = defaultRadius;
    sun.SetRadius(sunRadius);

    const sunColorNoon = new Vector3(0.9, 0.8, 1.0).Mul(1.4);
    const sunColorDusk = new Vector3(1.4, 0.9, 0.7).Mul(1.2);

    const noonBias = Math.pow(NormalizedClamp(sunPos.coords[2], 0.5, 1.0), 1.2);
    let sunColor = sunColorNoon.Mul(noonBias).Add(sunColorDusk.Mul(1.0 - noonBias));

    let randomAddition = new Vector3(random(-0.1, 0.1), random(-0.1, 0.1), random(-0.1, 0.1));
    randomAddition = randomAddition.Mul(1.2);
    sunColor = sunColor.Add(randomAddition);

    sun.SetColor(sunColor.Mul(brightness));
  }

  RandomizeAdboards(stadiumNode: Node): void {
    // collect texture files

    const files = FileSystem.ListFiles('media/textures/adboards', false).filter((f) => get_file_extension(f) === 'png');

    const adboardSurfaces: Resource<Surface>[] = [];
    for (let i = 0; i < files.length; i++) {
      Log(e_Notice, 'Match', 'RandomizeAdboards', 'loading adboard file ' + files[i]);
      adboardSurfaces.push(ResourceManagerPool.GetInstance().FetchSurface(files[i]));
    }
    if (adboardSurfaces.length === 0) return;

    // collect adboard geoms

    const stadiumGeoms: Geometry[] = [];
    stadiumNode.GetObjects<Geometry>(e_ObjectType.e_ObjectType_Geometry, stadiumGeoms, true);

    // replace

    for (const geomObject of stadiumGeoms) {
      const adboardGeom = geomObject.GetGeometryData();

      const tmesh: MaterializedTriangleMesh[] = adboardGeom.GetResource().GetTriangleMeshesRef();

      for (let i = 0; i < tmesh.length; i++) {
        const diffuseTexture = tmesh[i].material.diffuseTexture;
        if (diffuseTexture) {
          const identString = diffuseTexture.GetIdentString();
          if (identString.indexOf('ad_placeholder') === 0) {
            tmesh[i].material.diffuseTexture = adboardSurfaces[Math.trunc(Math.floor(random(0, adboardSurfaces.length - 1.001)))];
            tmesh[i].material.specular_amount = 0.2;
            tmesh[i].material.shininess = 0.1;
          }
        }
      }

      geomObject.OnUpdateGeometryData();
    }
  }

  UpdateControllerSetup(): void {
    // remove current gamers
    this.teams[0].DeleteHumanGamers();
    this.teams[1].DeleteHumanGamers();

    // add new
    const sides = this.menuTask.GetControllerSetup();
    for (let i = 0; i < sides.length; i++) {
      if (sides[i].side !== 0) {
        const teamID = cround(sides[i].side * 0.5 + 0.5);
        this.teams[teamID].AddHumanGamer(this.controllers[sides[i].controllerID], i as e_PlayerColor); // todo: proper color
      }
    }
  }

  SpamMessage(msg: string, time_ms = 3000): void {
    this.messageCaption.SetCaption(msg);
    const w = this.messageCaption.GetTextWidthPercent();
    this.messageCaption.SetPosition(50 - w * 0.5, 5);
    this.messageCaption.Show();
    this.messageCaptionRemoveTime_ms = this.actualTime_ms + time_ms;
  }

  GetScore(teamID: number): number {
    return this.matchData.GetGoalCount(teamID);
  }

  GetBall(): Ball {
    return this.ball;
  }

  GetTeam(teamID: number): Team {
    return this.teams[teamID];
  }

  GetPlayer(playerID: number): Player {
    for (let t = 0; t < 2; t++) {
      const players = this.teams[t].GetAllPlayers();
      for (let p = 0; p < players.length; p++) {
        if (players[p].GetID() === playerID) {
          return players[p];
        }
      }
    }

    assert(false, 'Match::GetPlayer: player not found'); // shouldn't be here ;)
    return null as unknown as Player;
  }

  GetAllTeamPlayers(teamID: number, players: Player[]): Player[] {
    this.teams[teamID].GetAllPlayers(players);
    return players;
  }

  GetActiveTeamPlayers(teamID: number, players: Player[]): Player[] {
    this.teams[teamID].GetActivePlayers(players);
    return players;
  }

  GetOfficialPlayers(players: PlayerBase[]): PlayerBase[] {
    this.officials.GetPlayers(players);
    return players;
  }

  GetAnimCollection(): AnimCollection {
    return this.anims;
  }

  /** C++ returns const MentalImage*: don't modify */
  GetMentalImage(history_ms: number): MentalImage {
    let index = cround(history_ms / 10.0);
    if (index >= this.mentalImages.length) index = this.mentalImages.length - 1;
    if (index < 0) index = 0;

    this.mentalImages[index].SetTimeStampNeg_ms(index * 10.0);

    return this.mentalImages[index];
  }

  UpdateLatestMentalImageBallPredictions(): void {
    if (this.mentalImages.length > 0) this.mentalImages[0].UpdateBallPredictions();
  }

  ResetSituation(focusPos: Vector3): void {
    this.camPos = [];
    this.SetBallRetainer(null);
    this.SetGoalScored(false);
    this.mentalImages = [];
    this.goalScored = false;
    this.ballIsInGoal = false;
    for (let i = 0; i < e_TouchType.e_TouchType_SIZE; i++) {
      this.lastTouchTeamIDs[i] = -1;
    }
    this.lastTouchTeamID = -1;
    this.lastGoalScorer = null;
    this.bestPossessionTeamID = -1;

    this.possessionSideHistory.Clear();

    this.lastBodyBallCollisionTime_ms = 0;

    this.ball.ResetSituation(focusPos);
    this.teams[0].ResetSituation(focusPos);
    this.teams[1].ResetSituation(focusPos);

    // reset temporalsmoother vars
    // todo: not sure if we may access buf_ vars here
  }

  Pause(doPause: boolean): void {
    this.pause = doPause;
  }

  GetPause(): boolean {
    return this.pause;
  }

  SetMatchPhase(newMatchPhase: e_MatchPhase): void {
    this.matchPhase = newMatchPhase;
    if (this.matchPhase === e_MatchPhase.e_MatchPhase_1stHalf) this.matchTime_ms = 0;
    else if (this.matchPhase === e_MatchPhase.e_MatchPhase_2ndHalf) this.matchTime_ms = 2700000;
    else if (this.matchPhase === e_MatchPhase.e_MatchPhase_1stExtraTime) this.matchTime_ms = 5400000;
    else if (this.matchPhase === e_MatchPhase.e_MatchPhase_2ndExtraTime) this.matchTime_ms = 6300000;
    else if (this.matchPhase === e_MatchPhase.e_MatchPhase_Penalties) this.matchTime_ms = 7200000;

    if (this.matchPhase === e_MatchPhase.e_MatchPhase_2ndHalf) {
      this.teams[0].RelaxFatigue(0.05);
      this.teams[1].RelaxFatigue(0.05);
    }
  }

  GetMatchPhase(): e_MatchPhase {
    return this.matchPhase;
  }

  StartPlay(): void {
    this.inPlay = true;
  }

  StopPlay(): void {
    this.inPlay = false;
  }

  IsInPlay(): boolean {
    return this.inPlay;
  }

  StartSetPiece(): void {
    this.inSetPiece = true;
  }

  StopSetPiece(): void {
    this.inSetPiece = false;
  }

  IsInSetPiece(): boolean {
    return this.inSetPiece;
  }

  GetReferee(): Referee {
    return this.referee;
  }

  GetOfficials(): Officials {
    return this.officials;
  }

  /** C++ returns a const reference: don't modify */
  GetRefereeBuffer(): RefereeBuffer {
    return this.referee.GetBuffer();
  }

  SetGoalScored(onOff: boolean): void {
    if (onOff === false) this.ballIsInGoal = false;
    this.goalScored = onOff;
  }

  IsGoalScored(): boolean {
    return this.goalScored;
  }

  GetLastGoalTeamID(): number {
    return this.lastGoalTeamID;
  }

  /** PORT: not in the C++ header; lets the session runner attribute goals */
  GetLastGoalScorer(): Player | null {
    return this.lastGoalScorer;
  }

  SetLastTouchTeamID(id: number, touchType: e_TouchType = e_TouchType.e_TouchType_Intentional_Kicked): void {
    this.lastTouchTeamIDs[touchType] = id;
    this.lastTouchTeamID = id;
    this.referee.BallTouched();
  }

  GetLastTouchTeamID(touchType?: e_TouchType): number {
    if (touchType !== undefined) return this.lastTouchTeamIDs[touchType];
    return this.lastTouchTeamID;
  }

  /** with touchType: that touch type's team or null; without: the last touch team, or team 0 when nobody touched the ball yet */
  GetLastTouchTeam(touchType: e_TouchType): Team | null;
  GetLastTouchTeam(): Team;
  GetLastTouchTeam(touchType?: e_TouchType): Team | null {
    if (touchType !== undefined) {
      if (this.lastTouchTeamIDs[touchType] !== -1) return this.teams[this.lastTouchTeamIDs[touchType]];
      else return null;
    }
    if (this.lastTouchTeamID !== -1) return this.teams[this.lastTouchTeamID];
    else return this.teams[0];
  }

  GetLastTouchPlayer(touchType?: e_TouchType): Player | null {
    if (touchType !== undefined) {
      const team = this.GetLastTouchTeam(touchType);
      if (team) return team.GetLastTouchPlayer(touchType);
      else return null;
    }
    const team = this.GetLastTouchTeam();
    if (team) return team.GetLastTouchPlayer();
    else return null;
  }

  GetLastTouchBias(decay_ms: number, time_ms = 0): number {
    const team = this.GetLastTouchTeam();
    if (team) return team.GetLastTouchBias(decay_ms, time_ms);
    else return 0;
  }

  IsBallInGoal(): boolean {
    return this.ballIsInGoal;
  }

  GetBestPossessionTeamID(): number {
    return this.bestPossessionTeamID;
  }

  GetDesignatedPossessionPlayer(): Player {
    return this.designatedPossessionPlayer;
  }

  GetBallRetainer(): Player | null {
    return this.ballRetainer;
  }

  SetBallRetainer(retainer: Player | null): void {
    this.ballRetainer = retainer;
  }

  GetAveragePossessionSide(time_ms: number): number {
    return this.possessionSideHistory.GetAverage(time_ms);
  }

  GetIterations(): number {
    return this.iterations;
  }

  GetMatchTime_ms(): number {
    return this.matchTime_ms;
  }

  GetActualTime_ms(): number {
    return this.actualTime_ms;
  }

  GameOver(): void {
    this.gameOver = true;
  }

  /** PORT: not in the C++ header; the session runner polls it (the C++ menus used sig_OnGameOver) */
  IsGameOver(): boolean {
    return this.gameOver;
  }

  /** C++ GetCameraParams(float &zoom, float &height, float &fov, float &angleFactor) */
  GetCameraParams(): { zoom: number; height: number; fov: number; angleFactor: number } {
    return { zoom: this.cameraUserZoom, height: this.cameraUserHeight, fov: this.cameraUserFOV, angleFactor: this.cameraUserAngleFactor };
  }

  SetCameraParams(zoom: number, height: number, fov: number, angleFactor: number): void {
    this.cameraUserZoom = zoom;
    this.cameraUserHeight = height;
    this.cameraUserFOV = fov;
    this.cameraUserAngleFactor = angleFactor;
  }

  UpdateIngameCamera(): void {
    // camera

    const fov = 0.5 + this.cameraUserFOV * 0.5;
    let zoom = this.cameraUserZoom;
    let height = this.cameraUserHeight * 1.5;

    const playerBias = 0.6; //0.7f;
    let ballPos = this.ball.Predict(0).Mul(1.0 - playerBias).Add(this.GetDesignatedPossessionPlayer().GetPosition().Mul(playerBias));
    // look in possession player's direction
    ballPos = ballPos.Add(this.GetDesignatedPossessionPlayer().GetDirectionVec().Mul(1.0));
    // look in possession team's attacking direction
    ballPos = ballPos.Add(
      new Vector3(
        ((this.teams[0].GetFadingTeamPossessionAmount() - 1.0) * -this.teams[0].GetSide() + (this.teams[1].GetFadingTeamPossessionAmount() - 1.0) * -this.teams[1].GetSide()) * 4.0,
        0,
        0,
      ),
    );

    ballPos = ballPos.WithCoord(2, ballPos.coords[2] * 0.1);

    const maxW = pitchHalfW * 0.84 * (1.0 / (zoom + 0.01)); // * (height * 0.75f + 0.25f);
    const maxH = pitchHalfH * 0.6 * (1.0 / (zoom + 0.01)) * (height * 0.75 + 0.25); // 0.52f
    if (Math.abs(ballPos.coords[0]) > maxW) ballPos = ballPos.WithCoord(0, maxW * signSide(ballPos.coords[0]));
    if (Math.abs(ballPos.coords[1]) > maxH) ballPos = ballPos.WithCoord(1, maxH * signSide(ballPos.coords[1]));

    let shudder = new Vector3(random(-0.1, 0.1), random(-0.1, 0.1), 0).Mul(this.ball.GetMovement().GetLength() * 0.8 + 6.0);
    shudder = shudder.Mul(0.2);
    this.camPos.push(ballPos.Add(shudder.Mul(this.camPos.length / camPosSize)));
    if (this.camPos.length > camPosSize) this.camPos.shift();

    let average = new Vector3(0);
    let count = 0;
    const indexSize = this.camPos.length;
    for (let index = 0; index < this.camPos.length; index++) {
      let weight = Math.sin((index / indexSize - 0.3) * 1.4 * pi) * 0.5 + 0.5; // healthy mix of latest & middle | wa: sin((x / 100 - 0.3) * 1.4 * pi) * 0.5 + 0.5 | from x = 0 to 100
      weight *= Math.pow(1.0 - index / indexSize, 0.3); // sharp cutoff @ latest (because cameraperson can't 'foresee' the current moment that fast) | wa: (1.0 - x / 100) ^ 0.3 * (<prev formula>) | from x = 0 to 100
      average = average.Add(this.camPos[index].Mul(weight));
      count += weight;
    }

    average = average.Div(count);

    const angleFac: radian = 1.0 - this.cameraUserAngleFactor * 0.4; // 0.0 == 90 degrees max, 1.0 == sideline view

    // normal cam

    const camMethod: number = 1; // 1 == wide, 2 == birds-eye, 3 == tele

    if (!this.IsGoalScored() || (this.IsGoalScored() && this.goalScoredTimer < 1000)) {
      if (camMethod === 1) {
        // wide cam

        zoom = (0.6 + zoom * 1.0) * (1.0 / fov);
        height = 4.0 + height * 10;

        const distRot = average.coords[1] / 800.0;

        this.cameraOrientation = Quaternion.FromAngleAxis(distRot + (0.42 - height * 0.01) * pi, AXIS_X);
        this.cameraNodeOrientation = Quaternion.FromAngleAxis((-average.coords[0] / pitchHalfW) * (1.0 - angleFac) * 0.25 * pi * 1.24, AXIS_Z);
        this.cameraNodePosition = average
          .Mul(new Vector3(1.0 * (1.0 - this.cameraUserAngleFactor * 0.2) * (1.0 - this.cameraUserZoom * 0.3), 0.9 - this.cameraUserZoom * 0.3, 0.2))
          .Add(new Vector3(0, -41.4 - this.cameraUserFOV * 3.7 + Math.pow(height, 1.2) * 0.46, 10.0 + height).Mul(zoom));
        this.cameraFOV = fov * 28.0 - this.cameraNodePosition.coords[1] / 30.0;
        this.cameraNearCap = this.cameraNodePosition.coords[2];
        this.cameraFarCap = 200;
      } else if (camMethod === 2) {
        // birds-eye cam

        this.cameraOrientation = Quaternion.IDENTITY;
        this.cameraNodeOrientation = Quaternion.IDENTITY;
        this.cameraNodePosition = average.Mul(new Vector3(1, 1, 0)).Add(new Vector3(0, 0, 50 + zoom * 20.0));
        this.cameraFOV = 28;
        this.cameraNearCap = 40 + height - 5;
        this.cameraFarCap = 250; //65 + height * 1.2; doesn't work wtf?
      } else if (camMethod === 3) {
        // tele cam

        zoom = (0.6 + zoom * 1.0) * (1.0 / fov);

        this.cameraOrientation = Quaternion.FromAngleAxis(0.3 * pi * height + 0.4 * pi * (1.0 - height), AXIS_X);
        this.cameraNodeOrientation = Quaternion.IDENTITY;
        const offset = new Vector3(0, -175.0, 125.0).Mul(height).Add(new Vector3(0, -230.0, 65.0).Mul(1.0 - height));
        this.cameraNodePosition = average.Mul(new Vector3(0.9, 0.7, 0.2)).Add(offset.Mul(zoom * 0.4));
        this.cameraFOV = 15.0;
        this.cameraNearCap = 50 + zoom * 10.0;
        this.cameraFarCap = 300;
      }
    } else {
      // scorer cam

      let targetPos = this.ball.Predict(0).Get2D();
      if (this.lastGoalScorer) {
        targetPos = this.lastGoalScorer.GetPosition();
      }

      const rot: radian = this.goalScoredTimer * 0.0005;
      this.cameraOrientation = Quaternion.FromAngleAxis(0.45 * pi, AXIS_X);
      this.cameraNodeOrientation = Quaternion.FromAngleAxis(rot, AXIS_Z);
      this.cameraNodePosition = targetPos.Add(new Vector3(0, -1, 0).GetRotated2D(rot).Mul(15.0)).Add(new Vector3(0, 0, 3));
      this.cameraFOV = 35.0;

      this.cameraNearCap = 1;
      this.cameraFarCap = 220;

      if (this.goalScoredTimer === 6000) {
        this.pause = true;
        this.sig_OnExtendedReplayMoment.emit(this);
      }
    }
  }

  GetCamera(): Camera {
    return this.camera;
  }

  GetAnims(): AnimCollection {
    return this.anims;
  }

  // THE SPICE

  Get(): void {}

  Process(): void {
    const time_ms = EnvironmentManager.GetInstance().GetTime_ms() - this.gameSequenceInfo.startTime_ms;
    this.timeSincePreviousProcess_ms = time_ms - this.GetPreviousProcessTime_ms();
    this.previousProcessTime_ms = time_ms;

    if (UserEventManager.GetInstance().GetKeyboardState(SDLK_F1)) {
      this.SetRandomSunParams();
      UserEventManager.GetInstance().SetKeyboardState(SDLK_F1, false);
    }

    if (this.gameOver) {
      // todonow: just once ^
      this.sig_OnGameOver.emit(this);
    }

    if (!this.pause) {
      if (this.IsInPlay()) {
        this.CheckBallCollisions(); // todo: should not read geoms during process
      }

      // HIJ IS EEN HONDELUUUL

      this.referee.Process();

      // ball

      this.previousBallPos = this.ball.Predict(0);
      this.ball.Process();

      // create mental images for the AI to use

      const mentalImage = new MentalImage(this);
      mentalImage.TakeSnapshot();
      this.mentalImages.unshift(mentalImage);
      if (this.mentalImages.length > 30) {
        this.mentalImages.pop();
      }

      // obvious

      this.teams[0].UpdateSwitch();
      this.teams[1].UpdateSwitch();
      this.teams[0].Process();
      this.teams[1].Process();
      this.officials.Process();

      this.teams[0].UpdatePossessionStats();
      this.teams[1].UpdatePossessionStats();
      this.CalculateBestPossessionTeamID();

      const ballRetainer = this.GetBallRetainer();
      if (ballRetainer === null) {
        const bestTeamID = this.GetBestPossessionTeamID();
        if (bestTeamID !== -1) {
          const candidate = this.teams[this.GetBestPossessionTeamID()].GetDesignatedTeamPossessionPlayer()!;
          if (candidate !== this.GetDesignatedPossessionPlayer()) {
            const designatedTime = this.GetDesignatedPossessionPlayer().GetTimeNeededToGetToBall_ms();
            const candidateTime = candidate.GetTimeNeededToGetToBall_ms();
            const timeRating = (candidateTime + 10) / (designatedTime + 10);
            if (timeRating < 0.85) this.designatedPossessionPlayer = candidate;
          }
        } else {
          // just stick with current team
          this.designatedPossessionPlayer = this.teams[this.GetDesignatedPossessionPlayer().GetTeamID()].GetDesignatedTeamPossessionPlayer()!;
        }
      } else {
        this.designatedPossessionPlayer = ballRetainer;
      }

      this.CheckHumanoidCollisions(); // todo: should not read geoms during process

      // crowd excitement

      if (this.GetBestPossessionTeamID() !== -1) {
        let cur_excitement: number;
        if (!this.IsGoalScored()) {
          if (this.IsInPlay()) {
            const bestTeam = this.teams[this.GetBestPossessionTeamID()];
            let distance = new Vector3(pitchHalfW * -bestTeam.GetSide(), 0, 0).Sub(this.GetPlayer(bestTeam.GetBestPossessionPlayerID()).GetPosition()).GetLength();
            distance = clamp(distance / 80.0, 0.3, 0.7);
            cur_excitement = 1.0 - distance;
            cur_excitement = Math.pow(cur_excitement, 1.2);
          } else {
            cur_excitement = 0.2;
          }
        } else {
          cur_excitement = 1.0;
        }
        if (cur_excitement > this.excitement) {
          // fast rise
          this.excitement = clamp(this.excitement * 0.98 + cur_excitement * 0.02, 0.0, 1.0);
        } else {
          // slow decay
          this.excitement = clamp(this.excitement * 0.998 + cur_excitement * 0.002, 0.0, 1.0);
        }
        this.crowd01.SetGain(this.excitement * 0.5 * GetConfiguration().GetReal('audio_volume', 0.5));
        this.crowd02.SetGain(clamp((this.excitement - 0.3) * 1.43, 0.0, 1.0) * 0.5 * GetConfiguration().GetReal('audio_volume', 0.5));
      }

      // time

      if (this.IsInPlay() && !this.IsInSetPiece()) {
        // PORT: C++ `matchTime_ms (unsigned long) += 10 * (1.0f / matchDurationFactor)` is evaluated in
        // float and truncated; emulated exactly, since it decides the speed of the match clock
        const increment = Math.fround(10 * Math.fround(1.0 / this.matchDurationFactor));
        this.matchTime_ms = Math.trunc(Math.fround(Math.fround(this.matchTime_ms) + increment));
      }
      this.actualTime_ms += 10;
      if (this.IsGoalScored()) this.goalScoredTimer += 10;
      else this.goalScoredTimer = 0;

      if (this.IsInPlay() && !this.IsInSetPiece()) this.GetMatchData().AddPossessionTime_10ms(this.designatedPossessionPlayer.GetTeamID());

      // check for goals

      const t1goal = this.CheckForGoal(this.teams[0].GetSide());
      const t2goal = this.CheckForGoal(this.teams[1].GetSide());
      if (t1goal) this.ballIsInGoal = true;
      if (t2goal) this.ballIsInGoal = true;
      if (this.IsInPlay()) {
        const matchData = this.matchData;
        if (t1goal) {
          matchData.SetGoalCount(this.teams[1].GetID(), matchData.GetGoalCount(1) + 1);
          this.scoreboard.SetGoalCount(1, matchData.GetGoalCount(1));
          this.goalScored = true;
          this.lastGoalTeamID = this.teams[1].GetID();
          this.teams[1].GetController().UpdateTactics();
        }
        if (t2goal) {
          matchData.SetGoalCount(this.teams[0].GetID(), matchData.GetGoalCount(0) + 1);
          this.scoreboard.SetGoalCount(0, matchData.GetGoalCount(0));
          this.goalScored = true;
          this.lastGoalTeamID = this.teams[0].GetID();
          this.teams[0].GetController().UpdateTactics();
        }
        if (t1goal || t2goal) {
          // find out who scored
          let ownGoal = true;
          if (
            this.GetLastTouchTeamID(e_TouchType.e_TouchType_Intentional_Kicked) === this.GetLastGoalTeamID() ||
            this.GetLastTouchTeamID(e_TouchType.e_TouchType_Intentional_Nonkicked) === this.GetLastGoalTeamID()
          )
            ownGoal = false;

          if (!ownGoal) {
            this.lastGoalScorer = this.teams[this.GetLastGoalTeamID()].GetLastTouchPlayer();
            if (this.lastGoalScorer) {
              this.SpamMessage(
                'GOAL for ' + matchData.GetTeamData(this.GetLastGoalTeamID()).GetName() + '! ' + this.lastGoalScorer.GetPlayerData().GetLastName() + ' scores!',
                4000,
              );
            } else {
              this.SpamMessage('GOAL!!!', 4000);
            }
          } else {
            // own goal
            this.lastGoalScorer = this.teams[Math.abs(this.GetLastGoalTeamID() - 1)].GetLastTouchPlayer();
            if (this.lastGoalScorer) {
              this.SpamMessage('OWN GOAL! ' + this.lastGoalScorer.GetPlayerData().GetLastName() + ' is so unlucky!', 4000);
            } else {
              this.SpamMessage("It's an OWN GOAL! oh noes!", 4000);
            }
          }
        }
      }

      // average possession side

      if (this.IsInPlay()) {
        if (this.GetBestPossessionTeamID() >= 0) {
          let sideValue = 0;
          sideValue += (this.GetTeam(0).GetFadingTeamPossessionAmount() - 0.5) * this.GetTeam(0).GetSide();
          sideValue += (this.GetTeam(1).GetFadingTeamPossessionAmount() - 0.5) * this.GetTeam(1).GetSide();
          this.possessionSideHistory.Insert(sideValue);
        }
      }

      const refereeBuffer = this.GetReferee().GetBuffer();
      if (
        refereeBuffer.active === true &&
        (this.GetReferee().GetCurrentFoulType() === 2 || this.GetReferee().GetCurrentFoulType() === 3) &&
        refereeBuffer.stopTime < this.GetActualTime_ms() - 1000
      ) {
        if (refereeBuffer.prepareTime > this.GetActualTime_ms()) {
          // FOUL, film referee
          this.SetAutoUpdateIngameCamera(false);
          const follow = this.FollowCamera(this.officials.GetReferee().GetPosition().Add(new Vector3(0, 0, 0.8)), 1.5);
          this.cameraOrientation = follow.orientation;
          this.cameraNodeOrientation = follow.nodeOrientation;
          this.cameraNodePosition = follow.position;
          this.cameraFOV = follow.FOV;
          this.cameraNearCap = 1;
          this.cameraFarCap = 220;
          if (this.officials.GetReferee().GetCurrentFunctionType() === e_FunctionType.e_FunctionType_Special) this.referee.AlterSetPiecePrepareTime(this.GetActualTime_ms() + 1000);
        } else {
          // back to normal
          this.SetAutoUpdateIngameCamera(true);
        }
      }
    } // end if !pause

    if (this.autoUpdateIngameCamera) this.UpdateIngameCamera();

    if (!this.pause) {
      const zoomTime = 2000;
      const startTime = 0;
      if (this.actualTime_ms < zoomTime + startTime) {
        // nice effect at the start

        let initialOrientation = Quaternion.IDENTITY;
        initialOrientation = Quaternion.FromAngleAxis(0.0 * pi, AXIS_X);
        const zOrientation = Quaternion.IDENTITY;
        initialOrientation = zOrientation.Mul(initialOrientation);

        const initialPosition = new Vector3(0.0, 0.0, 60.0);

        const subTime = Math.trunc(clamp(this.actualTime_ms - startTime, 0, zoomTime));
        let bias = subTime / zoomTime;
        bias *= pi;
        bias = Math.sin(bias - 0.5 * pi) * -0.5 + 0.5;

        this.cameraOrientation = this.cameraOrientation.GetSlerped(bias, Quaternion.IDENTITY);
        this.cameraNodeOrientation = this.cameraNodeOrientation.GetSlerped(bias, initialOrientation);
        this.cameraNodePosition = this.cameraNodePosition.Mul(1.0 - bias).Add(initialPosition.Mul(bias));
        this.cameraFOV = this.cameraFOV * (1.0 - bias) + 40 * bias;
        this.cameraNearCap = this.cameraNearCap * (1.0 - bias) + 2.0 * bias;
      }
    } // end if !pause

    // tactics debug

    if (this.tacticsDebug && this.actualTime_ms % 1000 === 0) {
      for (let teamID = 0; teamID < 2; teamID++) {
        const tactics = this.matchData.GetTeamData(teamID).GetTactics();
        const userMods = tactics.userProperties.GetProperties();
        let i = 0;
        for (const [, value] of userMods) {
          const userValue = atof(value);
          const autoValue = 0.0;
          this.tacticsDebug.SetValue(i, 0, teamID, userValue);
          this.tacticsDebug.SetValue(i, 1, teamID, autoValue);
          i++;
        }
      }
    }

    this.iterations++;
  }

  PreparePutBuffers(): void {
    this.gameSequenceInfo = GetScheduler().GetTaskSequenceInfo('game');
    const time_ms = EnvironmentManager.GetInstance().GetTime_ms() - this.gameSequenceInfo.startTime_ms;
    this.timeSincePreviousPreparePut_ms = time_ms - this.GetPreviousPreparePutTime_ms();
    this.previousPreparePutTime_ms = time_ms;

    // snapshot time is the time that is 'represented' by the snapshot
    const snapshotTime_ms = this.gameSequenceInfo.timesRan * this.gameSequenceInfo.sequenceTime_ms;

    if (!this.GetPause()) {
      this.ball.PreparePutBuffers(snapshotTime_ms);
      this.teams[0].PreparePutBuffers(snapshotTime_ms);
      this.teams[1].PreparePutBuffers(snapshotTime_ms);
      this.officials.PreparePutBuffers(snapshotTime_ms);
    }

    this.buf_cameraOrientation.SetValue(this.cameraOrientation, snapshotTime_ms);
    this.buf_cameraNodeOrientation.SetValue(this.cameraNodeOrientation, snapshotTime_ms);
    this.buf_cameraNodePosition.SetValue(this.cameraNodePosition, snapshotTime_ms);

    this.buf_cameraFOV.SetValue(this.cameraFOV, snapshotTime_ms);
    this.buf_cameraNearCap = this.cameraNearCap;
    this.buf_cameraFarCap = this.cameraFarCap;

    this.buf_matchTime_ms = this.matchTime_ms;
    this.buf_actualTime_ms = this.actualTime_ms;
  }

  FetchPutBuffers(): void {
    if (this.GetIterations() < 1) return; // no processes done yet

    const time_ms = EnvironmentManager.GetInstance().GetTime_ms() - this.gameSequenceInfo.startTime_ms;
    this.timeSincePreviousPut_ms = time_ms - this.GetPreviousPutTime_ms();
    this.previousPutTime_ms = time_ms;
    const putTime_ms = time_ms;
    this.fetchedbuf_timeDelta = putTime_ms - this.gameSequenceInfo.timesRan * this.gameSequenceInfo.sequenceTime_ms;

    this.fetchedbuf_matchTime_ms = this.buf_matchTime_ms;
    this.fetchedbuf_actualTime_ms = this.buf_actualTime_ms;

    this.fetchedbuf_cameraOrientation = this.buf_cameraOrientation.GetValue(putTime_ms);
    this.fetchedbuf_cameraNodeOrientation = this.buf_cameraNodeOrientation.GetValue(putTime_ms);
    this.fetchedbuf_cameraNodePosition = this.buf_cameraNodePosition.GetValue(putTime_ms);
    this.fetchedbuf_cameraFOV = this.buf_cameraFOV.GetValue(putTime_ms);
    this.fetchedbuf_cameraNearCap = this.buf_cameraNearCap;
    this.fetchedbuf_cameraFarCap = this.buf_cameraFarCap;

    if (!this.GetPause()) {
      this.ball.FetchPutBuffers(putTime_ms);
      this.teams[0].FetchPutBuffers(putTime_ms);
      this.teams[1].FetchPutBuffers(putTime_ms);
      this.officials.FetchPutBuffers(putTime_ms);
    }
  }

  Put(): void {
    if (this.GetIterations() < 2) return; // no processes done yet (todo: this is not the correct way to measure that :p)

    this.camera.SetPosition(new Vector3(0, 0, 0), false);
    this.camera.SetRotation(this.fetchedbuf_cameraOrientation, false);
    this.cameraNode.SetPosition(this.fetchedbuf_cameraNodePosition, false);

    this.cameraNode.SetRotation(this.fetchedbuf_cameraNodeOrientation, false);
    this.camera.SetFOV(this.fetchedbuf_cameraFOV);
    this.camera.SetCapping(this.fetchedbuf_cameraNearCap, this.fetchedbuf_cameraFarCap);

    if (!this.GetPause()) {
      // PORT: the e_DebugMode_AI debug overlay (GetDebugOverlay()) is not ported

      this.ball.Put();
      this.teams[0].Put();
      this.teams[1].Put();
      this.officials.Put();
    } else {
      // pause
      this.ProcessReplayMessages();
    }

    // PORT: GetDynamicNode()->RecursiveUpdateSpatialData() is not needed: derived transforms update lazily

    if (!this.pause) {
      this.teams[0].Put2D();
      this.teams[1].Put2D();

      // clock

      const seconds = Math.trunc(this.fetchedbuf_matchTime_ms / 1000.0) % 60;
      const minutes = Math.trunc(this.fetchedbuf_matchTime_ms / 60000.0);

      let timeStr = '';
      if (minutes < 10) timeStr += '0';
      timeStr += String(minutes);
      timeStr += ':';
      if (seconds < 10) timeStr += '0';
      timeStr += String(seconds);
      this.scoreboard.SetTimeStr(timeStr);

      if (this.messageCaptionRemoveTime_ms <= this.fetchedbuf_actualTime_ms) this.messageCaption.Hide();

      // radar

      this.radar.Put();

      if (this.tacticsDebug) {
        this.tacticsDebug.Redraw();
      }

      this.UpdateGoalNetting(this.GetBall().BallTouchesNet());

      // replay
      this.CaptureReplayFrame(this.fetchedbuf_actualTime_ms + this.fetchedbuf_timeDelta);
    } else {
      this.teams[0].Hide2D();
      this.teams[1].Hide2D();
    }
  }

  GetDynamicNode(): Node {
    return this.dynamicNode;
  }

  ApplyReplayFrame(replayTime_ms: number): void {
    for (let i = 0; i < this.replay.length; i++) {
      const frames = this.replay[i].frames;
      for (let f = 0; f < frames.size(); f++) {
        const frame2 = frames.at(f);
        if (frame2.frameTime_ms >= replayTime_ms) {
          const frame1 = f > 0 ? frames.at(f - 1) : frame2;
          let count = frame2.frameTime_ms - frame1.frameTime_ms;
          const offset = replayTime_ms - frame1.frameTime_ms;
          if (count === 0) count = 1; // never divide by zero, will implode universe
          const bias = offset / count;

          const spatial = this.replay[i].spatial;
          spatial.SetPosition(frame1.position.Mul(1.0 - bias).Add(frame2.position.Mul(bias)), false);
          spatial.SetRotation(frame1.orientation.GetSlerped(bias, frame2.orientation).GetNormalized(), false);
          break;
        }
      }
    }

    const players: Player[] = [];
    this.GetActiveTeamPlayers(0, players);
    this.GetActiveTeamPlayers(1, players);
    for (let i = 0; i < players.length; i++) {
      players[i].UpdateFullbodyNodes();
    }
    const playerOfficials: PlayerBase[] = [];
    this.GetOfficialPlayers(playerOfficials);
    for (let i = 0; i < playerOfficials.length; i++) {
      playerOfficials[i].UpdateFullbodyNodes();
    }

    for (const netFrame of this.replayBallTouchesNetFrames) {
      if (netFrame.frameTime_ms >= replayTime_ms) {
        const ballTouchesNet = netFrame.ballTouchesNet;
        this.UpdateGoalNetting(ballTouchesNet);
        break;
      }
    }
  }

  /** C++ FollowCamera(Quaternion &orientation, Quaternion &nodeOrientation, Vector3 &position, float &FOV, targetPosition, zoom) */
  FollowCamera(targetPosition: Vector3, zoom: number): { orientation: Quaternion; nodeOrientation: Quaternion; position: Vector3; FOV: number } {
    const orientation = Quaternion.FromAngleAxis(0.4 * pi, AXIS_X);
    const nodeOrientation = Quaternion.FromAngleAxis(targetPosition.GetAngle2D() + 1.5 * pi, AXIS_Z);
    const position = targetPosition
      .Sub(targetPosition.Get2D().GetNormalized(new Vector3(0, -1, 0)).Mul(10 * (1.0 / zoom)))
      .Add(new Vector3(0, 0, 3));
    const FOV = 60.0;
    return { orientation, nodeOrientation, position, FOV };
  }

  SetReplayCamera(camType: number, target: Vector3, modifierValue: number): void {
    switch (camType) {
      // default wide view
      case 0: {
        const zoom = 1.0 + modifierValue * 0.5;
        this.cameraFOV = 30 * zoom;
        this.cameraNodePosition = new Vector3(target.coords[0], target.coords[1] - 50.0, 20.0);
        this.cameraOrientation = Quaternion.FromAngleAxis(0.37 * pi, AXIS_X);
        this.cameraNodeOrientation = Quaternion.IDENTITY;
        this.cameraNearCap = 20.0;
        this.cameraFarCap = 250.0;
        break;
      }

      // behind goal
      case 1: {
        let side = -1;
        if (target.coords[0] > 0) side = 1;
        const zoom = 1.0 + modifierValue * 0.5;
        this.cameraNodePosition = new Vector3(70 * side, -30, 20);
        const targetDist = clamp(this.cameraNodePosition.Sub(target).GetLength() / 100.0, 0.2, 1.0);
        this.cameraFOV = (56 - targetDist * 50) * zoom;
        this.cameraOrientation = Quaternion.FromAngleAxis((0.3 + targetDist * 0.15) * pi, AXIS_X);
        this.cameraNodeOrientation = Quaternion.FromAngleAxis(target.Sub(this.cameraNodePosition).GetAngle2D() + 1.5 * pi, AXIS_Z);
        this.cameraNearCap = 20.0;
        this.cameraFarCap = 250.0;
        break;
      }

      // close, rotateable
      case 2: {
        const rot: radian = modifierValue * pi;
        this.cameraNodePosition = target.Add(new Vector3(Math.sin(rot), Math.cos(rot), 0.18).Mul(10));
        this.cameraFOV = 30;
        this.cameraOrientation = Quaternion.FromAngleAxis(0.45 * pi, AXIS_X);
        this.cameraNodeOrientation = Quaternion.FromAngleAxis(target.Sub(this.cameraNodePosition).GetAngle2D() + 1.5 * pi, AXIS_Z);
        this.cameraNearCap = 1.0;
        this.cameraFarCap = 250.0;
        break;
      }

      // birds-eye
      case 3: {
        this.cameraNodePosition = target.Add(new Vector3(0, 0, 40 + modifierValue * 20));
        this.cameraFOV = 30;
        this.cameraOrientation = Quaternion.IDENTITY;
        this.cameraNodeOrientation = Quaternion.IDENTITY;
        this.cameraNearCap = 10.0;
        this.cameraFarCap = 100.0;
        break;
      }

      default:
        break;
    }
  }

  SetAutoUpdateIngameCamera(autoUpdate = true): void {
    if (autoUpdate !== this.autoUpdateIngameCamera) {
      this.camPos = [];
      this.autoUpdateIngameCamera = autoUpdate;
    }
  }

  GetReplaySize_ms(): number {
    return replaySize_ms;
  }

  GetReplayCamCount(): number {
    return 4;
  }

  ProcessReplayMessages(): void {
    if (this.replayState.dirty) {
      this.ApplyReplayFrame(this.replayState.viewTime_ms);
      const replayTarget = this.GetBall().GetBallGeom().GetDerivedPosition();
      this.SetReplayCamera(this.replayState.cam, replayTarget, this.replayState.modifierValue);
      this.replayState.dirty = false;
    }
  }

  GetMatchData(): MatchData {
    return this.matchData;
  }

  GetMatchDurationFactor(): number {
    return this.matchDurationFactor;
  }

  GetMatchDifficulty(): number {
    return this.matchDifficulty;
  }

  GetAnimPositionCache(anim: Animation): Vector3[] {
    return this.animPositionCache.get(anim)!;
  }

  UploadGoalNetting(): void {
    if (this.nettingHasChanged) {
      (this.goalsNode.GetObject('goals') as Geometry).OnUpdateGeometryData(false);
    }
  }

  /** always around 10ms, not a very useful function, probably */
  GetPreviousProcessTime_ms(): number {
    return this.previousProcessTime_ms;
  }

  GetPreviousPreparePutTime_ms(): number {
    return this.previousPreparePutTime_ms;
  }

  GetPreviousPutTime_ms(): number {
    return this.previousPutTime_ms;
  }

  GetTimeSincePreviousProcess_ms(): number {
    return this.timeSincePreviousProcess_ms;
  }

  GetTimeSincePreviousPreparePut_ms(): number {
    return this.timeSincePreviousPreparePut_ms;
  }

  GetTimeSincePreviousPut_ms(): number {
    return this.timeSincePreviousPut_ms;
  }

  protected GetReplaySpatials(spatials: Spatial[]): void {
    spatials.push(this.teams[0].GetSceneNode());
    GetSpatials(this.teams[0].GetSceneNode(), spatials);
    spatials.push(this.teams[1].GetSceneNode());
    GetSpatials(this.teams[1].GetSceneNode(), spatials);
    spatials.push(this.ball.GetBallGeom());
    spatials.push(GetGreenDebugPilon());
    spatials.push(GetBlueDebugPilon());
    spatials.push(GetYellowDebugPilon());
    spatials.push(GetRedDebugPilon());
    spatials.push(GetSmallDebugCircle1());
    spatials.push(GetSmallDebugCircle2());
    spatials.push(GetLargeDebugCircle());
    spatials.push(this.officials.GetYellowCardGeom());
    spatials.push(this.officials.GetRedCardGeom());

    const players: Player[] = [];
    this.GetActiveTeamPlayers(0, players);
    this.GetActiveTeamPlayers(1, players);
    for (let i = 0; i < players.length; i++) {
      spatials.push(players[i].GetHumanoidNode());
      GetSpatials(players[i].GetHumanoidNode(), spatials);
    }
    const playerOfficials: PlayerBase[] = [];
    this.GetOfficialPlayers(playerOfficials);
    for (let i = 0; i < playerOfficials.length; i++) {
      spatials.push(playerOfficials[i].GetHumanoidNode());
      GetSpatials(playerOfficials[i].GetHumanoidNode(), spatials);
    }
  }

  protected CaptureReplayFrame(replayTime_ms: number): void {
    for (let i = 0; i < this.replay.length; i++) {
      const frame = new ReplaySpatialFrame();
      frame.frameTime_ms = replayTime_ms;
      frame.position = this.replay[i].spatial.GetPosition();
      frame.orientation = this.replay[i].spatial.GetRotation();
      this.replay[i].frames.push_back(frame);
    }

    const ballTouchesNetFrame = new ReplayBallTouchesNetFrame();
    ballTouchesNetFrame.frameTime_ms = replayTime_ms;
    ballTouchesNetFrame.ballTouchesNet = this.GetBall().BallTouchesNet();
    this.replayBallTouchesNetFrames.push_back(ballTouchesNetFrame);
  }

  protected CheckForGoal(side: number): boolean {
    if (Math.abs(this.ball.Predict(10).coords[0]) < pitchHalfW - 1.0) return false;

    const line = new Line();
    line.SetVertex(0, this.previousBallPos);
    line.SetVertex(1, this.ball.Predict(0));

    const goalLineX = (pitchHalfW + lineHalfW + 0.11) * side;
    const goal1 = new Triangle();
    goal1.SetVertex(0, new Vector3(goalLineX, 3.7, 0));
    goal1.SetVertex(1, new Vector3(goalLineX, -3.7, 0));
    goal1.SetVertex(2, new Vector3(goalLineX, 3.7, 2.5));
    goal1.SetNormals(new Vector3(-side, 0, 0));
    const goal2 = new Triangle();
    goal2.SetVertex(0, new Vector3(goalLineX, -3.7, 0));
    goal2.SetVertex(1, new Vector3(goalLineX, -3.7, 2.5));
    goal2.SetVertex(2, new Vector3(goalLineX, 3.7, 2.5));
    goal2.SetNormals(new Vector3(-side, 0, 0));

    let intersect = goal1.IntersectsLine(line) !== null;
    if (!intersect) {
      intersect = goal2.IntersectsLine(line) !== null;
    }

    // extra check: ball could have gone 'in' via the side netting, if line begin == inside pitch, but outside of post, and line end == in goal. disallow!
    if (Math.abs(this.previousBallPos.coords[1]) > 3.7 && Math.abs(this.previousBallPos.coords[0]) > pitchHalfW - lineHalfW - 0.11) return false;

    if (intersect) return true;
    else return false;
  }

  protected CalculateBestPossessionTeamID(): void {
    const ballRetainer = this.GetBallRetainer();
    if (ballRetainer !== null) {
      const retainTeamID = ballRetainer.GetTeamID();
      this.bestPossessionTeamID = retainTeamID;
    } else {
      const bestTime_ms = [100000, 100000];
      for (let teamID = 0; teamID < 2; teamID++) {
        bestTime_ms[teamID] = this.teams[teamID].GetTimeNeededToGetToBall_ms();
      }

      if (bestTime_ms[0] < bestTime_ms[1]) this.bestPossessionTeamID = 0;
      else if (bestTime_ms[0] > bestTime_ms[1]) this.bestPossessionTeamID = 1;
      else if (bestTime_ms[0] === bestTime_ms[1]) this.bestPossessionTeamID = -1;
    }
  }

  protected CheckHumanoidCollisions(): void {
    const players: Player[] = [];

    this.GetTeam(0).GetActivePlayers(players);
    this.GetTeam(1).GetActivePlayers(players);

    // outer vectors index == players[] index
    const playerBounces: PlayerBounce[][] = [];

    // insert an empty entry for every player
    for (let i1 = 0; i1 < players.length; i1++) {
      playerBounces.push([]);
    }

    // check each combination of humanoids once
    for (let i1 = 0; i1 < players.length - 1; i1++) {
      for (let i2 = i1 + 1; i2 < players.length; i2++) {
        this.CheckHumanoidCollision(players[i1], players[i2], playerBounces[i1], playerBounces[i2]);
      }
    }

    // do bouncy magic
    for (let i1 = 0; i1 < players.length; i1++) {
      let totalForce = 0.0;

      for (let i2 = 0; i2 < playerBounces[i1].length; i2++) {
        const bounce = playerBounces[i1][i2];
        totalForce += bounce.force;
      }

      if (totalForce > 0.0) {
        let bounceVec = new Vector3(0);
        const movement = players[i1].GetMovement();
        for (let i2 = 0; i2 < playerBounces[i1].length; i2++) {
          const bounce = playerBounces[i1][i2];
          bounceVec = bounceVec.Add(bounce.opp.GetMovement().Sub(movement).Mul(bounce.force * (bounce.force / totalForce)));
        }

        // okay, accumulated all, now distribute them in normalized fashion
        players[i1].OffsetPosition(bounceVec.Mul(0.01 * 1.0));
      }
    }
  }

  protected CheckHumanoidCollision(p1: Player, p2: Player, p1Bounce: PlayerBounce[], p2Bounce: PlayerBounce[]): void {
    const distanceFactor = 0.72;
    const bouncePlayerRadius = 0.5 * distanceFactor;
    const similarPlayerRadius = 0.8 * distanceFactor;
    const similarExp = 0.2; //0.8f;
    const similarForceFactor = 0.25; // 0.5f would be the full effect

    const p1pos = p1.GetPosition();
    const p2pos = p2.GetPosition();

    const distance = p1pos.Sub(p2pos).GetLength();

    const p1movement = p1.GetMovement();
    const p2movement = p2.GetMovement();
    assert(p1movement.coords[2] === 0.0);
    assert(p2movement.coords[2] === 0.0);

    let bounceBias = 0.0;
    let bounceVec = new Vector3(0);
    let p1backFacing = 0.5;
    let p2backFacing = 0.5;

    if (distance < bouncePlayerRadius * 2.0 || distance < (bouncePlayerRadius + similarPlayerRadius) * 2.0) {
      bounceVec = p1pos.Sub(p2pos).GetNormalized(new Vector3(0, -1, 0));

      // back facing
      const p1facing = p1.GetDirectionVec().GetRotated2D(p1.GetRelBodyAngle() * 0.7);
      const p2facing = p2.GetDirectionVec().GetRotated2D(p2.GetRelBodyAngle() * 0.7);
      p1backFacing = clamp(p1facing.GetDotProduct(bounceVec) * 0.5 + 0.5, 0.0, 1.0); // 0 .. 1 == worst .. best
      p2backFacing = clamp(p2facing.GetDotProduct(bounceVec.Neg()) * 0.5 + 0.5, 0.0, 1.0);

      if (distance < bouncePlayerRadius * 2.0) {
        bounceBias += p1backFacing * 0.8;
        bounceBias -= p2backFacing * 0.8;

        // velocity, faster is worse
        const p1velocity = p1.GetFloatVelocity();
        const p2velocity = p2.GetFloatVelocity();
        bounceBias -= clamp(((p1velocity - p2velocity) / sprintVelocity) * 0.2, -0.2, 0.2);

        if (p1.TouchPending() && p1.GetCurrentFunctionType() === e_FunctionType.e_FunctionType_Interfere) bounceBias += 0.1 + 0.4 * p1.GetStat('technical_standingtackle');
        if (p1.TouchPending() && p1.GetCurrentFunctionType() === e_FunctionType.e_FunctionType_Sliding) bounceBias += 0.1 + 0.4 * p1.GetStat('technical_slidingtackle');
        if (p2.TouchPending() && p2.GetCurrentFunctionType() === e_FunctionType.e_FunctionType_Interfere) bounceBias -= 0.1 + 0.4 * p2.GetStat('technical_standingtackle');
        if (p2.TouchPending() && p2.GetCurrentFunctionType() === e_FunctionType.e_FunctionType_Sliding) bounceBias -= 0.1 + 0.4 * p2.GetStat('technical_slidingtackle');

        // problem is, once possession is lost (usually directly after ball is touched), bias may turn around the other way. (well, maybe that's not a problem. dunno.)

        if (p1 === this.GetDesignatedPossessionPlayer()) bounceBias += 0.4;
        if (p2 === this.GetDesignatedPossessionPlayer()) bounceBias -= 0.4;

        // closest to ball
        if (p1 === p1.GetTeam().GetDesignatedTeamPossessionPlayer() && p2 === p2.GetTeam().GetDesignatedTeamPossessionPlayer()) {
          const p1BallDistance = this.GetBall().Predict(10).Get2D().Sub(p1.GetPosition()).GetLength();
          const p2BallDistance = this.GetBall().Predict(10).Get2D().Sub(p2.GetPosition()).GetLength();
          const ballDistanceDiffFactor = clamp(Math.min(p2BallDistance, 1.2) - Math.min(p1BallDistance, 1.2), -0.6, 0.6) * 1.0; // std::min is cap so difference won't matter if ball is far away (so only used in battles about the ball)
          bounceBias += ballDistanceDiffFactor;
        }

        bounceBias += p1.GetStat('physical_balance') * 1.0;
        bounceBias -= p2.GetStat('physical_balance') * 1.0;

        bounceBias = clamp(bounceBias, -1.0, 1.0);
        bounceBias *= 0.5;

        // convert bounceBias to 0 .. 1 instead of -1 .. 1
        const bounceBias0to1 = bounceBias * 0.5 + 0.5;

        let offset1 = p1pos.Sub(p2pos).GetNormalized(0).Mul((bouncePlayerRadius - distance * 0.5) * (1.0 - bounceBias0to1) * 2.0);
        let offset2 = p2pos.Sub(p1pos).GetNormalized(0).Mul((bouncePlayerRadius - distance * 0.5) * bounceBias0to1 * 2.0);

        // make players snap to the side of opponents (rather, just a bit in front of them too)
        // todo: make less binary, and more based on stats. maybe make this whole push/pull thing a separate system?

        if (this.GetDesignatedPossessionPlayer() === p2 && p2.HasPossession()) {
          const p2_leftside = p2pos.Add(p2.GetDirectionVec().GetRotated2D(0.3 * pi).Mul(bouncePlayerRadius * 2));
          const p2_rightside = p2pos.Add(p2.GetDirectionVec().GetRotated2D(-0.3 * pi).Mul(bouncePlayerRadius * 2));
          const p1_to_p2_left = p1pos.Sub(p2_leftside).GetLength();
          const p1_to_p2_right = p1pos.Sub(p2_rightside).GetLength();
          const p2side = p1_to_p2_left < p1_to_p2_right ? p2_leftside : p2_rightside;
          offset1 = offset1.Add(p2side.Sub(p1pos).GetNormalizedMax(0.01).Mul(p1.GetStat('physical_balance') * 0.3));
        } else if (this.GetDesignatedPossessionPlayer() === p1 && p1.HasPossession()) {
          const p1_leftside = p1pos.Add(p1.GetDirectionVec().GetRotated2D(0.3 * pi).Mul(bouncePlayerRadius * 2));
          const p1_rightside = p1pos.Add(p1.GetDirectionVec().GetRotated2D(-0.3 * pi).Mul(bouncePlayerRadius * 2));
          const p2_to_p1_left = p2pos.Sub(p1_leftside).GetLength();
          const p2_to_p1_right = p2pos.Sub(p1_rightside).GetLength();
          const p1side = p2_to_p1_left < p2_to_p1_right ? p1_leftside : p1_rightside;
          offset2 = offset2.Add(p1side.Sub(p2pos).GetNormalizedMax(0.01).Mul(p2.GetStat('physical_balance') * 0.3));
        }

        // can not bump faster than sprint
        offset1 = offset1.GetNormalizedMax(sprintVelocity * 0.01);
        offset2 = offset2.GetNormalizedMax(sprintVelocity * 0.01);

        p1.OffsetPosition(offset1);
        p2.OffsetPosition(offset2);
      }

      // take over each others movement a bit (precalc phase)

      let similarBias = 0.0;

      if (similarForceFactor > 0.0 && distance < (bouncePlayerRadius + similarPlayerRadius) * 2.0) {
        const shellDistance = Math.max(0.0, distance - bouncePlayerRadius * 2.0);

        similarBias += p1backFacing * 0.8;
        similarBias -= p2backFacing * 0.8;

        // velocity, faster is worse
        const p1velocity = p1.GetFloatVelocity();
        const p2velocity = p2.GetFloatVelocity();
        similarBias -= clamp(((p1velocity - p2velocity) / sprintVelocity) * 0.2, -0.2, 0.2);

        if (p1 === this.GetDesignatedPossessionPlayer()) similarBias += 0.6;
        if (p2 === this.GetDesignatedPossessionPlayer()) similarBias -= 0.6;

        // closest to ball
        if (p1 === p1.GetTeam().GetDesignatedTeamPossessionPlayer() && p2 === p2.GetTeam().GetDesignatedTeamPossessionPlayer()) {
          const p1BallDistance = this.GetBall().Predict(10).Get2D().Sub(p1.GetPosition()).GetLength();
          const p2BallDistance = this.GetBall().Predict(10).Get2D().Sub(p2.GetPosition()).GetLength();
          const ballDistanceDiffFactor = clamp(Math.min(p2BallDistance, 1.2) - Math.min(p1BallDistance, 1.2), -0.6, 0.6) * 1.0; // std::min is cap so difference won't matter if ball is far away (so only used in battles about the ball)
          similarBias += ballDistanceDiffFactor;
        }

        similarBias += p1.GetStat('physical_balance') * 1.0;
        similarBias -= p2.GetStat('physical_balance') * 1.0;

        similarBias = clamp(similarBias, -1.0, 1.0);
        similarBias *= 0.9;

        let similarForce = clamp(1.0 - shellDistance / (similarPlayerRadius * 2.0), 0.0, 1.0);
        similarForce = Math.pow(similarForce, similarExp);
        similarForce *= similarForceFactor;

        assert(similarForce >= 0.0 && similarForce <= 1.0);

        const similarBias0to1 = similarBias * 0.5 + 0.5;

        p1Bounce.push(new PlayerBounce(p2, similarForce * (1.0 - similarBias0to1)));
        p2Bounce.push(new PlayerBounce(p1, similarForce * similarBias0to1));
      }

      // u b trippin?

      if (distance < bouncePlayerRadius * 2.0) {
        let p1sensitivity = 0.0;
        let p2sensitivity = 0.0;

        p1sensitivity += (1.0 - p1backFacing) * 1.0;
        p2sensitivity += (1.0 - p2backFacing) * 1.0;

        // velocity, faster is worse
        const p1velocity = p1.GetFloatVelocity();
        const p2velocity = p2.GetFloatVelocity();
        p1sensitivity += NormalizedClamp(p1velocity, idleVelocity, sprintVelocity) * 1.0;
        p2sensitivity += NormalizedClamp(p2velocity, idleVelocity, sprintVelocity) * 1.0;

        if (p1.HasBestPossession() === true) p1sensitivity += 1.0;
        if (p2.HasBestPossession() === true) p2sensitivity += 1.0;

        const balanceWeight = 3.0;
        p1sensitivity += (1.0 - p1.GetStat('physical_balance') * 1.0) * balanceWeight;
        p2sensitivity += (1.0 - p2.GetStat('physical_balance') * 1.0) * balanceWeight;

        p1sensitivity += clamp(p1.GetDecayingPositionOffsetLength() * 10.0, 0.0, 1.0);
        p2sensitivity += clamp(p2.GetDecayingPositionOffsetLength() * 10.0, 0.0, 1.0);

        // penetration
        const penetrationWeight = 6.0;
        const penetration = p1
          .GetPosition()
          .Add(p1.GetMovement().Mul(0.03))
          .Sub(p2.GetPosition().Add(p2.GetMovement().Mul(0.03)))
          .GetLength();
        p1sensitivity += Math.pow(1.0 - NormalizedClamp(penetration, 0.0, bouncePlayerRadius * 2.0), 0.4) * penetrationWeight;
        p2sensitivity += Math.pow(1.0 - NormalizedClamp(penetration, 0.0, bouncePlayerRadius * 2.0), 0.4) * penetrationWeight;

        // ball proximity (usually means: stability is less because we sacrifice balance to control the ball)
        const p1BallDistance = this.GetBall().Predict(10).Get2D().Sub(p1.GetPosition()).GetLength();
        const p2BallDistance = this.GetBall().Predict(10).Get2D().Sub(p2.GetPosition()).GetLength();
        p1sensitivity += 1.0 - NormalizedClamp(p1BallDistance, 0.0, 0.7);
        p2sensitivity += 1.0 - NormalizedClamp(p2BallDistance, 0.0, 0.7);

        // divided by elements active
        p1sensitivity /= 5.0 + balanceWeight + penetrationWeight;
        p2sensitivity /= 5.0 + balanceWeight + penetrationWeight;

        const trip0threshold = 0.38;
        const trip1threshold = 0.48;
        const trip2threshold = 0.58;

        if (p1sensitivity > trip0threshold) {
          let tripType = 0;
          if (p1sensitivity > trip1threshold) tripType = 1;
          if (p1sensitivity > trip2threshold) tripType = 2;
          if (tripType > 0) {
            p1.TripMe(p1.GetMovement().Mul(0.1).Add(p2.GetMovement().Mul(0.06)).Add(bounceVec.Mul(1.0)).GetNormalized(bounceVec), tripType);
            this.referee.TripNotice(p1, p2, tripType);
          }
        }
        if (p2sensitivity > trip0threshold) {
          let tripType = 0;
          if (p2sensitivity > trip1threshold) tripType = 1;
          if (p2sensitivity > trip2threshold) tripType = 2;
          if (tripType > 0) {
            p2.TripMe(p2.GetMovement().Mul(0.1).Add(p1.GetMovement().Mul(0.06)).Sub(bounceVec.Mul(1.0)).GetNormalized(bounceVec.Neg()), tripType);
            this.referee.TripNotice(p2, p1, tripType);
          }
        }
      } // within either bump, similar or trip range
    }

    // check for tackling collisions

    let tackle = 0;
    if (
      (p1.GetCurrentFunctionType() === e_FunctionType.e_FunctionType_Sliding || p1.GetCurrentFunctionType() === e_FunctionType.e_FunctionType_Interfere) &&
      p1.GetFrameNum() > 5 &&
      p1.GetFrameNum() < 28
    )
      tackle += 1;
    if (
      (p2.GetCurrentFunctionType() === e_FunctionType.e_FunctionType_Sliding || p2.GetCurrentFunctionType() === e_FunctionType.e_FunctionType_Interfere) &&
      p2.GetFrameNum() > 5 &&
      p2.GetFrameNum() < 28
    )
      tackle += 2;
    if (distance < 2.0 && tackle > 0 && tackle < 3) {
      // if tackle is 3, ignore both
      const tacklerObjectList: Geometry[] = [];
      const victimObjectList: Geometry[] = [];
      if (tackle === 1) {
        p1.GetHumanoidNode().GetObjects<Geometry>(e_ObjectType.e_ObjectType_Geometry, tacklerObjectList);
        p2.GetHumanoidNode().GetObjects<Geometry>(e_ObjectType.e_ObjectType_Geometry, victimObjectList);
      }
      if (tackle === 2) {
        p2.GetHumanoidNode().GetObjects<Geometry>(e_ObjectType.e_ObjectType_Geometry, tacklerObjectList);
        p1.GetHumanoidNode().GetObjects<Geometry>(e_ObjectType.e_ObjectType_Geometry, victimObjectList);
      }

      // iterate through all body parts of tackler
      for (const tacklerObject of tacklerObjectList) {
        const objAABB: AABB = tacklerObject.GetAABB();

        // make a tad smaller: AABBs are usually too large.
        objAABB.minxyz = objAABB.minxyz.Add(0.1);
        objAABB.maxxyz = objAABB.maxxyz.Sub(0.1);

        for (const victimObject of victimObjectList) {
          const bodyPartName = victimObject.GetName();
          if (bodyPartName === 'left_foot' || bodyPartName === 'right_foot' || bodyPartName === 'left_lowerleg' || bodyPartName === 'right_lowerleg') {
            if (objAABB.Intersects(victimObject.GetAABB())) {
              if (tackle === 1) {
                if (p1.GetFrameNum() > 10 && p1.GetFrameNum() < p1.GetFrameCount() - 6) {
                  const tripVec = p2.GetDirectionVec();
                  let tripType = 3; // sliding
                  if (p1.GetCurrentFunctionType() === e_FunctionType.e_FunctionType_Interfere) tripType = 1; // was 2
                  p2.TripMe(tripVec, tripType);
                  this.referee.TripNotice(p2, p1, tripType);
                }
              }
              if (tackle === 2) {
                if (p2.GetFrameNum() > 10 && p2.GetFrameNum() < p2.GetFrameCount() - 6) {
                  const tripVec = p1.GetDirectionVec();
                  let tripType = 3; // sliding
                  if (p2.GetCurrentFunctionType() === e_FunctionType.e_FunctionType_Interfere) tripType = 1; // was 2
                  p1.TripMe(tripVec, tripType);
                  this.referee.TripNotice(p1, p2, tripType);
                }
              }
              break;
            }
          }
        }
      }
    }
  }

  protected CheckBallCollisions(): void {
    // todo: rewrite this function, this SHIT is UNREADABLE!!!111 olololololo

    if (this.actualTime_ms <= this.lastBodyBallCollisionTime_ms + 150) return;

    const players: Player[] = [];
    this.GetTeam(0).GetActivePlayers(players);
    this.GetTeam(1).GetActivePlayers(players);

    // NOTE: like in the C++, this list is not cleared per player, so body parts of earlier (close) players are checked again for later ones
    const objectList: Geometry[] = [];
    let bounceVec = new Vector3(0);
    let bias = 0.0;
    let bounceCount = 0; // this shit is shit, average properly in combination with bias or something like that

    const ball = this.ball;

    for (let i = 0; i < players.length; i++) {
      const player = players[i];
      const teamID = player.GetTeam().GetID();

      const touchTimeThreshold_ms = 200; //700;
      const oppLastTouchBias = this.GetTeam(Math.abs(teamID - 1)).GetLastTouchBias(touchTimeThreshold_ms);
      const lastTouchBias = player.GetLastTouchBias(touchTimeThreshold_ms);

      if (lastTouchBias <= 0.01 && oppLastTouchBias > 0.01) {
        // cannot collide if opp didn't recently touch ball (we would be able to predict ball by then), or if player itself already did (to overcome the 'perpetuum collision' problem, and to allow for 'controlled ball collisions' in humanoid class)

        const functionType = player.GetCurrentFunctionType();
        let collisionAnim = false;
        if (
          functionType === e_FunctionType.e_FunctionType_Movement ||
          functionType === e_FunctionType.e_FunctionType_Trip ||
          functionType === e_FunctionType.e_FunctionType_Sliding ||
          functionType === e_FunctionType.e_FunctionType_Interfere ||
          functionType === e_FunctionType.e_FunctionType_Deflect
        )
          collisionAnim = true;
        let onlyWhenDirectionChangedUnexpectedly = false;
        if (functionType === e_FunctionType.e_FunctionType_Interfere || functionType === e_FunctionType.e_FunctionType_Deflect) onlyWhenDirectionChangedUnexpectedly = true;

        let directionChangedUnexpectedly = false;
        if (onlyWhenDirectionChangedUnexpectedly) {
          const unexpectedDistance = this.GetMentalImage(player.GetController()!.GetReactionTime_ms() + player.GetFrameNum() * 10)
            .GetBallPrediction(1000)
            .Sub(this.GetBall().Predict(1000))
            .GetLength(); // mental image from when the anim began
          if (unexpectedDistance > 0.5) directionChangedUnexpectedly = true;
        }

        if (collisionAnim && !player.HasUniquePossession() && onlyWhenDirectionChangedUnexpectedly === directionChangedUnexpectedly) {
          let boundingBoxSizeOffset = -0.1; // fake a big AABB for more blocking fun, or a small one for less bouncy bounce
          if (!player.HasPossession()) boundingBoxSizeOffset += 0.03;
          else boundingBoxSizeOffset -= 0.03;

          if (functionType === e_FunctionType.e_FunctionType_Sliding || functionType === e_FunctionType.e_FunctionType_Interfere) {
            boundingBoxSizeOffset += 0.1;
          }
          if (functionType === e_FunctionType.e_FunctionType_Deflect) {
            boundingBoxSizeOffset += 0.2;
          }

          if (player.GetPosition().Add(new Vector3(0, 0, 0.8)).Sub(ball.Predict(0)).GetLength() < 2.5) {
            // premature optimization is the root of all evil :D
            player.GetHumanoidNode().GetObjects<Geometry>(e_ObjectType.e_ObjectType_Geometry, objectList);

            for (const object of objectList) {
              const objAABB = object.GetAABB();
              const ballRadius = 0.11 + boundingBoxSizeOffset;
              if (objAABB.IntersectsSphere(ball.Predict(0), ballRadius)) {
                if (player === player.GetTeam().GetDesignatedTeamPossessionPlayer() && this.GetLastTouchBias(200) < 0.01) {
                  // todo: use reaction time stat

                  player.TriggerControlledBallCollision();
                } else {
                  // todonow: average bouncevec and bias together per hit
                  const movementBias = oppLastTouchBias * 0.8 + 0.2;
                  bounceVec = bounceVec.Add(
                    ball
                      .Predict(0)
                      .Sub(object.GetDerivedPosition())
                      .GetNormalized(new Vector3(0))
                      .Mul(movementBias)
                      .Add(player.GetMovement().Mul(1.0 - movementBias)),
                  );
                  bounceCount++;
                  player.GetTeam().SetLastTouchPlayer(player, e_TouchType.e_TouchType_Accidental);
                  const aabbCenter = objAABB.GetCenter();
                  bias += (1.0 - clamp((ball.Predict(0).Sub(aabbCenter).GetLength() - ballRadius) / objAABB.GetRadius(), 0.0, 1.0)) * 0.9 + 0.1;
                }
              }
            }
          }
        }
      }
    }

    if (bias > 0.0) {
      bounceVec = bounceVec.Div(bounceCount * 1.0);
      bounceVec = bounceVec.WithCoord(2, bounceVec.coords[2] * 0.6);
      bounceVec = bounceVec.GetNormalized();
      const currentMovement = ball.GetMovement();
      const fullCollisionVec = bounceVec.Mul(6.0).Add(bounceVec.Mul(currentMovement.GetLength() * 0.6)).Add(currentMovement.Mul(-0.2));
      bias = clamp(bias, 0.0, 1.0);
      bias = bias * 0.5 + 0.5;
      let resultVector = fullCollisionVec.Mul(bias).Add(currentMovement.Mul(1.0 - bias));
      if (resultVector.GetLength() > currentMovement.GetLength()) resultVector = resultVector.GetNormalized(0).Mul(currentMovement.GetLength());
      resultVector = resultVector.Mul(0.7);

      ball.Touch(resultVector);
      ball.SetRotation(random(-30, 30), random(-30, 30), random(-30, 30), 0.5 * bias);
      ball.TriggerBallTouchSound(Math.pow(NormalizedClamp(resultVector.GetLength(), 4.0, 40.0), 0.7));

      this.lastBodyBallCollisionTime_ms = this.actualTime_ms;
    }
  }

  protected PrepareGoalNetting(): void {
    // collect vertices into nettingMeshes[0..1]
    const triangleMesh = (this.goalsNode.GetObject('goals') as Geometry).GetGeometryData().GetResource().GetTriangleMeshesRef();

    for (let m = 0; m < triangleMesh.length; m++) {
      const vertices = triangleMesh[m].vertices;
      const positionFloats = triangleMesh[m].verticesDataSize / GetTriangleMeshElementCount();
      for (let i = 0; i < positionFloats; i += 3) {
        let goalID = -1;
        if (vertices[i + 0] < -pitchHalfW - 0.06) goalID = 0; // don't catch woodwork, only netting.. DIRTY HAXX
        if (vertices[i + 0] > pitchHalfW + 0.06) goalID = 1;
        if (goalID >= 0) {
          this.nettingMeshesSrc[goalID].push(new Vector3(vertices[i + 0], vertices[i + 1], vertices[i + 2]));
          this.nettingMeshes[goalID].push({ vertices, index: i });
        }
      }
    }
  }

  protected UpdateGoalNetting(ballTouchesNet = false): void {
    this.nettingHasChanged = false;
    const ballPosition = this.ball.GetBallGeom().GetPosition();
    const sideID = ballPosition.coords[0] < 0 ? 0 : 1;
    if (ballTouchesNet) {
      // find vertex closest to ball
      let shortestDistance = 100000.0;
      for (let i = 0; i < this.nettingMeshes[sideID].length; i++) {
        const vertex = this.nettingMeshesSrc[sideID][i];
        const distance = vertex.GetDistance(ballPosition);
        if (distance < shortestDistance) {
          shortestDistance = distance;
        }
      }

      // net is stuck to woodwork so lay off there
      const woodworkTensionBiasInv = clamp((Math.abs(ballPosition.coords[0]) - pitchHalfW) * 2.0, 0.0, 1.0);

      // pull vertices towards ball - the closer, the more intense
      for (let i = 0; i < this.nettingMeshes[sideID].length; i++) {
        const vertex = this.nettingMeshesSrc[sideID][i];
        let influenceBias = Math.pow(clamp((shortestDistance + 0.0001) / (vertex.GetDistance(ballPosition) + 0.0001), 0.0, 1.0), 1.5);
        influenceBias *= woodworkTensionBiasInv;
        // http://www.wolframalpha.com/input/?i=sin%28x+*+pi+-+0.5+*+pi%29+*+0.5+%2B+0.5+from+x+%3D+0+to+1
        influenceBias = Math.sin(influenceBias * pi - 0.5 * pi) * 0.5 + 0.5;
        if (influenceBias > 0.0) {
          const result = vertex.Mul(1.0 - influenceBias).Add(ballPosition.Mul(influenceBias));
          const ref = this.nettingMeshes[sideID][i];
          ref.vertices[ref.index + 0] = result.coords[0];
          ref.vertices[ref.index + 1] = result.coords[1];
          ref.vertices[ref.index + 2] = result.coords[2];
        }
      }
      this.resetNetting = true; // make sure to reset next time
      this.nettingHasChanged = true;
    } else if (this.resetNetting) {
      // ball doesn't touch net (anymore), reset
      for (let side = 0; side < 2; side++) {
        for (let i = 0; i < this.nettingMeshes[side].length; i++) {
          const ref = this.nettingMeshes[side][i];
          ref.vertices[ref.index + 0] = this.nettingMeshesSrc[side][i].coords[0];
          ref.vertices[ref.index + 1] = this.nettingMeshesSrc[side][i].coords[1];
          ref.vertices[ref.index + 2] = this.nettingMeshesSrc[side][i].coords[2];
        }
      }
      this.resetNetting = false;
      this.nettingHasChanged = true;
    }
  }
}
