// Port of legacy/src/onthepitch/team.{hpp,cpp}. Original: written by bastiaan konings schuiling 2008 - 2015 (public domain / Apache-2.0).
//
// CAREER: SetLockedHumanPlayer()/GetLockedHumanPlayer() lock the (first) human gamer of this team onto one player
// ("be a pro"): while that player is active, the gamer is always attached to him and neither automatic switching nor
// the switch button move him to another player. With no lock set (-1, the default) everything behaves as the original.

import type { Vector3 } from '../../blunted/base/math/vector3';
import { clamp } from '../../blunted/base/math/bluntmath';
import { assert } from '../../blunted/base/assert';
import { Log, e_Notice } from '../../blunted/base/log';
import { int_to_str } from '../../blunted/base/utils';
import { FileSystem } from '../../blunted/managers/filesystem';
import { ResourceManagerPool } from '../../blunted/managers/resourcemanagerpool';
import { Node } from '../../blunted/scene/node';
import { e_LocalMode } from '../../blunted/scene/spatial';
import { ObjectLoader } from '../../blunted/utils/objectloader';
import type { Resource } from '../../blunted/scene/resources/resource';
import type { Surface } from '../../blunted/scene/resources/surface';
import { FormationEntry, e_MatchPhase, e_PlayerRole, e_TouchType, playerNum } from '../gamedefines';
import { GetMenuTask, Verbose } from '../globals';
import { e_ButtonFunction, type IHIDevice } from '../hid/ihidevice';
import { AI_GetBestSwitchTargetPlayer, AI_GetClosestPlayer } from './AIsupport/AIfunctions';
import { HumanGamer, e_PlayerColor } from './humangamer';
import { Player } from './player/player';
import { TeamAIController } from './teamAIcontroller';
import type { Match } from './match';
import type { TeamData } from '../data/teamdata';
import type { PlayerData } from '../data/playerdata';

export class Team {
  protected id: number;
  protected match: Match;
  protected teamData: TeamData;

  protected hasPossession: boolean;
  protected timeNeededToGetToBall_ms: number;
  protected designatedTeamPossessionPlayer!: Player;

  protected teamPossessionAmount: number;
  protected fadingTeamPossessionAmount: number;

  protected teamController: TeamAIController;

  protected players: Player[] = [];
  protected activePlayerCount = 0;

  protected teamNode: Node;
  protected playerNode: Node | null = null;

  protected humanGamers: HumanGamer[] = [];

  // humanGamers index whose turn it is
  // [0] == due next
  protected switchPriority: number[] = [];

  protected lastTouchPlayers: (Player | null)[] = [];
  protected lastTouchPlayer: Player | null;
  protected lastTouchType: e_TouchType;

  protected kit: Resource<Surface> | null = null;

  /** CAREER: player id the (first) human gamer of this team is locked onto, -1 == none */
  protected lockedHumanPlayerID = -1;

  constructor(id: number, match: Match, teamData: TeamData) {
    this.id = id;
    this.match = match;
    this.teamData = teamData;

    assert(id === 0 || id === 1);
    assert(teamData.GetPlayerNum() >= playerNum); // does team have enough players?

    this.teamNode = new Node('team node #' + int_to_str(id));
    this.teamNode.SetLocalMode(e_LocalMode.e_LocalMode_Absolute);
    match.GetDynamicNode().AddNode(this.teamNode);

    this.timeNeededToGetToBall_ms = 100;
    this.hasPossession = false;

    this.teamPossessionAmount = 1.0;
    this.fadingTeamPossessionAmount = 1.0;

    for (let i = 0; i < e_TouchType.e_TouchType_SIZE; i++) {
      this.lastTouchPlayers[i] = null;
    }
    this.lastTouchPlayer = null;
    this.lastTouchType = e_TouchType.e_TouchType_None;

    // PORT: created after the fields above are set (the controller's constructor reads the team)
    this.teamController = new TeamAIController(this);
  }

