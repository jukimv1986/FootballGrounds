// Port of legacy/src/onthepitch/referee.{hpp,cpp}. Original: written by bastiaan konings schuiling 2008 - 2015 (public domain / Apache-2.0).

import { Vector3 } from '../../blunted/base/math/vector3';
import { clamp, NormalizedClamp } from '../../blunted/base/math/bluntmath';
import { ResourceManagerPool } from '../../blunted/managers/resourcemanagerpool';
import { Sound } from '../../blunted/scene/objects/sound';
import type { Scene3D } from '../../blunted/scene/scene3d';
import { e_FunctionType, e_MatchPhase, e_SetPiece, lineHalfW, pitchHalfH, pitchHalfW } from '../gamedefines';
import { GetConfiguration, GetScene3D, IsReleaseVersion } from '../globals';
import { AI_GetOffsideLine } from './AIsupport/AIfunctions';
import type { Match } from './match';
import type { Player } from './player/player';

/** C++ struct RefereeBuffer */
export class RefereeBuffer {
  active = false;
  desiredSetPiece = e_SetPiece.e_SetPiece_None;
  teamID = 0;
  stopTime = 0;
  prepareTime = 0;
  startTime = 0;
  restartPos = new Vector3(0);
  taker: Player | null = null;
  endPhase = false;

  Clone(): RefereeBuffer {
    return Object.assign(new RefereeBuffer(), this);
  }
}

/** C++ struct Foul */
export class Foul {
  foulPlayer: Player | null = null;
  foulVictim: Player | null = null;
  /** 0: nothing, 1: foul, 2: yellow, 3: red */
  foulType = 0;
  advantage = false;
  foulTime = 0;
  foulPosition = new Vector3(0);
  hasBeenProcessed = false;

  Clone(): Foul {
    return Object.assign(new Foul(), this);
  }
}

export class Referee {
  protected match: Match;

  protected scene3D: Scene3D;

  protected buffer = new RefereeBuffer();

  /** throw-ins cause immediate new throw-ins, because ball is still outside the lines at the moment of throwing ;) */
  protected afterSetPieceRelaxTime_ms: number;

  /** player, position at time of touch */
  protected offsidePlayers = new Map<Player, Vector3>();

  protected foul = new Foul();

  /** 0: short, 1: long, 2: half time, 3: full time (only 1 and 3 are used) */
  protected whistle: Sound[] = [];

  constructor(match: Match) {
    this.match = match;

    this.buffer.desiredSetPiece = e_SetPiece.e_SetPiece_KickOff;
    this.buffer.teamID = 0;
    this.buffer.stopTime = 0;
    this.buffer.prepareTime = 0;
    this.buffer.startTime = this.buffer.prepareTime + 2000;
    this.buffer.restartPos = new Vector3(0);
    this.buffer.taker = null;
    this.buffer.endPhase = true;
    this.buffer.active = true;

    this.foul.foulPlayer = null;
    this.foul.foulType = 0;
    this.foul.advantage = false;
    this.foul.foulTime = 0;
    this.foul.hasBeenProcessed = true;

    this.afterSetPieceRelaxTime_ms = 0;

    // whistle

    let soundBufferRes = ResourceManagerPool.GetInstance().FetchSoundBuffer('media/sounds/whistle2.wav');
    this.whistle[1] = new Sound('whistle1');
    this.whistle[1].SetSoundBuffer(soundBufferRes);
    this.whistle[1].SetLoop(false);
    GetScene3D().AddObject(this.whistle[1]);

    soundBufferRes = ResourceManagerPool.GetInstance().FetchSoundBuffer('media/sounds/whistle3.wav');
    this.whistle[3] = new Sound('whistle3');
    this.whistle[3].SetSoundBuffer(soundBufferRes);
    this.whistle[3].SetLoop(false);
    GetScene3D().AddObject(this.whistle[3]);

    // for usage in destructor
    this.scene3D = GetScene3D();
  }

  /** C++ destructor */
  Exit(): void {
    this.scene3D.DeleteObject(this.whistle[1]);
    this.scene3D.DeleteObject(this.whistle[3]);
  }

