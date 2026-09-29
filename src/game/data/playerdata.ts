// Port of legacy/src/data/playerdata.{hpp,cpp}. Original: written by bastiaan konings schuiling 2008 - 2015 (public domain / Apache-2.0).

import { Properties } from '../../blunted/base/properties';
import { assert } from '../../blunted/base/assert';
import { atof, tokenize } from '../../blunted/base/utils';
import { cround, random } from '../../blunted/base/math/bluntmath';
import { XMLLoader } from '../../blunted/utils/xmlloader';
import { GetRoleFromString, type e_PlayerRole } from '../gamedefines';
import { CalculateStat, e_DevelopmentCurveType } from '../footballutils';
import { GetDB } from '../globals';

export class PlayerData {
  protected databaseID = 0;
  protected firstName = '';
  protected lastName = '';
  protected roles: e_PlayerRole[] = [];

  protected stats = new Properties();

  protected skinColor = 0;
  protected hairStyle = '';
  protected hairColor = '';
  protected height = 0;

  /**
   * C++ PlayerData(int playerDatabaseID) (loads the player from the database: GetDB().GetPlayer(id))
   * and PlayerData() (officials, for example, use this constructor).
   */
  constructor(playerDatabaseID?: number) {
    if (playerDatabaseID === undefined) {
      this.InitDefault();
      return;
    }

    this.databaseID = playerDatabaseID;

    // C++: select firstname, lastname, role, base_stat, profile_xml, age, skincolor, hairstyle, haircolor, height from players where id = X limit 1
    const record = GetDB().GetPlayer(this.databaseID);

    let roleString = '';
    let profileString = '';
    let baseStat = 0.0;
    let age = 15;

    this.skinColor = Math.trunc(cround(random(1, 4)));
    this.hairStyle = 'short01';
    this.hairColor = 'darkblonde';
    this.height = 1.8;

    // PORT: the SQL result columns were strings parsed with atof/atoi; the JSON records hold typed values
    this.firstName = String(record.firstname ?? '');
    this.lastName = String(record.lastname ?? '');
    roleString = String(record.role ?? '');
    baseStat = atof(String(record.base_stat));
    profileString = String(record.profile_xml ?? '');
    age = Math.trunc(atof(String(record.age)));
    this.skinColor = Math.trunc(atof(String(record.skincolor)));
    this.hairStyle = String(record.hairstyle ?? '');
    this.hairColor = String(record.haircolor ?? '');
    this.height = atof(String(record.height));

    const roleStrings: string[] = [];
    tokenize(roleString, roleStrings);

    for (let i = 0; i < roleStrings.length; i++) {
      this.roles.push(GetRoleFromString(roleStrings[i]));
    }

    // get average stat for current age

    const loader = new XMLLoader();
    const tree = loader.Load(profileString);

    for (const [statName, child] of tree.children) {
      const profileStat = atof(child.value); // profile value

      const value = CalculateStat(baseStat, profileStat, age, e_DevelopmentCurveType.e_DevelopmentCurveType_Normal);

      this.stats.Set(statName, value);
    }
  }

  protected InitDefault(): void {
    // officials, for example, use this constructor
    this.skinColor = Math.trunc(cround(random(1, 4)));
    this.hairStyle = 'short01';
    this.hairColor = 'darkblonde';
    this.height = 1.8;

    this.stats.Set('physical_balance', 0.6);
    this.stats.Set('physical_reaction', 0.6);
    this.stats.Set('physical_acceleration', 0.6);
    this.stats.Set('physical_velocity', 0.6);
    this.stats.Set('physical_stamina', 0.6);
    this.stats.Set('physical_agility', 0.6);
    this.stats.Set('physical_shotpower', 0.6);
    this.stats.Set('technical_standingtackle', 0.6);
    this.stats.Set('technical_slidingtackle', 0.6);
    this.stats.Set('technical_ballcontrol', 0.6);
    this.stats.Set('technical_dribble', 0.6);
    this.stats.Set('technical_shortpass', 0.6);
    this.stats.Set('technical_highpass', 0.6);
    this.stats.Set('technical_header', 0.6);
    this.stats.Set('technical_shot', 0.6);
    this.stats.Set('technical_volley', 0.6);
    this.stats.Set('mental_calmness', 0.6);
    this.stats.Set('mental_workrate', 0.6);
    this.stats.Set('mental_resilience', 0.6);
    this.stats.Set('mental_defensivepositioning', 0.6);
    this.stats.Set('mental_offensivepositioning', 0.6);
    this.stats.Set('mental_vision', 0.6);
  }

  GetFirstName(): string {
    return this.firstName;
  }

  GetLastName(): string {
    return this.lastName;
  }

  GetDatabaseID(): number {
    return this.databaseID;
  }

  GetRoles(): e_PlayerRole[] {
    return this.roles;
  }

  GetStat(name: string): number {
    const exists = this.stats.Exists(name);
    if (!exists) console.error(`Stat named '${name}' does not exist!`);
    assert(exists);
    return this.stats.GetReal(name, 1.0);
  }

  GetSkinColor(): number {
    return this.skinColor;
  }

  GetHairStyle(): string {
    return this.hairStyle;
  }

  GetHairColor(): string {
    return this.hairColor;
  }

  GetHeight(): number {
    return this.height;
  }
}