  Exit(): void {
    this.Hide2D();

    for (let i = 0; i < this.humanGamers.length; i++) {
      this.humanGamers[i].Exit();
    }
    for (let i = 0; i < this.players.length; i++) {
      this.players[i].Exit();
    }

    if (this.playerNode) this.playerNode.Exit();
    this.playerNode = null;

    this.match.GetDynamicNode().DeleteNode(this.teamNode);
  }

  /** colorCoords: C++ std::map<Vector3, Vector3> (keys: Float32Key, see gamedefines GetVertexColors) */
  InitPlayers(fullbodyNode: Node, colorCoords: Map<string, Vector3>): void {
    // first, load 1 instance of a player

    Log(e_Notice, 'Team', 'InitPlayers', 'Loading player template instance');

    const playerNode = new ObjectLoader().LoadObject('media/objects/players/player.object');
    playerNode.SetName('player');
    playerNode.SetLocalMode(e_LocalMode.e_LocalMode_Absolute);
    this.playerNode = playerNode;

    this.activePlayerCount = playerNum;

    Log(e_Notice, 'Team', 'Team', 'Creating players');

    // load all players in the team, even the players who sit on the bench. aww.
    for (let i = 0; i < this.teamData.GetPlayerNum(); i++) {
      const playerData = this.teamData.GetPlayerData(i) as PlayerData;
      const player = new Player(this, playerData);
      this.players.push(player);

      if (i < this.activePlayerCount) {
        // activate playerCount players (the starting eleven, usually)
        let kitFilename: string;
        if (this.GetFormationEntry(player.GetID()).role !== e_PlayerRole.e_PlayerRole_GK) {
          kitFilename = this.GetTeamData().GetKitUrl() + '_kit_0' + int_to_str(GetMenuTask().GetTeamKitNum(this.GetID())) + '.png';
          if (!FileSystem.Exists(kitFilename)) kitFilename = this.GetID() === 0 ? 'media/textures/almost_white.png' : 'media/textures/almost_black.png';
        } else {
          kitFilename = 'media/objects/players/textures/goalie_kit.png';
        }
        const kit = ResourceManagerPool.GetInstance().FetchSurface(kitFilename);
        this.kit = kit;
        player.Activate(playerNode, fullbodyNode, colorCoords, kit, this.match.GetAnimCollection());
      }
    }

    this.designatedTeamPossessionPlayer = this.players[0];
  }

  GetMatch(): Match {
    return this.match;
  }

  GetController(): TeamAIController {
    return this.teamController;
  }

  GetSceneNode(): Node {
    return this.teamNode;
  }

  GetID(): number {
    return this.id;
  }

  /** -1 == left, 1 == right */
  GetSide(): number {
    let side = 0;
    if (this.id === 0) side = -1;
    if (this.id === 1) side = 1;

    // -1 == left, 1 == right
    const phase = this.match.GetMatchPhase();
    if (phase === e_MatchPhase.e_MatchPhase_2ndHalf || phase === e_MatchPhase.e_MatchPhase_2ndExtraTime) side *= -1;

    return side;
  }

  GetTeamData(): TeamData {
    return this.teamData;
  }

  GetPlayer(playerID: number): Player | null {
    for (let i = 0; i < this.players.length; i++) {
      if (this.players[i].GetID() === playerID) {
        return this.players[i];
      }
    }

    // id not found
    return null;
  }

  GetPlayerData(playerID: number): PlayerData {
    for (let i = 0; i < this.players.length; i++) {
      if (this.players[i].GetID() === playerID) {
        return this.teamData.GetPlayerData(i) as PlayerData;
      }
    }

    assert(false, 'Team.GetPlayerData: unknown player id');
    return null as unknown as PlayerData;
  }

  GetFormationEntry(playerID: number): FormationEntry {
    for (let i = 0; i < this.players.length; i++) {
      if (this.players[i].GetID() === playerID) {
        return this.teamData.GetFormationEntry(i);
      }
    }

    assert(false, 'Team.GetFormationEntry: unknown player id');
    const fail = new FormationEntry();
    return fail;
  }

  SetFormationEntry(playerID: number, entry: FormationEntry): void {
    for (let i = 0; i < this.players.length; i++) {
      if (this.players[i].GetID() === playerID) {
        this.teamData.SetFormationEntry(i, entry);
      }
    }
  }