  Process(): void {
    const match = this.match;
    const buffer = this.buffer;

    if (match.IsInPlay() && !match.IsInSetPiece()) {
      const ballPos = match.GetBall().Predict(0);

      // some phase is over :[

      if (
        ((match.GetMatchPhase() === e_MatchPhase.e_MatchPhase_1stHalf && match.GetMatchTime_ms() > 2700000) ||
          (match.GetMatchPhase() === e_MatchPhase.e_MatchPhase_2ndHalf && match.GetMatchTime_ms() > 5400000) ||
          (match.GetMatchPhase() === e_MatchPhase.e_MatchPhase_1stExtraTime && match.GetMatchTime_ms() > 6300000) ||
          (match.GetMatchPhase() === e_MatchPhase.e_MatchPhase_2ndExtraTime && match.GetMatchTime_ms() > 7200000)) &&
        ballPos.coords[0] < 10 &&
        ballPos.coords[0] > -10
      ) {
        this.foul.advantage = false;
        if (!this.CheckFoul()) {
          match.StopPlay();
          this.whistle[3].SetGain(0.3 * GetConfiguration().GetReal('audio_volume', 0.5));
          this.whistle[3].Poke();

          buffer.desiredSetPiece = e_SetPiece.e_SetPiece_KickOff;
          buffer.stopTime = match.GetActualTime_ms();
          buffer.prepareTime = match.GetActualTime_ms() + 3000;
          buffer.startTime = buffer.prepareTime + 2000;
          buffer.restartPos = new Vector3(0);
          buffer.active = true;
          buffer.endPhase = true;
          if (match.GetMatchPhase() === e_MatchPhase.e_MatchPhase_1stHalf || match.GetMatchPhase() === e_MatchPhase.e_MatchPhase_1stExtraTime) {
            buffer.teamID = 1;
          } else {
            buffer.teamID = 0;
          }

          let nextPhase = match.GetMatchPhase(); // (uninitialized in C++; always overwritten below)
          if (match.GetMatchPhase() === e_MatchPhase.e_MatchPhase_1stHalf) nextPhase = e_MatchPhase.e_MatchPhase_2ndHalf;
          if (match.GetMatchPhase() === e_MatchPhase.e_MatchPhase_2ndHalf) nextPhase = e_MatchPhase.e_MatchPhase_1stExtraTime;
          if (match.GetMatchPhase() === e_MatchPhase.e_MatchPhase_1stExtraTime) nextPhase = e_MatchPhase.e_MatchPhase_2ndExtraTime;
          if (match.GetMatchPhase() === e_MatchPhase.e_MatchPhase_2ndExtraTime) nextPhase = e_MatchPhase.e_MatchPhase_Penalties;
          match.SetMatchPhase(nextPhase);
        }
      }

      // goal kick / corner

      if (Math.abs(ballPos.coords[0]) > pitchHalfW + lineHalfW + 0.11) {
        this.foul.advantage = false;
        let isFoul = false;
        if (!match.IsGoalScored()) isFoul = this.CheckFoul();
        else this.foul.foulType = 0;
        if (isFoul === false) {
          match.StopPlay();

          // corner, goal kick or kick off?
          let lastTouchTeam = match.GetLastTouchTeam();
          if (!lastTouchTeam) lastTouchTeam = match.GetTeam(0);
          const lastSide = lastTouchTeam.GetSide();

          if (match.IsGoalScored()) {
            buffer.desiredSetPiece = e_SetPiece.e_SetPiece_KickOff;
            buffer.stopTime = match.GetActualTime_ms();
            buffer.prepareTime = match.GetActualTime_ms() + 6000;
            buffer.startTime = buffer.prepareTime + 2000;
            buffer.restartPos = new Vector3(0, 0, 0);
            buffer.teamID = Math.abs(match.GetLastGoalTeamID() - 1);
          } else if ((ballPos.coords[0] > 0 && lastSide > 0) || (ballPos.coords[0] < 0 && lastSide < 0)) {
            buffer.desiredSetPiece = e_SetPiece.e_SetPiece_Corner;
            buffer.stopTime = match.GetActualTime_ms();
            buffer.prepareTime = match.GetActualTime_ms() + 2000;
            buffer.startTime = buffer.prepareTime + 2000;
            let y = ballPos.coords[1];
            if (y > 0) y = pitchHalfH;
            else y = -pitchHalfH;
            buffer.restartPos = new Vector3(pitchHalfW * lastSide, y, 0);
            buffer.teamID = Math.abs(lastTouchTeam.GetID() - 1);
          } else {
            buffer.desiredSetPiece = e_SetPiece.e_SetPiece_GoalKick;
            buffer.stopTime = match.GetActualTime_ms();
            buffer.prepareTime = match.GetActualTime_ms() + 2000;
            buffer.startTime = buffer.prepareTime + 2000;
            buffer.restartPos = new Vector3(pitchHalfW * 0.92 * -lastSide, 0, 0);
            buffer.teamID = Math.abs(lastTouchTeam.GetID() - 1);
          }

          buffer.active = true;
        }
      }

      // over sideline

      if (this.afterSetPieceRelaxTime_ms === 0) {
        if (Math.abs(ballPos.coords[1]) > pitchHalfH + lineHalfW + 0.11) {
          this.foul.advantage = false;
          if (!this.CheckFoul()) {
            match.StopPlay();
            let lastTouchTeam = match.GetLastTouchTeam();
            if (!lastTouchTeam) lastTouchTeam = match.GetTeam(0);
            buffer.teamID = Math.abs(lastTouchTeam.GetID() - 1);
            buffer.desiredSetPiece = e_SetPiece.e_SetPiece_ThrowIn;
            buffer.stopTime = match.GetActualTime_ms();
            buffer.prepareTime = match.GetActualTime_ms() + 2000;
            buffer.startTime = buffer.prepareTime + 2000;
            let restartY = buffer.restartPos.coords[1];
            if (ballPos.coords[1] > 0) restartY = pitchHalfH;
            if (ballPos.coords[1] <= 0) restartY = -pitchHalfH;
            buffer.restartPos = new Vector3(clamp(ballPos.coords[0], -pitchHalfW + 0.6, pitchHalfW - 0.6), restartY, 0);
            buffer.active = true;
          }
        }
      }

      this.CheckFoul();
    } else {
      // not in play, maybe something needs to happen?

      if (!match.IsInPlay() && !match.IsInSetPiece() && buffer.active === true) {
        if (buffer.stopTime + 300 === match.GetActualTime_ms() && buffer.endPhase === false && buffer.desiredSetPiece !== e_SetPiece.e_SetPiece_KickOff) {
          this.whistle[1].SetGain(0.3 * GetConfiguration().GetReal('audio_volume', 0.5));
          this.whistle[1].Poke();
        }

        if (buffer.prepareTime === match.GetActualTime_ms()) {
          if (buffer.endPhase === true) {
            if (match.GetMatchPhase() === e_MatchPhase.e_MatchPhase_PreMatch) {
              match.SetMatchPhase(e_MatchPhase.e_MatchPhase_1stHalf);
            } else {
              // game over conditions
              if (match.GetMatchPhase() === e_MatchPhase.e_MatchPhase_1stExtraTime) {
                if (match.GetScore(0) !== match.GetScore(1)) {
                  match.GameOver();
                  return;
                }
              }
              if (match.GetMatchPhase() === e_MatchPhase.e_MatchPhase_Penalties) {
                match.GameOver();
                return;
              }
              match.sig_OnMatchPhaseChange.emit(match);
            }
            buffer.endPhase = false;
          }

          this.PrepareSetPiece(buffer.desiredSetPiece);
        }

        if (buffer.startTime === match.GetActualTime_ms()) {
          // blow whistle and wait for set piece taker to touch the ball
          this.whistle[1].SetGain(0.3 * GetConfiguration().GetReal('audio_volume', 0.5));
          this.whistle[1].Poke();
          match.StartPlay();
          match.StartSetPiece();
        }
      }
    }

    if (match.IsInSetPiece()) {
      // check if set piece has been taken
      const taker = buffer.taker!;
      if (taker.TouchAnim() && !taker.TouchPending()) {
        buffer.active = false;
        match.StopSetPiece();
        match.GetTeam(0).GetController().PrepareSetPiece(e_SetPiece.e_SetPiece_None);
        match.GetTeam(1).GetController().PrepareSetPiece(e_SetPiece.e_SetPiece_None);
        this.afterSetPieceRelaxTime_ms = 400;
        this.foul.foulPlayer = null;
        this.foul.foulType = 0;

        if (match.GetMatchPhase() === e_MatchPhase.e_MatchPhase_PreMatch) {
          match.SetMatchPhase(e_MatchPhase.e_MatchPhase_1stHalf);
        }
      }
    }

    if (this.afterSetPieceRelaxTime_ms > 0) this.afterSetPieceRelaxTime_ms -= 10;
  }

