// Goal replays. The C++ game answered Match::sig_OnExtendedReplayMoment (6 s after a goal, with
// the match paused) with its replay page, which auto-ran the replay buffer at real-time speed
// from the "cam 1" replay camera and unpaused the match when done (legacy/src/menu/ingame/
// replaymenu.cpp, gamepage.cpp). This reproduces that flow for the browser runtime; the pass or
// shot button skips the replay.

import { clamp } from '../blunted/base/math/bluntmath';
import { GetControllers, GetScheduler } from '../game/globals';
import { e_ButtonFunction } from '../game/hid/ihidevice';
import type { Match } from '../game/onthepitch/match';

/** how much of the replay buffer is shown (the original buffer holds 10 s) */
const replayLength_ms = 7000;
const replayCam = 1;

export class ReplayDirector {
  protected active = false;
  protected viewTime_ms = 0;
  protected minTime_ms = 0;
  protected maxTime_ms = 0;
  protected badge: HTMLElement | null = null;
  protected readonly slot = (): void => this.Start();

  constructor(protected match: Match, protected hudParent: HTMLElement | null = typeof document !== 'undefined' ? document.getElementById('hud') : null) {
    match.sig_OnExtendedReplayMoment.connect(this.slot);
  }

  IsActive(): boolean {
    return this.active;
  }

  protected Start(): void {
    if (this.active) return;
    const match = this.match;
    this.active = true;
    match.SetAutoUpdateIngameCamera(false);
    this.minTime_ms = Math.max(10, match.GetActualTime_ms() - match.GetReplaySize_ms());
    this.maxTime_ms = Math.max(10, match.GetActualTime_ms() - 10);
    this.viewTime_ms = clamp(this.maxTime_ms - replayLength_ms, this.minTime_ms, this.maxTime_ms);
    this.Feed();
    this.ShowBadge(true);
  }

  /** one 10 ms game step: advances the replay at real-time speed */
  Step(): void {
    if (!this.active) return;
    if (this.SkipPressed()) {
      this.Stop();
      return;
    }
    this.viewTime_ms += 10;
    if (this.viewTime_ms >= this.maxTime_ms) {
      this.Stop();
      return;
    }
    this.Feed();
  }

  /** ends the replay and resumes the match (C++ ReplayPage::OnClose) */
  Stop(): void {
    if (!this.active) return;
    const match = this.match;
    match.replayState.viewTime_ms = this.maxTime_ms;
    match.replayState.cam = replayCam;
    match.replayState.modifierValue = 0;
    match.replayState.dirty = true;
    GetScheduler().ResetTaskSequenceTime('game');
    match.SetAutoUpdateIngameCamera(true);
    match.Pause(false);
    this.active = false;
    this.ShowBadge(false);
  }

  Exit(): void {
    this.match.sig_OnExtendedReplayMoment.disconnect(this.slot);
    this.ShowBadge(false);
  }

  protected Feed(): void {
    const state = this.match.replayState;
    state.viewTime_ms = this.viewTime_ms;
    state.cam = replayCam;
    state.modifierValue = 0;
    state.dirty = true;
  }

  protected SkipPressed(): boolean {
    for (const c of GetControllers()) {
      for (const f of [e_ButtonFunction.e_ButtonFunction_ShortPass, e_ButtonFunction.e_ButtonFunction_Shot]) {
        if (c.GetButton(f) && !c.GetPreviousButtonState(f)) return true;
      }
    }
    return false;
  }

  protected ShowBadge(show: boolean): void {
    if (!this.hudParent) return;
    if (show && !this.badge) {
      this.badge = document.createElement('div');
      this.badge.className = 'replay-badge';
      this.badge.innerHTML = '<span class="replay-badge__dot"></span>Replay<small>pass or shoot to skip</small>';
      this.hudParent.appendChild(this.badge);
    } else if (!show && this.badge) {
      this.badge.remove();
      this.badge = null;
    }
  }
}
