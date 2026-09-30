// Character creator: identity, appearance (with a live portrait painted from the game's skin
// and hair textures), position/foot/talent/traits, the academy (country -> club, hometown) and
// options. Builds the world for a fresh seed so the club list is exactly the career's world.

import { dataUrl, h } from '../../../ui/dom';
import { back, type Screen } from '../../../ui/router';
import { withNav } from '../../../ui/nav';
import { screenFrame, showToast } from '../../../ui/widgets';
import { GetDB } from '../../../game/globals';
import type { DatabaseTables } from '../../../game/data/database';
import { POSITION_NAMES, type Position } from '../../core/attributes';
import { newCareer, previewWorld } from '../../core/career';
import { COUNTRIES, NATIONS, nationName } from '../../core/data/geography';
import { randomName } from '../../core/data/names';
import { TALENTS, TRAITS, type CreatorInput, type Talent } from '../../core/footballer';
import { Rng } from '../../core/rng';
import { saveToSlot, type KV } from '../../core/save';
import type { TraitKey, World } from '../../core/types';
import { CareerApp } from '../app';
import { HAIR_COLORS, HAIR_COLOR_NAMES, HAIR_STYLES, HAIR_STYLE_NAMES, avatar, clubCrestUrl, pill, stars } from '../components';

const STEPS = ['Identity', 'Look', 'Player', 'Academy', 'Start'];
const PITCH: Record<Position, [number, number]> = { GK: [90, 50], CB: [75, 50], LB: [70, 16], RB: [70, 84], DM: [60, 50], CM: [47, 50], AM: [34, 50], LM: [30, 16], RM: [30, 84], CF: [15, 50] };
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function dbTables(): DatabaseTables | null {
  try {
    return GetDB() as unknown as DatabaseTables;
  } catch {
    return null;
  }
}

