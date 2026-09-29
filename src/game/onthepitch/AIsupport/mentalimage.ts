// Port of legacy/src/onthepitch/AIsupport/mentalimage.{hpp,cpp}. Original: written by bastiaan konings schuiling 2008 - 2015 (public domain / Apache-2.0).
//
// A snapshot of the match state (players and ball predictions) as a player perceives it, to be read back later with
// a reaction time delay (Match keeps a history of these, one per 10ms).
//
// PORT: GetPlayerImage() and GetTeamPlayerImages() return FRESH PlayerImage copies on every call (like the by-value
// C++ returns), so callers may modify the returned images freely.

import { Vector3 } from '../../../blunted/base/math/vector3';
import { assert } from '../../../blunted/base/assert';
import { PlayerImage, ballPredictionSize_ms, walkVelocity } from '../../gamedefines';
import type { Match } from '../match';
import type { Player } from '../player/player';

export class MentalImage {
  protected match: Match;

  protected players: PlayerImage[] = [];
  protected ballPredictions: Vector3[] = [];

  protected timeStampNeg_ms = 0;

  protected maxDistanceDeviation: number;
  protected maxMovementDeviation: number;

  constructor(match: Match) {
    this.match = match;
    this.timeStampNeg_ms = 0;
    this.maxDistanceDeviation = 2.5; // if reality is this much (or more) off from mental image, enforce as maximum offset
    this.maxMovementDeviation = walkVelocity;
    for (let i = 0; i < ballPredictionSize_ms / 10; i++) this.ballPredictions.push(new Vector3(0));
  }

  TakeSnapshot(): void {
    this.players = [];

    const allPlayers: Player[] = [];
    this.match.GetTeam(0).GetActivePlayers(allPlayers);
    this.match.GetTeam(1).GetActivePlayers(allPlayers);

    for (let playerCounter = 0; playerCounter < allPlayers.length; playerCounter++) {
      const player = allPlayers[playerCounter];

      const playerImage = new PlayerImage();
      playerImage.teamID = player.GetTeamID();
      playerImage.side = player.GetTeam().GetSide();
      playerImage.playerID = player.GetID();
      playerImage.player = player;
      playerImage.position = player.GetPosition();
      playerImage.directionVec = player.GetDirectionVec();
      playerImage.bodyDirectionVec = player.GetBodyDirectionVec();
      playerImage.velocity = player.GetFloatVelocity();
      playerImage.movement = player.GetMovement();
      // C++ copied these structs by value into the snapshot
      playerImage.formationEntry = player.GetFormationEntry().Clone();
      playerImage.dynamicFormationEntry = player.GetDynamicFormationEntry().Clone();
      this.players.push(playerImage);
    }

    this.UpdateBallPredictions();
  }

  /** returns a fresh copy, extrapolated to the current time (clamped to reality by maxDistanceDeviation) */
  GetPlayerImage(playerID: number): PlayerImage {
    const extrapolationTime_sec = this.GetTimeStampNeg_ms() * 0.001;
    for (let playerCounter = 0; playerCounter < this.players.length; playerCounter++) {
      const src = this.players[playerCounter];
      if (src.playerID === playerID) {
        const newImage = src.Clone();
        const player = newImage.player as Player;
        const extrapolation = src.movement.Mul(extrapolationTime_sec);
        newImage.position = src.position.Add(extrapolation);
        newImage.position = newImage.position.EnforceMaximumDeviation(player.GetPosition(), this.maxDistanceDeviation);
        newImage.movement = newImage.movement.EnforceMaximumDeviation(player.GetMovement(), this.maxMovementDeviation);
        return newImage;
      }
    }

    // failsafe
    return this.players[0].Clone();
  }

  /** C++ GetTeamPlayerImages(teamID, exceptPlayerID, std::vector<PlayerImage> &playerImages): pushes fresh copies into playerImages */
  GetTeamPlayerImages(teamID: number, exceptPlayerID: number, playerImages: PlayerImage[]): PlayerImage[] {
    const extrapolationTime_sec = this.GetTimeStampNeg_ms() * 0.001;
    for (let playerCounter = 0; playerCounter < this.players.length; playerCounter++) {
      const src = this.players[playerCounter];
      // PORT: the C++ looked the player up through match->GetPlayer(playerID); the snapshot holds that same player
      const player = src.player;
      assert(player);
      if (player!.IsActive() && player!.GetTeamID() === teamID && player!.GetID() !== exceptPlayerID) {
        const newImage = src.Clone();
        const extrapolation = src.movement.Mul(extrapolationTime_sec);
        newImage.position = src.position.Add(extrapolation);
        newImage.position = newImage.position.EnforceMaximumDeviation(player!.GetPosition(), this.maxDistanceDeviation);
        newImage.movement = newImage.movement.EnforceMaximumDeviation(player!.GetMovement(), this.maxMovementDeviation); // new
        playerImages.push(newImage);
      }
    }
    return playerImages;
  }

  UpdateBallPredictions(): void {
    // cleared first so this works whether Ball fills the array by index or by push
    this.ballPredictions.length = 0;
    this.match.GetBall().GetPredictionArray(this.ballPredictions);
  }

  GetBallPrediction(time_ms: number): Vector3 {
    // emulate the unsigned int arithmetic of the original (negative values wrap around, and thus clamp to the end)
    let index = (Math.trunc(time_ms) + this.timeStampNeg_ms) >>> 0;
    if (index >= ballPredictionSize_ms) index = ballPredictionSize_ms - 10;
    index = Math.trunc(index / 10);

    const mentalResult = this.ballPredictions[index];
    const realResult = this.match.GetBall().Predict(time_ms);

    // let there be a maximum difference between the two. why?
    // when a ball gets a wholly new movement, this prediction is obviously far off reality, while some variables are not,
    // like the player->gettimeneededtogettoball, since that is based on non-delayed vars.
    // a solution would be to have a reaction-time-corrected version of everything, but that is, for now, too complicated.
    // maybe one day rebuild the whole timeneeded/tactics calculations system

    const result = mentalResult.EnforceMaximumDeviation(realResult, this.maxDistanceDeviation);

    return result;
  }

  SetTimeStampNeg_ms(history_ms: number): void {
    // C++: unsigned int
    this.timeStampNeg_ms = Math.trunc(history_ms) >>> 0;
  }

  GetTimeStampNeg_ms(): number {
    return this.timeStampNeg_ms;
  }
}