  PrepareSetPiece(setPiece: e_SetPiece): void {
    // position players for set piece situation

    this.match.ResetSituation(this.buffer.restartPos);

    this.match.GetTeam(0).GetController().PrepareSetPiece(setPiece, this.buffer.teamID);
    this.match.GetTeam(1).GetController().PrepareSetPiece(setPiece, this.buffer.teamID);

    this.buffer.taker = this.match.GetTeam(this.buffer.teamID).GetController().GetPieceTaker();
  }

  /** C++ returns a const reference: don't modify */
  GetBuffer(): RefereeBuffer {
    return this.buffer;
  }

  AlterSetPiecePrepareTime(newTime_ms: number): void {
    if (this.buffer.active) {
      this.buffer.prepareTime = newTime_ms;
      this.buffer.startTime = this.buffer.prepareTime + 2000;
    }
  }

  BallTouched(): void {
    const match = this.match;
    const buffer = this.buffer;

    // check for offside player receiving the ball

    const lastTouchTeamID = match.GetLastTouchTeamID();
    if (lastTouchTeamID === -1) return; // shouldn't happen really ;)
    if (match.IsInPlay() && !match.IsInSetPiece() && buffer.active === false && match.GetTeam(Math.abs(lastTouchTeamID - 1)).GetActivePlayerCount() > 1) {
      // disable if only 1 player: that's debug mode with only keeper
      for (const [player, position] of this.offsidePlayers) {
        if (match.GetTeam(lastTouchTeamID).GetLastTouchPlayer() === player) {
          this.foul.advantage = false;
          if (!this.CheckFoul()) {
            // uooooga uooooga offside!
            match.StopPlay();
            buffer.desiredSetPiece = e_SetPiece.e_SetPiece_FreeKick;
            buffer.stopTime = match.GetActualTime_ms();
            buffer.prepareTime = match.GetActualTime_ms() + 2000;
            buffer.startTime = buffer.prepareTime + 2000;
            buffer.restartPos = position;
            buffer.teamID = Math.abs(lastTouchTeamID - 1);
            buffer.active = true;
            match.SpamMessage('offside!');
            break;
          } else break;
        }
      }
    }

    this.offsidePlayers.clear();

    if (match.IsInPlay() && (buffer.active === false || (buffer.active === true && buffer.desiredSetPiece !== e_SetPiece.e_SetPiece_ThrowIn))) {
      // check for offside players at moment of touch
      const offside = AI_GetOffsideLine(match, match.GetMentalImage(0), Math.abs(lastTouchTeamID - 1));
      const players: Player[] = [];
      const team = match.GetTeam(lastTouchTeamID);
      match.GetTeam(lastTouchTeamID).GetActivePlayers(players);
      for (let i = 0; i < players.length; i++) {
        if (players[i] !== team.GetLastTouchPlayer()) {
          if (players[i].GetPosition().coords[0] * team.GetSide() < offside * team.GetSide() - 0.2 /*relax*/) {
            if (!this.offsidePlayers.has(players[i])) this.offsidePlayers.set(players[i], players[i].GetPosition());
          }
        }
      }
    }
  }

