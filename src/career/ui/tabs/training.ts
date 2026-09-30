// Training: the club's sessions this week, how hard you train in them and your personal focus,
// extra-session intensity, what affects training quality right now, and the session catalogue
// with the stats each one develops (current value vs natural potential).

import { h } from '../../../ui/dom';
import { slotInfo } from '../../core/career';
import { STAT_LABELS, type StatName } from '../../core/attributes';
import { WEEKDAYS_SHORT, formatDate, weekday } from '../../core/dates';
import { INTENSITY, INTENSITY_NAMES, TRAINING, type TrainingKey } from '../../core/data/lifestyle';
import { club, coachOf } from '../../core/index';
import { setOverride } from '../../core/life';
import { bestTrainingFocus, clubSessionFor, naturalCap, xpMultiplier } from '../../core/training';
import type { CareerApp } from '../app';
import { btn, card, keyValue, meter, pill, stars, statBar } from '../components';

const SHORT_SESSION: Record<TrainingKey, string> = { fitness: 'Fitness', speed: 'Speed', strength: 'Gym', ballcontrol: 'Ball work', passing: 'Passing', finishing: 'Finishing', defending: 'Defending', goalkeeping: 'Keeping', tactical: 'Tactical', setpieces: 'Set pieces', recovery: 'Recovery' };

function segmented(values: string[], current: number, onPick: (i: number) => void): HTMLElement {
  return h('div', { class: 'segmented cc-seg' }, ...values.map((v, i) => h('button', { class: `seg-btn ${i === current ? 'is-selected' : ''}`, type: 'button', onclick: () => onPick(i) }, v)));
}