  /**
   * C++ overloads merged: GetAllPlayers() returns the (read-only) player list; GetAllPlayers(allPlayers) appends
   * all players to allPlayers and returns it.
   */
  GetAllPlayers(allPlayers?: Player[]): Player[] {
    if (allPlayers === undefined) return this.players;
    for (let i = 0; i < this.players.length; i++) allPlayers.push(this.players[i]);
    return allPlayers;
  }

  /** C++ void GetActivePlayers(std::vector<Player*> &activePlayers): appends, and returns activePlayers */
  GetActivePlayers(activePlayers: Player[]): Player[] {
    for (const player of this.players) {
      if (player.IsActive()) activePlayers.push(player);
    }
    return activePlayers;
  }

  GetActivePlayerCount(): number {
    return this.activePlayerCount;
  }

  GetHumanGamerCount(): number {
    return this.humanGamers.length;
  }

  AddHumanGamer(hid: IHIDevice, color: e_PlayerColor): void {
    const humanGamer = new HumanGamer(this, hid, color);

    this.humanGamers.push(humanGamer);

    // CAREER: the first human gamer starts on the locked player
    const lockedPlayer = this.humanGamers.length === 1 ? this.GetActiveLockedHumanPlayer() : null;
    if (lockedPlayer) {
      humanGamer.SetSelectedPlayerID(lockedPlayer.GetID());
    } else {
      humanGamer.SetSelectedPlayerID(AI_GetClosestPlayer(this, this.match.GetBall().Predict(0).Get2D(), true)!.GetID());
    }

    this.switchPriority.push(this.humanGamers.length - 1);
    this.designatedTeamPossessionPlayer = AI_GetClosestPlayer(this, this.match.GetBall().Predict(0).Get2D(), false)!;
  }

  DeleteHumanGamers(): void {
    for (let i = 0; i < this.humanGamers.length; i++) {
      this.humanGamers[i].Exit();
    }
    this.humanGamers = [];
    this.switchPriority = [];
  }

  GetPlayerColor(playerID: number): e_PlayerColor {
    for (let h = 0; h < this.humanGamers.length; h++) {
      if (this.humanGamers[h].GetSelectedPlayerID() === playerID) return this.humanGamers[h].GetPlayerColor();
    }
    return e_PlayerColor.e_PlayerColor_Default;
  }

  IsHumanControlled(playerID: number): boolean {
    for (let h = 0; h < this.humanGamers.length; h++) {
      if (this.humanGamers[h].GetSelectedPlayerID() === playerID) return true;
    }
    return false;
  }

  // ----- CAREER: locked human player ("be a pro")

  /**
   * CAREER: lock the human gamer of this team onto one player (a player id of this team), -1 == no lock (default).
   * While that player is active, the (first) human gamer of this team is always attached to him; automatic switching
   * and the switch button never move the gamer to another player. If he is not active (sent off, substituted), the
   * normal switching behaviour applies until he is active again.
   */
  SetLockedHumanPlayer(playerID: number): void {
    this.lockedHumanPlayerID = playerID;
    // attach right away if the gamer currently controls someone (when nobody is selected, e.g. while the ball is out
    // of play, HumanGamersSelectAnyone attaches him once play resumes)
    if (this.humanGamers.length > 0 && this.humanGamers[0].GetSelectedPlayerID() !== -1) {
      this.AttachLockedHumanPlayer();
    }
  }

  /** CAREER: the locked player id, -1 == none */
  GetLockedHumanPlayer(): number {
    return this.lockedHumanPlayerID;
  }

  /** CAREER: the locked player, if the lock is set and that player is currently active */
  protected GetActiveLockedHumanPlayer(): Player | null {
    if (this.lockedHumanPlayerID === -1) return null;
    const player = this.GetPlayer(this.lockedHumanPlayerID);
    if (player && player.IsActive()) return player;
    return null;
  }