  /** tackleType: 1 == standing tackle resulting in little trip, 2 == standing tackle resulting in fall, 3 == sliding tackle */
  TripNotice(tripee: Player, tripper: Player, tackleType: number): void {
    const match = this.match;
    const foul = this.foul;

    if (this.buffer.active) return;

    if (tackleType === 2) {
      // standing tackle
      if (
        tripee.GetTeam().GetFadingTeamPossessionAmount() > 1.1 &&
        (tripper.GetCurrentFunctionType() === e_FunctionType.e_FunctionType_Interfere || tripper.GetCurrentFunctionType() === e_FunctionType.e_FunctionType_Sliding) &&
        tripee.GetPosition().Sub(match.GetBall().Predict(0).Get2D()).GetLength() < 2.0 &&
        tripper.GetTeam().GetID() !== tripee.GetTeam().GetID()
      ) {
        // uooooga uooooga foul!
        foul.foulType = 1;
        foul.advantage = true;
        foul.foulPlayer = tripper;
        foul.foulVictim = tripee;
        foul.foulTime = match.GetActualTime_ms();
        foul.foulPosition = tripee.GetPosition();
        foul.hasBeenProcessed = false;
        if (!IsReleaseVersion()) match.SpamMessage('advantage', 2000);
      }
    } else if (tackleType === 3 && (tripper !== foul.foulPlayer || foul.foulType === 0)) {
      // sliding tackle

      if (
        match.GetActualTime_ms() - tripper.GetLastTouchTime_ms() > 600 &&
        tripper.GetCurrentFunctionType() === e_FunctionType.e_FunctionType_Sliding &&
        tripper.GetTeam().GetID() !== tripee.GetTeam().GetID() &&
        match.GetBall().Predict(0).Sub(tripee.GetPosition()).GetLength() < 8.0
      ) {
        let severity = 1.0;
        if (tripper.TouchAnim()) {
          severity = Math.pow(clamp(Math.abs(tripper.GetTouchFrame() - tripper.GetCurrentFrame()) / tripper.GetTouchFrame(), 0.0, 1.0), 0.7) * 0.5;
          severity += NormalizedClamp(match.GetBall().Predict(0).Sub(tripper.GetTouchPos()).GetLength(), 0.0, 2.0) * 0.5;
        }
        // from behind?
        severity += tripee.GetPosition().Sub(tripper.GetPosition()).GetNormalized(0).GetDotProduct(tripee.GetDirectionVec()) * 0.5 + 0.5;

        if (severity > 1.0) {
          // uooooga uooooga foul!
          foul.foulType = 1;
          foul.advantage = true;
          foul.foulPlayer = tripper;
          foul.foulVictim = tripee;
          foul.foulTime = match.GetActualTime_ms();
          foul.foulPosition = tripee.GetPosition();
          foul.hasBeenProcessed = false;
          if (severity > 1.4) foul.foulType = 2;
          if (severity > 2.0) {
            foul.foulType = 3;
            foul.advantage = false;
          } else {
            if (!IsReleaseVersion()) match.SpamMessage('advantage', 3000);
          }
        }
      }
    }
  }