export function createCreatorScreen(kv: KV | null, slot: number): Screen {
  const seed = Math.floor(Math.random() * 2 ** 31);
  const db = dbTables();
  const world: World = previewWorld(seed, db);
  const rng = new Rng(seed);
  const nat = 'ENG';
  const name = randomName(rng, nat);
  const input: CreatorInput & { hometown: number | null; country: string } = {
    first: name.first,
    last: name.last,
    nat,
    age: 15,
    birthMonth: rng.int(1, 12),
    birthDay: rng.int(1, 28),
    pos: 'CF',
    foot: 'R',
    height: 1.8,
    weight: 73,
    skin: 1,
    hair: 'short02',
    hairColor: 'brown',
    traits: ['ambitious'],
    talent: 'promising',
    clubId: -1,
    romance: true,
    difficulty: 'normal',
    shirt: 9,
    hometown: null,
    country: 'ENG',
  };
  let step = 0;
  const frameHost = h('div', { class: 'cc-creator-host' });
  const screen = withNav({ el: frameHost }, { onBack: () => (step > 0 ? go(step - 1) : back()) });

  const clubsOf = (country: string) => world.clubs.filter((c) => c.countryKey === country).sort((a, b) => b.reputation - a.reputation);
  const pickDefaultClub = () => {
    const list = clubsOf(input.country);
    // a mid-table academy is a good start
    input.clubId = list[Math.min(list.length - 1, Math.floor(list.length * 0.35))].id;
  };
  pickDefaultClub();

  const preview = () => {
    const club = world.clubs[input.clubId];
    return h(
      'aside',
      { class: 'cc-creator-preview' },
      avatar({ skin: input.skin, hair: input.hair, hairColor: input.hairColor, shirt: club?.colors, number: input.shirt }, 190),
      h('h3', {}, `${input.first || '—'} ${input.last || ''}`),
      h('p', { class: 'cc-dim' }, `${nationName(input.nat)} · ${input.age} · ${POSITION_NAMES[input.pos]}`),
      h('p', { class: 'cc-dim' }, `${Math.round(input.height * 100)} cm · ${input.weight} kg · ${input.foot === 'L' ? 'left' : 'right'} foot`),
      club ? h('div', { class: 'cc-creator-club' }, h('img', { class: 'cc-crest cc-crest--sm', src: clubCrestUrl(club), alt: '' }), h('span', {}, `${club.name} Academy`)) : null,
      h('div', { class: 'cc-pills' }, pill(TALENTS.find((t) => t.key === input.talent)!.name, 'gold'), ...input.traits.map((t) => pill(TRAITS.find((x) => x.key === t)!.name, 'info'))),
    );
  };

  const field = (label: string, control: HTMLElement) => h('label', { class: 'cc-field' }, h('span', {}, label), control);
  const choiceRow = <T>(values: T[], current: T, label: (v: T) => Node | string, onPick: (v: T) => void, className = '') =>
    h('div', { class: `cc-choice-row ${className}` }, ...values.map((v) => h('button', { class: `cc-choice-chip ${v === current ? 'is-selected' : ''}`, type: 'button', onclick: () => (onPick(v), render()) }, label(v))));

  function stepBody(): HTMLElement {
    if (step === 0) {
      const first = h('input', { class: 'cc-input', value: input.first, maxlength: '20', 'aria-label': 'First name', oninput: () => (input.first = first.value.trim()) });
      const last = h('input', { class: 'cc-input', value: input.last, maxlength: '24', 'aria-label': 'Last name', oninput: () => (input.last = last.value.trim()) });
      const natSel = h('select', { class: 'cc-select', 'aria-label': 'Nationality', onchange: () => ((input.nat = natSel.value), render()) }, ...[...COUNTRIES.map((c) => ({ key: c.key, name: c.name })), ...NATIONS.map((n) => ({ key: n.key, name: n.name }))].map((n) => h('option', { value: n.key, selected: n.key === input.nat ? true : undefined }, n.name)));
      const month = h('select', { class: 'cc-select', 'aria-label': 'Birth month', onchange: () => (input.birthMonth = Number(month.value)) }, ...MONTHS.map((m, i) => h('option', { value: String(i + 1), selected: i + 1 === input.birthMonth ? true : undefined }, m)));
      const day = h('select', { class: 'cc-select', 'aria-label': 'Birth day', onchange: () => (input.birthDay = Number(day.value)) }, ...Array.from({ length: 28 }, (_, i) => h('option', { value: String(i + 1), selected: i + 1 === input.birthDay ? true : undefined }, String(i + 1))));
      const shirt = h('input', { class: 'cc-input cc-input--short', type: 'number', min: '1', max: '99', value: String(input.shirt), 'aria-label': 'Shirt number', oninput: () => (input.shirt = Math.max(1, Math.min(99, Number(shirt.value) || 9))) });
      return h(
        'div',
        { class: 'cc-creator-form' },
        h('div', { class: 'cc-field-row' }, field('First name', first), field('Last name', last)),
        h(
          'button',
          {
            class: 'cc-link',
            type: 'button',
            onclick: () => {
              const n = randomName(new Rng(Math.random() * 1e9), input.nat);
              input.first = n.first;
              input.last = n.last;
              render();
            },
          },
          'Random name for this nationality',
        ),
        field('Nationality', natSel),
        h('div', { class: 'cc-field-row' }, field('Age at the start', choiceRow([15, 16] as (15 | 16)[], input.age, (v) => `${v}`, (v) => (input.age = v))), field('Birthday', h('div', { class: 'cc-field-row' }, day, month)), field('Shirt number', shirt)),
      );
    }
    if (step === 1) {
      const height = h('input', { class: 'cc-range', type: 'range', min: '162', max: '200', value: String(Math.round(input.height * 100)), 'aria-label': 'Height', oninput: () => ((input.height = Number(height.value) / 100), (hv.textContent = `${height.value} cm`)), onchange: () => render() });
      const hv = h('output', { class: 'cc-range-value' }, `${Math.round(input.height * 100)} cm`);
      const weight = h('input', { class: 'cc-range', type: 'range', min: '55', max: '100', value: String(input.weight), 'aria-label': 'Weight', oninput: () => ((input.weight = Number(weight.value)), (wv.textContent = `${weight.value} kg`)), onchange: () => render() });
      const wv = h('output', { class: 'cc-range-value' }, `${input.weight} kg`);
      return h(
        'div',
        { class: 'cc-creator-form' },
        field('Skin tone', h('div', { class: 'cc-choice-row' }, ...[1, 2, 3, 4].map((sk) => h('button', { class: `cc-swatch ${input.skin === sk ? 'is-selected' : ''}`, type: 'button', 'aria-label': `Skin tone ${sk}`, style: `background-image: url("${dataUrl(`media/objects/players/textures/skin0${sk}.png`)}")`, onclick: () => ((input.skin = sk), render()) })))),
        field('Hairstyle', h('div', { class: 'cc-choice-row cc-hair-row' }, ...HAIR_STYLES.map((hs) => h('button', { class: `cc-hair ${input.hair === hs ? 'is-selected' : ''}`, type: 'button', onclick: () => ((input.hair = hs), render()) }, avatar({ skin: input.skin, hair: hs, hairColor: input.hairColor }, 54), h('span', {}, HAIR_STYLE_NAMES[hs]))))),
        field('Hair colour', h('div', { class: 'cc-choice-row' }, ...HAIR_COLORS.map((hc) => h('button', { class: `cc-swatch cc-swatch--hair ${input.hairColor === hc ? 'is-selected' : ''}`, type: 'button', 'aria-label': HAIR_COLOR_NAMES[hc], title: HAIR_COLOR_NAMES[hc], style: `background-image: url("${dataUrl(`media/objects/players/textures/hair/${hc}.png`)}")`, onclick: () => ((input.hairColor = hc), render()) })))),
        field('Height', h('div', { class: 'cc-range-row' }, height, hv)),
        field('Weight', h('div', { class: 'cc-range-row' }, weight, wv)),
        h('p', { class: 'cc-dim cc-small' }, 'Tall players head the ball better and are stronger; shorter players are quicker and more agile.'),
      );
    }
    if (step === 2) {
      const traitCount = input.traits.length;
      return h(
        'div',
        { class: 'cc-creator-form' },
        h('div', { class: 'cc-creator-split' }, field(
          'Position',
          h(
            'div',
            { class: 'cc-pitch', role: 'group', 'aria-label': 'Position' },
            ...(Object.keys(PITCH) as Position[]).map((p) => h('button', { class: `cc-pitch-pos ${input.pos === p ? 'is-selected' : ''}`, type: 'button', title: POSITION_NAMES[p], style: `top: ${PITCH[p][0]}%; left: ${PITCH[p][1]}%`, onclick: () => ((input.pos = p), (input.foot = p === 'LB' || p === 'LM' ? 'L' : input.foot), render()) }, p)),
          ),
        ),
        h('div', { class: 'cc-creator-form' }, h('div', { class: 'cc-posname' }, h('span', { class: 'cc-kicker' }, input.pos), h('strong', {}, POSITION_NAMES[input.pos])),
        field('Preferred foot', choiceRow(['R', 'L'] as ('L' | 'R')[], input.foot, (v) => (v === 'L' ? 'Left' : 'Right'), (v) => (input.foot = v))),
        field('Talent', h('div', { class: 'cc-talents' }, ...TALENTS.map((t) => h('button', { class: `cc-talent ${input.talent === t.key ? 'is-selected' : ''}`, type: 'button', onclick: () => ((input.talent = t.key as Talent), render()) }, h('strong', {}, t.name), h('span', { class: 'cc-dim' }, t.desc), stars(t.key === 'grafter' ? 2.5 : t.key === 'promising' ? 3.5 : 4.5))))))),
        field(
          `Personality (up to 3 · ${traitCount}/3)`,
          h(
            'div',
            { class: 'cc-traits' },
            ...TRAITS.map((t) => {
              const on = input.traits.includes(t.key);
              const blocked = !on && (traitCount >= 3 || input.traits.some((x) => t.excludes?.includes(x) || TRAITS.find((y) => y.key === x)?.excludes?.includes(t.key)));
              return h(
                'button',
                {
                  class: `cc-trait ${on ? 'is-selected' : ''} ${blocked ? 'is-blocked' : ''}`,
                  type: 'button',
                  'aria-pressed': on ? 'true' : 'false',
                  onclick: () => {
                    if (on) input.traits = input.traits.filter((x) => x !== t.key);
                    else if (!blocked) input.traits = [...input.traits, t.key as TraitKey];
                    render();
                  },
                },
                h('strong', {}, t.name),
                h('span', { class: 'cc-dim' }, t.desc),
              );
            }),
          ),
        ),
      );
    }
    if (step === 3) {
      const clubs = clubsOf(input.country);
      const cities = world.cities.filter((c) => c.countryKey === input.country);
      const home = h(
        'select',
        { class: 'cc-select', 'aria-label': 'Hometown', onchange: () => ((input.hometown = home.value === '' ? null : Number(home.value)), render()) },
        h('option', { value: '', selected: input.hometown === null ? true : undefined }, 'Same city as the academy (live with family)'),
        ...cities.map((c) => h('option', { value: String(c.id), selected: input.hometown === c.id ? true : undefined }, c.name)),
      );
      return h(
        'div',
        { class: 'cc-creator-form' },
        field('Country', h('div', { class: 'cc-choice-row' }, ...COUNTRIES.map((c) => h('button', { class: `cc-choice-chip ${input.country === c.key ? 'is-selected' : ''}`, type: 'button', onclick: () => ((input.country = c.key), (input.hometown = null), pickDefaultClub(), render()) }, c.name)))),
        field(
          'Academy',
          h(
            'div',
            { class: 'cc-club-pick' },
            ...clubs.map((c) => {
              const lg = world.leagues[c.leagueId];
              return h(
                'button',
                { class: `cc-club-option ${input.clubId === c.id ? 'is-selected' : ''}`, type: 'button', onclick: () => ((input.clubId = c.id), render()) },
                h('img', { class: 'cc-crest cc-crest--sm', src: clubCrestUrl(c), alt: '' }),
                h('span', { class: 'cc-club-option-main' }, h('strong', {}, c.name), h('span', { class: 'cc-dim' }, `${world.cities[c.cityId].name} · ${lg.name}`)),
                h('span', { class: 'cc-club-option-stars' }, h('small', {}, 'Club'), stars(c.reputation / 20), h('small', {}, 'Academy'), stars(c.youthFacilities * 5)),
              );
            }),
          ),
        ),
        field('Hometown (where your family lives)', home),
        h('p', { class: 'cc-dim cc-small' }, 'Bigger clubs have better coaches and facilities, but it is harder to break into their first team. If your family lives elsewhere you start in academy digs.'),
      );
    }
    const club = world.clubs[input.clubId];
    return h(
      'div',
      { class: 'cc-creator-form' },
      field('Romance storylines', choiceRow([true, false], input.romance, (v) => (v ? 'On' : 'Off'), (v) => (input.romance = v))),
      field('Difficulty', choiceRow(['easy', 'normal', 'hard'] as ('easy' | 'normal' | 'hard')[], input.difficulty, (v) => v[0].toUpperCase() + v.substring(1), (v) => (input.difficulty = v))),
      h(
        'div',
        { class: 'cc-card cc-summary' },
        h('h3', { class: 'cc-card-title' }, 'Your story begins'),
        h('p', {}, `1 July ${2026}: ${input.first} ${input.last}, ${input.age}, joins the ${club?.name ?? ''} academy in ${club ? world.cities[club.cityId].name : ''}${input.hometown !== null && input.hometown !== club?.cityId ? `, far from home in ${world.cities[input.hometown].name}` : ', close to his family'}.`),
        h('p', { class: 'cc-dim' }, 'Mornings are for club training. Afternoons and evenings are yours: rest, train extra, study, see friends, go out… Every choice counts.'),
      ),
    );
  }

  function start(): void {
    if (!input.first || !input.last) {
      showToast('Please enter a name', 'warn');
      go(0);
      return;
    }
    const club = world.clubs[input.clubId];
    const state = newCareer(input, { seed, db, hometown: input.hometown ?? club.cityId });
    if (kv) {
      try {
        saveToSlot(kv, slot, state);
      } catch (e) {
        showToast(`Could not save (${e instanceof Error ? e.message : String(e)})`, 'warn');
      }
    }
    new CareerApp(state, slot, kv).show();
  }

  function go(n: number): void {
    step = Math.max(0, Math.min(STEPS.length - 1, n));
    render();
  }

  function render(): void {
    const frame = screenFrame({
      id: 'career-creator',
      kicker: 'New career',
      title: ['Who are you?', 'Your look', 'Your game', 'Your first club', 'Ready?'][step],
      steps: { labels: STEPS, active: step },
      background: 'city',
      onBack: () => (step > 0 ? go(step - 1) : back()),
      body: [h('div', { class: 'cc-creator' }, h('div', { class: 'cc-creator-main' }, stepBody()), preview())],
      actions: [
        step > 0 ? h('button', { class: 'btn btn--ghost', type: 'button', onclick: () => go(step - 1) }, h('span', {}, 'Back')) : null,
        step < STEPS.length - 1 ? h('button', { class: 'btn btn--primary', type: 'button', onclick: () => go(step + 1), 'data-nav-default': true }, h('span', {}, 'Next')) : h('button', { class: 'btn btn--primary btn--kickoff', type: 'button', onclick: start, 'data-nav-default': true }, h('span', {}, 'Start career')),
      ],
    });
    const focused = document.activeElement instanceof HTMLElement && frameHost.contains(document.activeElement) ? document.activeElement.getAttribute('aria-label') : null;
    frameHost.replaceChildren(frame);
    if (focused) frameHost.querySelector<HTMLElement>(`[aria-label="${focused}"]`)?.focus();
  }
  render();
  frameHost.className = 'cc-creator-root';
  return screen;
}