  /** CAREER: true if humanGamers[index] is currently locked onto the locked player */
  protected IsLockedHumanGamer(index: number): boolean {
    return index === 0 && this.GetActiveLockedHumanPlayer() !== null;
  }

  /** CAREER: make sure the first human gamer is attached to the (active) locked player; returns true if locked */
  protected AttachLockedHumanPlayer(): boolean {
    const lockedPlayer = this.GetActiveLockedHumanPlayer();
    if (!lockedPlayer || this.humanGamers.length === 0) return false;
    const lockedID = lockedPlayer.GetID();
    if (this.humanGamers[0].GetSelectedPlayerID() !== lockedID) {
      // no other gamer of this team may hold the locked player
      for (let i = 1; i < this.humanGamers.length; i++) {
        if (this.humanGamers[i].GetSelectedPlayerID() === lockedID) this.humanGamers[i].SetSelectedPlayerID(-1);
      }
      this.humanGamers[0].SetSelectedPlayerID(lockedID);
    }
    return true;
  }

  // -----

  HasPossession(): boolean {
    return this.hasPossession;
  }

  HasUniquePossession(): boolean {
    return this.HasPossession() && !this.match.GetTeam(Math.abs(this.id - 1)).HasPossession();
  }

  GetTimeNeededToGetToBall_ms(): number {
    return this.timeNeededToGetToBall_ms;
  }

  GetBestPossessionPlayerID(): number {
    return this.GetBestPossessionPlayer().GetID();
  }

  GetDesignatedTeamPossessionPlayer(): Player {
    return this.designatedTeamPossessionPlayer;
  }

  GetBestPossessionPlayer(): Player {
    let bestTime_ms = 10000000;
    let bestPlayer: Player | null = null;
    for (let i = 0; i < this.players.length; i++) {
      if (this.players[i].IsActive()) {
        const time_ms = this.players[i].GetTimeNeededToGetToBall_ms();
        if (time_ms < bestTime_ms) {
          bestTime_ms = time_ms;
          bestPlayer = this.players[i];
        }
      }
    }

    assert(bestPlayer);

    return bestPlayer!;
  }

  GetTeamPossessionAmount(): number {
    return this.teamPossessionAmount;
  }

  GetFadingTeamPossessionAmount(): number {
    return this.fadingTeamPossessionAmount;
  }

  SetFadingTeamPossessionAmount(value: number): void {
    this.fadingTeamPossessionAmount = clamp(value, 0.5, 1.5);
  }

  SetLastTouchPlayer(player: Player, touchType: e_TouchType = e_TouchType.e_TouchType_Intentional_Kicked): void {
    this.lastTouchPlayers[touchType] = player;
    this.lastTouchPlayer = player;
    this.lastTouchType = touchType;
    player.SetLastTouchTime_ms(this.match.GetActualTime_ms());
    player.SetLastTouchType(this.lastTouchType);
    this.match.SetLastTouchTeamID(this.GetID(), touchType);
  }

  /** C++ overloads merged: GetLastTouchPlayer(touchType) / GetLastTouchPlayer() */
  GetLastTouchPlayer(touchType?: e_TouchType): Player | null {
    if (touchType === undefined) return this.lastTouchPlayer;
    return this.lastTouchPlayers[touchType];
  }

  GetLastTouchTime_ms(): number {
    return this.lastTouchPlayer ? this.lastTouchPlayer.GetLastTouchTime_ms() : 0;
  }

  GetLastTouchType(): e_TouchType {
    return this.lastTouchType;
  }

  GetLastTouchBias(decay_ms: number, time_ms = 0): number {
    return this.lastTouchPlayer ? this.lastTouchPlayer.GetLastTouchBias(decay_ms, time_ms) : 0;
  }

  ResetSituation(focusPos: Vector3): void {
    this.timeNeededToGetToBall_ms = 100;
    this.hasPossession = false;

    this.teamPossessionAmount = 1.0;
    this.fadingTeamPossessionAmount = 1.0;

    for (let i = 0; i < e_TouchType.e_TouchType_SIZE; i++) {
      this.lastTouchPlayers[i] = null;
    }
    this.lastTouchPlayer = null;
    this.lastTouchType = e_TouchType.e_TouchType_None;

    this.designatedTeamPossessionPlayer = this.players[0];

    for (let i = 0; i < this.players.length; i++) {
      if (this.players[i].IsActive()) {
        this.players[i].ResetSituation(focusPos);
      }
    }

    this.GetController().Reset();
  }

