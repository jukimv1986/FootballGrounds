// Port of gametask.{hpp,cpp}.
// Original: written by bastiaan konings schuiling 2008 - 2015 (public domain / Apache-2.0).
//
// The "game" task: owns the running Match and runs its Get/Process/Put phases. The game loop
// (src/game/gameloop.ts) calls GetPhase + ProcessPhase once per 10ms step and PutPhase once per
// rendered frame, like the "game" and "graphics" task sequences of the original main.cpp.
//
// PORT: single-threaded, so the mutexes and the threaded UpdateFullbodyModel / UploadFullbodyModel
// commands are plain loops. The menu scene (3D menu background) is not ported: the menus are DOM.

import type { Geometry } from '../blunted/scene/objects/geometry';
import { GetControllers, GetMenuTask, GetScheduler, Verbose } from './globals';
import { Match } from './onthepitch/match';
import type { Player } from './onthepitch/player/player';
import type { PlayerBase } from './onthepitch/player/playerbase';

export enum e_GameTaskMessage {
  e_GameTaskMessage_StartMatch,
  e_GameTaskMessage_StopMatch,
  e_GameTaskMessage_StartMenuScene,
  e_GameTaskMessage_StopMenuScene,
  e_GameTaskMessage_None,
}

/** C++ UpdateFullbodyModel command: rebuilds the skinned full body meshes */
function UpdateFullbodyModel(playersToProcess: PlayerBase[]): void {
  for (const player of playersToProcess) player.UpdateFullbodyModel();
}

/** C++ UploadFullbodyModel command: tells the renderer the mesh vertices changed */
function UploadFullbodyModel(playersToProcess: PlayerBase[]): void {
  for (const player of playersToProcess) {
    const geometry = player.GetFullbodyNode()?.GetObject('fullbody') as Geometry | null | undefined;
    geometry?.OnUpdateGeometryData(false);
  }
}

export class GameTask {
  protected match: Match | null = null;

  // scratch arrays reused every frame (PutPhase is a per-frame hot path)
  private players: Player[] = [];
  private officials: PlayerBase[] = [];
  private playersToProcess: PlayerBase[] = [];

  Exit(): void {
    this.Action(e_GameTaskMessage.e_GameTaskMessage_StopMatch);
    this.Action(e_GameTaskMessage.e_GameTaskMessage_StopMenuScene);
    // PORT: ResourceManagerPool::CleanUp() is done by the match session runner (it knows which
    // resources belong to the match)
  }

  Action(message: e_GameTaskMessage): void {
    switch (message) {
      case e_GameTaskMessage.e_GameTaskMessage_StartMatch: {
        if (Verbose()) console.debug('*gametaskmessage: starting match');
        const matchData = GetMenuTask().GetMatchData();
        const tmpMatch = new Match(matchData, GetControllers());
        if (this.match) throw new Error('GameTask: a match is already running');
        this.match = tmpMatch;
        GetScheduler().ResetTaskSequenceTime('game');
        break;
      }

      case e_GameTaskMessage.e_GameTaskMessage_StopMatch:
        if (Verbose()) console.debug('*gametaskmessage: stopping match');
        if (this.match) {
          this.match.Exit();
          this.match = null;
        }
        break;

      case e_GameTaskMessage.e_GameTaskMessage_StartMenuScene:
      case e_GameTaskMessage.e_GameTaskMessage_StopMenuScene:
        // PORT: no 3D menu scene in the browser version
        break;

      default:
        break;
    }
  }

  GetPhase(): void {
    if (this.match) this.match.Get();
  }

  ProcessPhase(): void {
    const controllers = GetControllers();
    for (let i = 0; i < controllers.length; i++) controllers[i].Process();

    if (this.match) {
      this.match.Process();
      this.match.PreparePutBuffers();
    }
  }

  PutPhase(): void {
    const match = this.match;
    if (!match) return;

    match.FetchPutBuffers();
    match.Put();

    const players = this.players;
    const officials = this.officials;
    const playersToProcess = this.playersToProcess;
    players.length = 0;
    officials.length = 0;
    playersToProcess.length = 0;

    match.GetActiveTeamPlayers(0, players);
    match.GetActiveTeamPlayers(1, players);
    match.GetOfficialPlayers(officials);

    const pause = match.GetPause();
    for (let i = 0; i < players.length; i++) {
      if (pause || players[i].NeedsModelUpdate()) playersToProcess.push(players[i]);
    }
    for (let i = 0; i < officials.length; i++) playersToProcess.push(officials[i]);

    UpdateFullbodyModel(playersToProcess);

    match.UploadGoalNetting();

    UploadFullbodyModel(playersToProcess);
  }

  GetMatch(): Match | null {
    return this.match;
  }

  GetName(): string {
    return 'game';
  }
}