export function renderTraining(app: CareerApp): HTMLElement {
  const s = app.state;
  const u = s.user;
  const life = s.life;
  const coach = coachOf(s, u.clubId);
  const c = club(s, u.clubId);
  const best = bestTrainingFocus(s);

  const week = Array.from({ length: 7 }, (_, i) => s.day + i).map((d) => {
    const key = u.clubId >= 0 ? clubSessionFor(s, d) : null;
    const info = slotInfo(s, d, 0);
    const label = info.kind === 'match' ? 'Match' : key ? SHORT_SESSION[key] : info.kind === 'off' ? 'Match day' : 'Day off';
    return h('div', { class: `cc-session-day ${d === s.day ? 'is-today' : ''} ${key ? '' : 'is-off'}` }, h('strong', {}, WEEKDAYS_SHORT[weekday(d)]), h('span', { class: 'cc-dim' }, formatDate(d).replace(/ \d{4}$/, '')), h('span', {}, label));
  });

  const clubCard = card(
    'Club training',
    [
      coach
        ? h(
            'div',
            { class: 'cc-coach' },
            h('div', {}, h('strong', {}, `${coach.first} ${coach.last}`), h('span', { class: 'cc-dim' }, ` · ${coach.style} coach, ${coach.formation}`)),
            keyValue([
              ['Coaching', stars(coach.quality * 5)],
              ['Facilities', stars((c?.facilities ?? 0.5) * 5)],
              ['Discipline', stars(coach.discipline * 5)],
              ['Trusts youth', stars(coach.youthFaith * 5)],
            ]),
          )
        : h('p', { class: 'cc-dim' }, 'Without a club you train on your own: gym, park and personal trainers.'),
      h('div', { class: 'cc-session-week' }, ...week),
    ],
    { className: 'cc-train-club' },
  );

  const I = INTENSITY[life.clubIntensity];
  const effortCard = card('Your effort', [
    h('p', { class: 'cc-dim' }, 'How hard you push in club sessions. The coach notices effort and attendance; hard sessions drain energy and raise injury risk.'),
    segmented([...INTENSITY_NAMES], life.clubIntensity, (i) => {
      life.clubIntensity = i as 0 | 1 | 2;
      app.render();
    }),
    h('div', { class: 'cc-pills' }, pill(`XP ×${I.xp.toFixed(2)}`, 'info'), pill(`Energy ×${I.energy.toFixed(2)}`, 'warn'), pill(`Injury risk ×${I.injury.toFixed(2)}`, life.clubIntensity === 2 ? 'bad' : 'dim'), pill(I.coach > 0.2 ? 'Coach impressed' : I.coach < 0 ? 'Coach unimpressed' : 'Coach neutral', I.coach > 0.2 ? 'good' : I.coach < 0 ? 'bad' : 'dim')),
    h('h4', { class: 'cc-h4' }, 'Personal focus in club sessions'),
    h('p', { class: 'cc-dim' }, 'A third of every club session goes into your focus (extra reps, individual drills).'),
    h(
      'select',
      {
        class: 'cc-select',
        'aria-label': 'Personal focus',
        onchange: (e: Event) => {
          const v = (e.target as HTMLSelectElement).value;
          life.clubFocus = v === '' ? null : v;
          app.render();
        },
      },
      h('option', { value: '', selected: life.clubFocus === null ? true : undefined }, 'No personal focus'),
      ...TRAINING.filter((t) => t.key !== 'recovery' && (t.key !== 'goalkeeping' || u.pos === 'GK')).map((t) => h('option', { value: t.key, selected: life.clubFocus === t.key ? true : undefined }, `${t.name}${t.key === best ? ' — recommended' : ''}`)),
    ),
    h('h4', { class: 'cc-h4' }, 'Extra sessions'),
    segmented([...INTENSITY_NAMES], life.extraIntensity, (i) => {
      life.extraIntensity = i as 0 | 1 | 2;
      app.render();
    }),
    h('div', { class: 'cc-meter-grid' }, meter('Attendance', u.attendance * 100, { hint: 'Share of club sessions attended recently' }), meter('Effort', u.effort * 100, { hint: 'How hard the coach sees you work' }), meter('Professionalism', u.professionalism)),
  ]);

  const q = xpMultiplier(s, { intensity: 1, source: 'club' });
  const quality = card('Training quality right now', [
    h('div', { class: 'cc-quality' }, h('strong', {}, `×${q.toFixed(2)}`), h('span', { class: 'cc-dim' }, 'XP multiplier at normal intensity')),
    h(
      'ul',
      { class: 'cc-list cc-factors' },
      h('li', {}, `Energy ${Math.round(u.energy)} — ${u.energy >= 50 ? 'fresh enough' : 'tired players learn less'}`),
      h('li', {}, `Morale ${Math.round(u.morale)} — ${u.morale >= 60 ? 'motivated' : 'a happier player trains better'}`),
      h('li', {}, `Professionalism ${Math.round(u.professionalism)}`),
      h('li', {}, `Coach quality ${coach ? Math.round(coach.quality * 100) : '—'} · facilities ${c ? Math.round(c.facilities * 100) : '—'}`),
      s.life.education.completed.includes('sports_science') ? h('li', {}, 'Sports Science diploma: +5%') : null,
      u.injury ? h('li', { class: 'cc-bad' }, 'Injured: only rehab counts') : null,
    ),
  ]);

  const freeAfternoon = slotInfo(s, s.day, 1).kind === 'free' && s.slot <= 1;
  const catalogue = TRAINING.filter((t) => t.key !== 'goalkeeping' || u.pos === 'GK').map((t) =>
    h(
      'article',
      { class: `cc-session ${t.key === best ? 'is-recommended' : ''}` },
      h('header', {}, h('h4', {}, t.name), t.key === best ? pill('Recommended', 'gold') : null),
      h('p', { class: 'cc-dim' }, t.desc),
      h('div', { class: 'cc-session-stats' }, ...t.stats.map(([name]) => statBar(STAT_LABELS[name as StatName], u.stats[name as StatName], 0, naturalCap(s, name as StatName)))),
      h('div', { class: 'cc-pills' }, pill(t.energy > 0 ? `Energy −${t.energy}` : `Energy +${-t.energy}`, t.energy > 16 ? 'warn' : 'dim'), pill(`Injury ×${t.injury.toFixed(1)}`, t.injury > 1 ? 'bad' : 'dim')),
      h(
        'div',
        { class: 'cc-row-actions' },
        t.key !== 'recovery' ? btn(life.clubFocus === t.key ? 'Focus ✓' : 'Set as focus', () => ((life.clubFocus = t.key), app.render()), 'ghost', { small: true }) : null,
        t.key !== 'recovery' && t.key !== 'goalkeeping' && freeAfternoon
          ? btn('Extra session today', () => {
              setOverride(s, s.day, 1, `extra_training:${t.key}`);
              app.toast(`Extra ${t.name.toLowerCase()} session planned for this afternoon`, 'success');
              app.render();
            }, 'ghost', { small: true, disabled: u.injury ? 'Injured' : false })
          : null,
      ),
    ),
  );
  void (null as unknown as TrainingKey);
  return h('div', { class: 'cc-page' }, h('div', { class: 'cc-grid cc-grid--2' }, h('div', { class: 'cc-col' }, clubCard, quality), effortCard), h('h2', { class: 'cc-h2' }, 'Sessions'), h('div', { class: 'cc-sessions' }, ...catalogue));
}