  HumanGamersSelectAnyone(): void {
    // make sure all human gamers have a player selected

    if (this.match.IsInPlay()) {
      // CAREER: the locked gamer goes to the locked player
      this.AttachLockedHumanPlayer();

      for (let i = 0; i < this.humanGamers.length; i++) {
        if (this.humanGamers[i].GetSelectedPlayerID() === -1) {
          const playerID = AI_GetClosestPlayer(this, this.match.GetBall().Predict(0).Get2D(), true)!.GetID();
          this.humanGamers[i].SetSelectedPlayerID(playerID);
        }
      }
    }
  }

  SelectPlayer(player: Player): void {
    if (!this.IsHumanControlled(player.GetID()) && this.humanGamers.length !== 0) {
      // already selected
      // CAREER: the gamer whose turn it is switches, skipping a locked gamer (without a lock this is always the first entry)
      let turn = 0;
      while (turn < this.switchPriority.length && this.IsLockedHumanGamer(this.switchPriority[turn])) turn++;
      if (turn < this.switchPriority.length) {
        const gamerIndex = this.switchPriority[turn];
        this.humanGamers[gamerIndex].SetSelectedPlayerID(player.GetID());
        this.switchPriority.splice(turn, 1);
        this.switchPriority.push(gamerIndex);
        if (Verbose()) console.debug(`switched player to ${player.GetPlayerData().GetLastName()}`);
      }
    }
    this.designatedTeamPossessionPlayer = player;
  }

  DeselectPlayer(player: Player): void {
    for (let i = 0; i < this.humanGamers.length; i++) {
      const selectedPlayerID = this.humanGamers[i].GetSelectedPlayerID();
      if (selectedPlayerID === player.GetID()) {
        const somePlayer = AI_GetClosestPlayer(this, player.GetPosition(), true, player);
        if (somePlayer) {
          this.humanGamers[i].SetSelectedPlayerID(somePlayer.GetID());
        } else {
          this.humanGamers[i].SetSelectedPlayerID(-1);
        }
      }
    }
  }

  RelaxFatigue(howMuch: number): void {
    for (let i = 0; i < this.players.length; i++) {
      if (this.players[i].IsActive()) {
        this.players[i].RelaxFatigue(howMuch);
      }
    }
  }

