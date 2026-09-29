import { beforeAll, describe, expect, it } from 'vitest';
import { installDiskFileSystem } from './helpers';
import { Vector3 } from '../src/blunted/base/math/vector3';
import { Database } from '../src/game/data/database';
import { SetDB } from '../src/game/globals';
import { Gui2WindowManager } from '../src/game/ui/gui2';
import { Gui2ScoreBoard } from '../src/game/menu/ingame/scoreboard';
import { Gui2Radar } from '../src/game/menu/ingame/radar';
import { Gui2TacticsDebug } from '../src/game/menu/ingame/tacticsdebug';
import type { Match } from '../src/game/onthepitch/match';
import { LoadConfiguration } from '../src/ui/config';
import { getLeagueGroups, getOrderedTeamIDs, getTeamInfo } from '../src/ui/teams';

beforeAll(() => {
  installDiskFileSystem();
  SetDB(Database.LoadDefault());
});

function fakeMatch(): Match {
  const teamData = (short: string) => ({
    GetName: () => short + ' FC',
    GetShortName: () => short,
    GetLogoUrl: () => '',
    GetColor1: () => new Vector3(255, 50, 50),
    GetColor2: () => new Vector3(255, 255, 255),
  });
  const player = { GetPosition: () => new Vector3(10, 5, 0) };
  return {
    GetTeam: (i: number) => ({ GetTeamData: () => teamData(i === 0 ? 'AAA' : 'BBB') }),
    GetBall: () => ({ Predict: () => new Vector3(0, 0, 0) }),
    GetActiveTeamPlayers: (_teamID: number, players: unknown[]) => {
      players.push(player);
    },
  } as unknown as Match;
}

describe('in-match widgets without a DOM', () => {
  it('are inert but keep their C++ API', () => {
    const wm = new Gui2WindowManager();
    const match = fakeMatch();
    const scoreboard = new Gui2ScoreBoard(wm, match);
    scoreboard.SetTimeStr('12:34');
    scoreboard.SetGoalCount(0, 1);
    scoreboard.SetGoalCount(1, 2);
    const radar = new Gui2Radar(wm, 'game_radar', 38, 78, 24, 18, match, new Vector3(255, 50, 50), new Vector3(255), new Vector3(255, 50, 50), new Vector3(0));
    radar.Put();
    const debug = new Gui2TacticsDebug(wm, 'game_tacticsdebug', 22, 1.3, 56, 26, match);
    expect(debug.AddEntry('dribble_offensiveness', new Vector3(255), new Vector3(128), new Vector3(0))).toBe(1);
    debug.SetValue(0, 0, 1, 0.5);
    debug.Redraw();
    for (const v of [scoreboard, radar, debug]) v.Exit();
  });
});

describe('team presentation', () => {
  it('computes ratings from the players base_stat', () => {
    const info = getTeamInfo(1);
    expect(info.shortName).toBe('AJA');
    expect(info.leagueName).toBe('Voetbalcompetitie');
    expect(info.overall).toBeGreaterThan(40);
    expect(info.overall).toBeLessThan(90);
    expect(info.logo).toMatch(/^\.\/data\/databases\/default\/images_teams\//);
    expect(info.color1).toBe('rgb(255, 50, 50)');
  });
  it('groups all teams by league', () => {
    const groups = getLeagueGroups();
    expect(groups.length).toBe(4);
    expect(groups.reduce((n, g) => n + g.teams.length, 0)).toBe(8);
    expect(getOrderedTeamIDs().length).toBe(8);
  });
});

describe('configuration', () => {
  it('loads defaults when localStorage is unavailable', () => {
    const config = LoadConfiguration('"match_duration" "0.7"\n"graphics_quality" "low"\n');
    expect(config.GetReal('match_duration', 0)).toBeCloseTo(0.7);
    expect(config.Get('graphics_quality')).toBe('low');
  });
});