  CheckFoul(): boolean {
    const match = this.match;
    const foul = this.foul;
    const buffer = this.buffer;

    let penalty = false;
    if (foul.foulType !== 0) {
      if (Math.abs(foul.foulPosition.coords[1]) < 20.15 - lineHalfW && foul.foulPosition.coords[0] * -foul.foulVictim!.GetTeam().GetSide() > pitchHalfW - 16.5 + lineHalfW) penalty = true;
    }

    if (foul.advantage) {
      if (penalty) {
        foul.advantage = false;
      } else {
        if (match.GetActualTime_ms() - 600 > foul.foulTime) {
          if (match.GetActualTime_ms() - 3000 > foul.foulTime) {
            // cancel foul, advantage took long enough
            // todo: yellow cards need to be remembered though ;)
            foul.foulPlayer = null;
            foul.foulType = 0;
          } else {
            // calculate if there's advantage still
            if (foul.foulVictim!.GetTeam().GetFadingTeamPossessionAmount() < 1.0) {
              foul.advantage = false;
            }
          }
        }
      }
    }

    if (foul.foulType !== 0 && foul.advantage === false && !foul.hasBeenProcessed) {
      match.StopPlay();
      if (!penalty) {
        buffer.desiredSetPiece = e_SetPiece.e_SetPiece_FreeKick;
        buffer.stopTime = match.GetActualTime_ms();
        buffer.prepareTime = match.GetActualTime_ms() + 2000;
        if (foul.foulType >= 2) buffer.prepareTime += 10000;
        buffer.startTime = buffer.prepareTime + 2000;
        buffer.restartPos = foul.foulPosition;
      } else {
        buffer.desiredSetPiece = e_SetPiece.e_SetPiece_Penalty;
        buffer.stopTime = match.GetActualTime_ms();
        buffer.prepareTime = match.GetActualTime_ms() + 2000;
        if (foul.foulType >= 2) buffer.prepareTime += 10000;
        buffer.startTime = buffer.prepareTime + 2000;
        buffer.restartPos = new Vector3((pitchHalfW - 11.0) * foul.foulPlayer!.GetTeam().GetSide(), 0, 0);
      }
      buffer.teamID = foul.foulVictim!.GetTeam().GetID();
      buffer.active = true;
      let spamMessage = 'foul!';
      if (foul.foulType === 2) {
        spamMessage += ' yellow card';
        foul.foulPlayer!.GiveYellowCard(match.GetActualTime_ms() + 6000); // need to find out proper moment
      }
      if (foul.foulType === 3) {
        spamMessage += ' red card!!!';
        foul.foulPlayer!.GiveRedCard(match.GetActualTime_ms() + 6000); // need to find out proper moment
      }
      match.SpamMessage(spamMessage);

      foul.hasBeenProcessed = true;

      return true;
    }

    return false;
  }

  GetCurrentFoulPlayer(): Player | null {
    return this.foul.foulPlayer;
  }

  GetCurrentFoulType(): number {
    return this.foul.foulType;
  }
}