  Process(): void {
    const match = this.match;

    if (!match.GetPause()) {
      const oppTeam = match.GetTeam(Math.abs(this.GetID() - 1));

      this.teamPossessionAmount = (oppTeam.GetTimeNeededToGetToBall_ms() + 1500) / (this.GetTimeNeededToGetToBall_ms() + 1500);
      const tmpFadingTeamPossessionAmount = this.fadingTeamPossessionAmount * 0.995 + clamp(this.teamPossessionAmount, 0.5, 1.5) * 0.005;
      this.fadingTeamPossessionAmount += clamp(tmpFadingTeamPossessionAmount - this.fadingTeamPossessionAmount, -0.005, 0.005); // maximum change per 10ms

      if (!match.IsInPlay() || match.IsInSetPiece() || match.GetBallRetainer() !== null) {
        const ballRetainer = match.GetBallRetainer();
        if (ballRetainer !== null) {
          this.fadingTeamPossessionAmount = this.teamPossessionAmount = ballRetainer.GetTeamID() === this.GetID() ? 1.5 : 0.5;
        } else {
          this.fadingTeamPossessionAmount = this.teamPossessionAmount = match.GetBestPossessionTeamID() === this.GetID() ? 1.5 : 0.5;
        }
      }

      this.HumanGamersSelectAnyone();

      if (match.IsInPlay() && !match.IsInSetPiece()) {
        this.teamController.Process();

        if ((match.GetActualTime_ms() + 200 * this.id) % 400 === 0) {
          this.teamController.CalculateDynamicRoles();
        }

        if ((match.GetActualTime_ms() + 200 * this.id + 100) % 400 === 0) {
          this.teamController.CalculateManMarking();
        }
      }

      for (let i = 0; i < this.players.length; i++) {
        if (this.players[i].IsActive()) {
          this.players[i].Process();
        }
      }

      if (match.IsInPlay()) {
        for (let i = 0; i < this.humanGamers.length; i++) {
          // CAREER: a locked gamer never switches
          if (this.IsLockedHumanGamer(i)) continue;

          const humanGamer = this.humanGamers[i];
          const hid = humanGamer.GetHIDevice();

          // switch button
          const selectedPlayerID = humanGamer.GetSelectedPlayerID();
          const selectedPlayer = this.GetPlayer(selectedPlayerID);
          assert(selectedPlayer);

          if (
            hid.GetButton(e_ButtonFunction.e_ButtonFunction_Switch) &&
            !hid.GetPreviousButtonState(e_ButtonFunction.e_ButtonFunction_Switch) &&
            // don't switch if we are both best AND designated possession player. unless opponent team has ball.
            (!(selectedPlayerID === this.GetBestPossessionPlayerID() && selectedPlayerID === this.designatedTeamPossessionPlayer.GetID()) ||
              this.GetTeamPossessionAmount() < 1.0) &&
            !selectedPlayer!.HasUniquePossession()
          ) {
            let targetPlayerID = -1;
            let targetPlayer: Player | null = null;

            if (!this.IsHumanControlled(this.designatedTeamPossessionPlayer.GetID()) && match.GetBestPossessionTeamID() === this.GetID()) {
              targetPlayer = this.designatedTeamPossessionPlayer;
            } else if (!this.IsHumanControlled(this.GetBestPossessionPlayer().GetID()) && match.GetBestPossessionTeamID() === this.GetID()) {
              targetPlayer = this.GetBestPossessionPlayer();
            } else {
              targetPlayer = AI_GetBestSwitchTargetPlayer(match, this, hid.GetDirection());
              if (targetPlayer) if (this.IsHumanControlled(targetPlayer.GetID())) targetPlayer = null;
            }
            if (targetPlayer === this.GetGoalie()) targetPlayer = null; // can not be goalie in current version, at least not during play, unless being directly passed to by teammate

            if (targetPlayer) {
              targetPlayerID = targetPlayer.GetID();
            }
            if (targetPlayerID !== -1) humanGamer.SetSelectedPlayerID(targetPlayerID);
          }
        }
      } else {
        // make sure all human gamers don't have a player selected

        for (let i = 0; i < this.humanGamers.length; i++) {
          if (this.humanGamers[i].GetSelectedPlayerID() !== -1) {
            this.humanGamers[i].SetSelectedPlayerID(-1);
          }
        }
      }

      const designatedPlayerTime_ms = this.designatedTeamPossessionPlayer.GetTimeNeededToGetToBall_ms();
      const bestPlayer = this.GetBestPossessionPlayer();
      const oppTime_ms = oppTeam.GetTimeNeededToGetToBall_ms();
      if (this.designatedTeamPossessionPlayer !== bestPlayer) {
        // switch only if other player is somewhat better, to overcome possession-chaos
        const bestPlayerTime_ms = bestPlayer.GetTimeNeededToGetToBall_ms();
        let timeRating = (bestPlayerTime_ms + 500) / (designatedPlayerTime_ms + 500);

        if (bestPlayer.HasPossession()) timeRating *= 0.5;
        if (this.designatedTeamPossessionPlayer.HasPossession()) timeRating /= 0.5;

        if (this.IsHumanControlled(bestPlayer.GetID())) timeRating *= 0.8;
        if (this.IsHumanControlled(this.designatedTeamPossessionPlayer.GetID())) timeRating /= 0.8;

        // current player can get to the ball before the closest opponent: less need to switch
        if (this.IsHumanControlled(bestPlayer.GetID()) === false && designatedPlayerTime_ms < oppTime_ms - 100) {
          timeRating += 0.2;
          timeRating *= 1.2;
        }

        if (timeRating < 0.8) {
          this.designatedTeamPossessionPlayer = bestPlayer;
        }
      }
    }
  }

  PreparePutBuffers(snapshotTime_ms: number): void {
    for (let i = 0; i < this.players.length; i++) {
      if (this.players[i].IsActive()) {
        this.players[i].PreparePutBuffers(snapshotTime_ms);
      }
    }
  }

  FetchPutBuffers(putTime_ms: number): void {
    for (let i = 0; i < this.players.length; i++) {
      if (this.players[i].IsActive()) {
        this.players[i].FetchPutBuffers(putTime_ms);
      }
    }
  }

  Put(): void {
    for (let i = 0; i < this.players.length; i++) {
      if (this.players[i].IsActive()) {
        this.players[i].Put();
      }
    }
  }

  Put2D(): void {
    for (let i = 0; i < this.players.length; i++) {
      if (this.players[i].IsActive()) {
        this.players[i].Put2D();
      }
    }
  }

  Hide2D(): void {
    for (let i = 0; i < this.players.length; i++) {
      if (this.players[i].IsActive()) {
        this.players[i].Hide2D();
      }
    }
  }

  UpdatePossessionStats(): void {
    for (let i = 0; i < this.players.length; i++) {
      if (this.players[i].IsActive()) {
        this.players[i].UpdatePossessionStats();
      }
    }

    // possession?

    this.hasPossession = false;
    this.timeNeededToGetToBall_ms = 100000;
    for (let i = 0; i < this.players.length; i++) {
      if (this.players[i].IsActive()) {
        if (this.players[i].HasPossession()) this.hasPossession = true;
        if (this.players[i].GetTimeNeededToGetToBall_ms() < this.timeNeededToGetToBall_ms) this.timeNeededToGetToBall_ms = this.players[i].GetTimeNeededToGetToBall_ms();
      }
    }
  }

  UpdateSwitch(): void {
    // lose turn on ball possession

    if (this.match.IsInPlay() && this.humanGamers.length > 1) {
      const myTurn = this.switchPriority[0];
      if (this.humanGamers[myTurn].GetSelectedPlayerID() === this.match.GetDesignatedPossessionPlayer().GetID()) {
        this.switchPriority.shift();
        this.switchPriority.push(myTurn);
      }
    }

    // autoswitch on proximity (disabled in the original)

    // team player in possession is not human selected

    if (this.match.IsInPlay() && this.humanGamers.length > 0) {
      if (
        !this.IsHumanControlled(this.designatedTeamPossessionPlayer.GetID()) &&
        (this.designatedTeamPossessionPlayer.HasUniquePossession() || this.match.IsInSetPiece())
      ) {
        if (this.designatedTeamPossessionPlayer !== this.GetGoalie()) {
          this.SelectPlayer(this.designatedTeamPossessionPlayer);
        }
      }
    }
  }

  GetGoalie(): Player | null {
    for (let i = 0; i < this.players.length; i++) {
      if (this.players[i].IsActive()) {
        if (this.players[i].GetFormationEntry().role === e_PlayerRole.e_PlayerRole_GK) return this.players[i];
      }
    }

    return null;
  }

  SetKitNumber(num: number): void {
    let kitNumberString = int_to_str(num);
    if (kitNumberString.length < 2) kitNumberString = '0' + kitNumberString;
    let kitFilename = this.GetTeamData().GetKitUrl() + '_kit_' + kitNumberString + '.png';
    if (!FileSystem.Exists(kitFilename)) kitFilename = this.GetID() === 0 ? 'media/textures/white.png' : 'media/textures/black.png';

    // new kits on the block!
    const newKit = ResourceManagerPool.GetInstance().FetchSurface(kitFilename);

    for (let i = 0; i < this.players.length; i++) {
      if (this.players[i].IsActive()) {
        if (this.players[i].GetFormationEntry().role !== e_PlayerRole.e_PlayerRole_GK) this.players[i].SetKit(newKit);
      }
    }

    this.kit = newKit;
  }
}
